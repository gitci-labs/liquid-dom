import { Leaf } from '@liquid-dom/layout'
import type { CSSProperties, ReactNode } from 'react'
import type { LayoutNode, ProposedSize, Size } from '@liquid-dom/layout'

export type VisualBox = {
  node: LayoutNode
  id: string
  label: string
  tone: 'teal' | 'red' | 'blue' | 'yellow' | 'gray'
  role?: 'leaf' | 'group'
}

class VisualLeaf extends Leaf {
  constructor(private readonly size: Size) {
    super()
  }

  protected override measureLeaf(): Size {
    return this.size
  }
}

export function visualLeaf(
  id: string,
  size: Size,
  label: string,
  tone: VisualBox['tone'],
): VisualBox {
  const node = new VisualLeaf(size)
  return { node, id, label, tone, role: 'leaf' }
}

export function visualGroup(
  node: LayoutNode,
  id: string,
  label: string,
  tone: VisualBox['tone'],
): VisualBox {
  return { node, id, label, tone, role: 'group' }
}

export function VisualLayoutView({
  root,
  boxes,
  proposal,
  includeBox,
  className = 'layout-stage',
}: {
  root: LayoutNode
  boxes: VisualBox[]
  proposal: ProposedSize
  includeBox?: (box: VisualBox) => boolean
  className?: string
}) {
  const stageStyle: CSSProperties = {
    width: proposal.width ?? 420,
    height: proposal.height ?? 160,
  }
  const boxByNodeId = new Map(boxes.map((box) => [box.node.id, box]))

  return (
    <div className={className} style={stageStyle}>
      <LayoutNodeView
        node={root}
        boxByNodeId={boxByNodeId}
        offset={{ x: 0, y: 0 }}
        includeBox={includeBox}
      />
    </div>
  )
}

const stageElements = new WeakMap<HTMLElement, Map<string, HTMLElement>>()

export function syncVisualLayout(
  stage: HTMLElement,
  root: LayoutNode,
  boxes: VisualBox[],
  proposal: ProposedSize,
  options: { includeBox?: (box: VisualBox) => boolean } = {},
) {
  stage.style.width = `${proposal.width ?? 420}px`
  stage.style.height = `${proposal.height ?? 160}px`

  let elements = stageElements.get(stage)
  if (!elements) {
    elements = new Map()
    stageElements.set(stage, elements)
  }

  const boxByNodeId = new Map(boxes.map((box) => [box.node.id, box]))
  const seen = new Set<string>()

  const visit = (node: LayoutNode, parentElement: HTMLElement, offset: { x: number; y: number }) => {
    const layout = node.layout
    if (!layout) return

    const boxData = boxByNodeId.get(node.id)
    const shouldRender = Boolean(boxData && (options.includeBox?.(boxData) ?? true))
    let childParent = parentElement
    let childOffset = {
      x: offset.x + layout.rect.x,
      y: offset.y + layout.rect.y,
    }

    if (boxData && shouldRender) {
      let box = elements.get(node.id)
      if (!box) {
        box = document.createElement('div')
        elements.set(node.id, box)
      }

      const className = `layout-box tone-${boxData.tone} role-${boxData.role ?? 'leaf'}`
      if (box.className !== className) box.className = className
      if (box.textContent !== boxData.label) box.textContent = boxData.label

      const transform = `translate3d(${childOffset.x}px, ${childOffset.y}px, 0)`
      setStyleIfChanged(box, 'transform', transform)
      setStyleIfChanged(box, 'width', `${layout.rect.width}px`)
      setStyleIfChanged(box, 'height', `${layout.rect.height}px`)

      parentElement.append(box)
      seen.add(node.id)
      childParent = box
      childOffset = { x: 0, y: 0 }
    }

    for (const child of node.children) {
      visit(child, childParent, childOffset)
    }
  }

  visit(root, stage, { x: 0, y: 0 })

  for (const [id, element] of elements) {
    if (seen.has(id)) continue
    element.remove()
    elements.delete(id)
  }
}

function setStyleIfChanged(element: HTMLElement, property: string, value: string) {
  if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value)
  }
}

function LayoutNodeView({
  node,
  boxByNodeId,
  offset,
  includeBox,
}: {
  node: LayoutNode
  boxByNodeId: Map<string, VisualBox>
  offset: { x: number; y: number }
  includeBox?: (box: VisualBox) => boolean
}): ReactNode {
  const layout = node.layout
  if (!layout) return null

  const box = boxByNodeId.get(node.id)
  const shouldRender = Boolean(box && (includeBox?.(box) ?? true))
  const childOffset = {
    x: offset.x + layout.rect.x,
    y: offset.y + layout.rect.y,
  }
  const children = node.children.map((child) => (
    <LayoutNodeView
      key={child.id}
      node={child}
      boxByNodeId={boxByNodeId}
      offset={shouldRender ? { x: 0, y: 0 } : childOffset}
      includeBox={includeBox}
    />
  ))

  if (!box || !shouldRender) return children

  const style: CSSProperties = {
    transform: `translate3d(${childOffset.x}px, ${childOffset.y}px, 0)`,
    width: layout.rect.width,
    height: layout.rect.height,
  }

  return (
    <div className={`layout-box tone-${box.tone} role-${box.role ?? 'leaf'}`} style={style}>
      {box.label}
      {children}
    </div>
  )
}

export function visualDrawNodeIds(boxes: VisualBox[], leafLimit: number): Set<string> {
  const ids = new Set<string>()
  let leafCount = 0

  for (const box of boxes) {
    if (box.role === 'group' || leafCount < leafLimit) {
      ids.add(box.node.id)
      if (box.role !== 'group') leafCount += 1
    }
  }

  return ids
}

export function stressDrawNodeIds(boxes: VisualBox[], leafLimit: number): Set<string> {
  const ids = new Set<string>()
  let leafCount = 0
  let groupCount = 0

  for (const box of boxes) {
    if (box.role === 'group' && groupCount < 220) {
      ids.add(box.node.id)
      groupCount += 1
    } else if (box.role !== 'group' && leafCount < leafLimit) {
      ids.add(box.node.id)
      leafCount += 1
    }
  }

  return ids
}

export function formatStats(stats: {
  measureCalls: number
  cacheHits: number
  cacheMisses: number
  invalidations: number
}) {
  const total = stats.cacheHits + stats.cacheMisses
  return `measure calls: ${stats.measureCalls}
cache hits: ${stats.cacheHits}
cache misses: ${stats.cacheMisses}
cache hit ratio: ${formatPercent(stats.cacheHits / Math.max(1, total))}
invalidations: ${stats.invalidations}`
}

export function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) * percentileValue)] ?? 0
}

export function wave(phase: number) {
  return (Math.sin(phase * Math.PI * 2) + 1) / 2
}

export function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function clampFloat(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function formatMs(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ms`
}

export function formatPercent(value: number) {
  return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

export function toneFor(value: string): VisualBox['tone'] {
  const tones: VisualBox['tone'][] = ['teal', 'red', 'blue', 'yellow', 'gray']
  return tones[value.length % tones.length] ?? 'teal'
}

export function stressTone(index: number): VisualBox['tone'] {
  const tones: VisualBox['tone'][] = ['teal', 'blue', 'yellow', 'red', 'gray']
  return tones[index % tones.length] ?? 'teal'
}
