import type {
  ChildInput,
  LayoutInvalidation,
  LayoutInvalidationKind,
  LayoutNode,
  LayoutPlaceInput,
  LayoutMeasureInput,
  NodeLayout,
  Size,
} from './types'

let nextNodeId = 0

export abstract class Layout implements LayoutNode {
  readonly __liquidDomLayout = true
  readonly id: string
  readonly kind: string

  private _parent: Layout | null = null
  private _children: Layout[] = []
  private _layout: NodeLayout | undefined
  private _measureRevision = 0
  private _subtreeMeasureRevision = 0
  private _structureRevision = 0
  private _disposed = false
  private readonly invalidationListeners = new Set<(invalidation: LayoutInvalidation) => void>()
  private readonly layoutOwners = new Set<object>()

  isSpacer = false

  constructor(kind: string, options: { isSpacer?: boolean } = {}) {
    this.id = `node:${++nextNodeId}`
    this.kind = kind
    this.isSpacer = options.isSpacer ?? false
  }

  get parent(): LayoutNode | null {
    return this._parent
  }

  get children(): readonly LayoutNode[] {
    return this._children
  }

  get layout(): NodeLayout | undefined {
    return this._layout
  }

  get measureRevision(): number {
    return this._measureRevision
  }

  get subtreeMeasureRevision(): number {
    return this._subtreeMeasureRevision
  }

  get structureRevision(): number {
    return this._structureRevision
  }

  get disposed(): boolean {
    return this._disposed
  }

  isLayoutActive(): boolean {
    return this.layoutOwners.size > 0
  }

  append(...children: ChildInput[]): this {
    for (const child of normalizeChildInputs(children)) {
      this.insertAt(this._children.length, child)
    }
    return this
  }

  prepend(...children: ChildInput[]): this {
    let index = 0
    for (const child of normalizeChildInputs(children)) {
      this.insertAt(index, child)
      index += 1
    }
    return this
  }

  insertBefore(child: ChildInput, before: LayoutNode): this {
    const beforeNode = asInternalNode(before)
    const index = this._children.indexOf(beforeNode)
    if (index === -1) {
      throw new Error('insertBefore expected the reference node to be a child of this layout node.')
    }
    let nextIndex = index
    for (const childNode of normalizeChildInputs([child])) {
      this.insertAt(nextIndex, childNode)
      nextIndex += 1
    }
    return this
  }

  replaceChildren(...children: ChildInput[]): this {
    for (const child of this._children) {
      child._parent = null
    }
    this._children = []
    for (const child of normalizeChildInputs(children)) {
      this.insertAt(this._children.length, child, false)
    }
    this.markStructureDirty('children')
    return this
  }

  remove() {
    this._parent?.detachChild(this)
  }

  dispose() {
    if (this._disposed) return
    this.remove()
    for (const child of [...this._children]) {
      child.dispose()
    }
    this._disposed = true
    this.markStructureDirty('dispose')
  }

  setLayout(layout: NodeLayout) {
    this._layout = layout
  }

  abstract measureSelf(input: LayoutMeasureInput): Size

  placeChildren(input: LayoutPlaceInput): void {
    void input
  }

  getMeasureKey(): unknown {
    return undefined
  }

  addInvalidationListener(listener: (invalidation: LayoutInvalidation) => void): () => void {
    this.invalidationListeners.add(listener)
    return () => {
      this.invalidationListeners.delete(listener)
    }
  }

  markMeasureDirty(cause?: unknown) {
    this._measureRevision += 1
    this.markSubtreeMeasureDirty()
    this.emitInvalidation('measure', cause)
  }

  protected markPlacementDirty(cause?: unknown) {
    this._structureRevision += 1
    this.emitInvalidation('placement', cause)
  }

  activateLayout(owner: object) {
    if (this._disposed || this.layoutOwners.has(owner)) return
    const wasInactive = this.layoutOwners.size === 0
    this.layoutOwners.add(owner)
    if (wasInactive) this.onLayoutActive()
  }

  deactivateLayout(owner: object) {
    if (!this.layoutOwners.delete(owner)) return
    if (this.layoutOwners.size === 0) this.onLayoutInactive()
  }

  protected onLayoutActive(): void {
    return
  }

  protected onLayoutInactive(): void {
    return
  }

  protected emitInvalidation(kind: LayoutInvalidationKind, cause?: unknown) {
    const invalidation: LayoutInvalidation = cause === undefined
      ? { id: this.id, node: this, kind }
      : { id: this.id, node: this, kind, cause }
    this.emitInvalidationRecord(invalidation)
  }

  private emitInvalidationRecord(invalidation: LayoutInvalidation) {
    for (const listener of this.invalidationListeners) {
      listener(invalidation)
    }
    this._parent?.emitInvalidationRecord(invalidation)
  }

  private insertAt(index: number, child: LayoutNode, notify = true) {
    const childNode = asInternalNode(child)
    this.assertCanAdopt(childNode)

    let nextIndex = Math.max(0, Math.min(index, this._children.length))
    if (childNode._parent === this) {
      const currentIndex = this._children.indexOf(childNode)
      if (currentIndex === -1) return
      this._children.splice(currentIndex, 1)
      if (currentIndex < nextIndex) nextIndex -= 1
    } else {
      childNode._parent?.detachChild(childNode)
    }

    this._children.splice(nextIndex, 0, childNode)
    childNode._parent = this
    this.markStructureDirty('children', notify)
  }

  private detachChild(childNode: Layout) {
    const index = this._children.indexOf(childNode)
    if (index === -1) return
    this._children.splice(index, 1)
    childNode._parent = null
    this.markStructureDirty('children')
  }

  private assertCanAdopt(child: Layout) {
    if (child === this) {
      throw new Error('A layout node cannot be inserted into itself.')
    }

    let ancestor: Layout | null = this
    while (ancestor) {
      if (ancestor === child) {
        throw new Error('A layout node cannot be inserted into one of its descendants.')
      }
      ancestor = ancestor._parent
    }
  }

  private markStructureDirty(cause?: unknown, notify = true) {
    this._structureRevision += 1
    this._measureRevision += 1
    this.markSubtreeMeasureDirty()
    if (notify) this.emitInvalidation('structure', cause)
  }

  private markSubtreeMeasureDirty() {
    this._subtreeMeasureRevision += 1
    this._parent?.markSubtreeMeasureDirty()
  }
}

export function isLayoutNode(value: unknown): value is LayoutNode {
  return Boolean(
    value && typeof value === 'object' && (value as { __liquidDomLayout?: unknown }).__liquidDomLayout === true,
  )
}

export function asInternalNode(node: LayoutNode): Layout {
  if (node instanceof Layout) return node
  throw new Error('Expected a layout node.')
}

export function normalizeChildInputs(inputs: readonly ChildInput[]): LayoutNode[] {
  const children: LayoutNode[] = []
  for (const input of inputs) {
    if (input === null || input === false || input === undefined) continue
    if (Array.isArray(input)) {
      for (const child of input) {
        if (child !== null && child !== false && child !== undefined) children.push(child)
      }
    } else if (isLayoutNode(input)) {
      children.push(input)
    }
  }
  return children
}
