import { asInternalNode, Layout } from './node'
import type {
  LayoutChild,
  LayoutDebugStats,
  LayoutEngineOptions,
  LayoutInvalidation,
  LayoutNode,
  ProposedSize,
  Rect,
  Size,
} from './types'
import { proposalKey, sanitizeProposal, sanitizeRect, sanitizeSize, stableSerialize } from './utils'

const EMPTY_STATS: LayoutDebugStats = {
  measureCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  invalidations: 0,
  nodes: 0,
}

export class LayoutEngine {
  private readonly layoutOwner = {}
  private rootNode: Layout | undefined
  private readonly onInvalidate: LayoutEngineOptions['onInvalidate']
  private readonly maxCachedMeasurements: number
  private readonly measureCache = new Map<string, Size>()
  private reachableNodes = new Map<string, Layout>()
  private readonly objectIds = new WeakMap<object, number>()
  private objectIdCounter = 0
  private invalidationCount = 0
  private lastStats: LayoutDebugStats = { ...EMPTY_STATS }
  private cleanupRootListener: (() => void) | undefined

  constructor(options: LayoutEngineOptions = {}) {
    this.onInvalidate = options.onInvalidate
    this.maxCachedMeasurements = options.maxCachedMeasurements ?? 50_000
    this.root = options.root
  }

  get root(): LayoutNode | undefined {
    return this.rootNode
  }

  set root(value: LayoutNode | undefined) {
    const nextRoot = value ? asInternalNode(value) : undefined
    if (this.rootNode === nextRoot) return

    this.cleanupRootListener?.()
    this.cleanupRootListener = undefined
    this.rootNode = nextRoot

    if (nextRoot) {
      this.cleanupRootListener = nextRoot.addInvalidationListener((invalidation) => this.handleInvalidation(invalidation))
    }

    this.syncReachableNodes()
  }

  layout(proposal: ProposedSize): LayoutDebugStats {
    if (!this.rootNode || this.rootNode.disposed) {
      throw new Error('layout() called before assigning engine.root.')
    }

    this.syncReachableNodes()

    const stats = { ...EMPTY_STATS, invalidations: this.invalidationCount }
    const cleanProposal = sanitizeProposal(proposal)
    const size = this.measureNode(this.rootNode, cleanProposal, stats)
    this.placeNode(
      this.rootNode,
      {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      },
      cleanProposal,
      stats,
    )

    this.lastStats = stats
    return stats
  }

  getDebugStats(): LayoutDebugStats {
    return {
      ...this.lastStats,
      invalidations: this.invalidationCount,
    }
  }

  dispose() {
    this.cleanupRootListener?.()
    this.cleanupRootListener = undefined
    this.rootNode = undefined
    this.syncReachableNodes()
    this.measureCache.clear()
  }

  private measureNode(
    node: Layout,
    proposal: ProposedSize,
    stats: LayoutDebugStats,
  ): Size {
    const key = this.measureCacheKey(node, proposal)
    if (this.maxCachedMeasurements > 0) {
      const cached = this.measureCache.get(key)
      if (cached) {
        stats.cacheHits += 1
        return cached
      }
    }

    stats.cacheMisses += 1
    stats.measureCalls += 1

    const children = this.childrenFor(node, stats)
    const measured = sanitizeSize(
      node.measureSelf({
        proposal,
        children,
        node,
      }),
    )
    this.setCachedMeasurement(key, measured)
    return measured
  }

  private placeNode(
    node: Layout,
    bounds: Rect,
    proposal: ProposedSize,
    stats: LayoutDebugStats,
  ): void {
    const rect = sanitizeRect(bounds)
    node.setLayout({
      rect,
    })
    stats.nodes += 1

    const children = this.childrenFor(node, stats)
    const localBounds = {
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
    }
    node.placeChildren({
      bounds: localBounds,
      proposal: sanitizeProposal(proposal),
      children,
      node,
    })
  }

  private childrenFor(node: Layout, stats: LayoutDebugStats): LayoutChild[] {
    return node.children.map((child) => {
      const childNode = asInternalNode(child)
      return {
        node: child,
        id: child.id,
        kind: child.kind,
        isSpacer: childNode.isSpacer,
        measure: (proposal) => this.measureNode(childNode, sanitizeProposal(proposal), stats),
        place: (bounds, proposal) =>
          this.placeNode(childNode, bounds, sanitizeProposal(proposal ?? bounds), stats),
      }
    })
  }

  private handleInvalidation(invalidation: LayoutInvalidation) {
    if (invalidation.kind === 'structure') {
      this.syncReachableNodes()
    }
    this.invalidationCount += 1
    this.onInvalidate?.(invalidation)
  }

  private syncReachableNodes() {
    const nextReachable = new Map<string, Layout>()
    if (this.rootNode && !this.rootNode.disposed) {
      this.collectReachable(this.rootNode, nextReachable)
    }

    for (const [id, node] of this.reachableNodes) {
      if (!nextReachable.has(id)) node.deactivateLayout(this.layoutOwner)
    }

    for (const [id, node] of nextReachable) {
      if (!this.reachableNodes.has(id)) node.activateLayout(this.layoutOwner)
    }

    this.reachableNodes = nextReachable
  }

  private collectReachable(node: Layout, reachable: Map<string, Layout>) {
    if (node.disposed) return
    reachable.set(node.id, node)
    for (const child of node.children) {
      this.collectReachable(asInternalNode(child), reachable)
    }
  }

  private measureCacheKey(node: Layout, proposal: ProposedSize): string {
    return [
      node.id,
      proposalKey(proposal),
      node.measureRevision,
      node.subtreeMeasureRevision,
      this.valueSignature(node.getMeasureKey()),
    ].join('|')
  }

  private setCachedMeasurement(key: string, size: Size) {
    if (this.maxCachedMeasurements <= 0) {
      return
    }
    if (this.measureCache.size >= this.maxCachedMeasurements) {
      this.measureCache.clear()
    }
    this.measureCache.set(key, size)
  }

  private valueSignature(value: unknown): string {
    if (value === null || value === undefined) return String(value)
    if (typeof value === 'object' || typeof value === 'function') {
      return `object:${this.objectId(value as object)}`
    }
    return stableSerialize(value)
  }

  private objectId(value: object): number {
    const existing = this.objectIds.get(value)
    if (existing !== undefined) return existing
    const id = ++this.objectIdCounter
    this.objectIds.set(value, id)
    return id
  }
}
