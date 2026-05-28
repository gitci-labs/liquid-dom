import { describe, expect, it, vi } from 'vitest'
import {
  Background,
  LayoutEngine,
  Frame,
  HStack,
  Leaf,
  Layout,
  Noop,
  Overlay,
  Padding,
  Spacer,
  VStack,
  ZStack,
} from '../src/index'
import type { LayoutMeasureInput, LayoutNode, LayoutPlaceInput, ProposedSize, Rect, Size } from '../src/index'

class TestLeaf extends Leaf {
  private readonly measureFn: (proposal: ProposedSize) => Size

  constructor(measure: (proposal: ProposedSize) => Size, options: { measureKey?: unknown } = {}) {
    super(options)
    this.measureFn = measure
  }

  protected override measureLeaf(proposal: ProposedSize): Size {
    return this.measureFn(proposal)
  }
}

function box(size: Size, options: { measure?: (proposal: ProposedSize) => Size } = {}) {
  return new TestLeaf(options.measure ?? (() => size))
}

function layout(root: LayoutNode, proposal: ProposedSize = {}) {
  const engine = new LayoutEngine({ root })
  const stats = engine.layout(proposal)
  engine.dispose()
  return stats
}

function rect(node: LayoutNode): Rect | undefined {
  return node.layout?.rect
}

describe('built-in layouts', () => {
  it('lays out hstack children with spacing and cross-axis alignment', () => {
    const first = box({ width: 10, height: 10 })
    const second = box({ width: 20, height: 20 })
    const root = new HStack({ spacing: 5, alignment: 'center' }).append(first, second)

    layout(root)

    expect(rect(root)).toEqual({ x: 0, y: 0, width: 35, height: 20 })
    expect(rect(first)).toEqual({ x: 0, y: 5, width: 10, height: 10 })
    expect(rect(second)).toEqual({ x: 15, y: 0, width: 20, height: 20 })
  })

  it('expands spacers in finite hstack proposals', () => {
    const first = box({ width: 10, height: 10 })
    const gap = new Spacer()
    const second = box({ width: 10, height: 10 })
    const root = new HStack({ spacing: 0, alignment: 'top' }).append(first, gap, second)

    layout(root, { width: 100, height: 10 })

    expect(rect(root)).toEqual({ x: 0, y: 0, width: 100, height: 10 })
    expect(rect(first)?.x).toBe(0)
    expect(rect(gap)).toEqual({ x: 10, y: 0, width: 80, height: 0 })
    expect(rect(second)?.x).toBe(90)
  })

  it('lays out vstack children vertically', () => {
    const first = box({ width: 10, height: 10 })
    const second = box({ width: 20, height: 5 })
    const root = new VStack({ spacing: 3, alignment: 'trailing' }).append(first, second)

    layout(root)

    expect(rect(root)).toEqual({ x: 0, y: 0, width: 20, height: 18 })
    expect(rect(first)).toEqual({ x: 10, y: 0, width: 10, height: 10 })
    expect(rect(second)).toEqual({ x: 0, y: 13, width: 20, height: 5 })
  })

  it('lets zstack children jointly determine size and alignment', () => {
    const first = box({ width: 10, height: 10 })
    const second = box({ width: 30, height: 20 })
    const root = new ZStack({ alignment: 'bottomTrailing' }).append(first, second)

    layout(root)

    expect(rect(root)).toEqual({ x: 0, y: 0, width: 30, height: 20 })
    expect(rect(first)).toEqual({ x: 20, y: 10, width: 10, height: 10 })
    expect(rect(second)).toEqual({ x: 0, y: 0, width: 30, height: 20 })
  })

  it('applies frame proposal and clamping behavior', () => {
    const measured: ProposedSize[] = []
    const child = box(
      { width: 10, height: 10 },
      {
        measure: (proposal) => {
          measured.push(proposal)
          return { width: proposal.width ?? 10, height: 10 }
        },
      },
    )
    const root = new Frame({ width: 50, height: 20, alignment: 'trailing' }).append(child)

    layout(root, { width: 100, height: 100 })

    expect(measured[0]).toEqual({ width: 50, height: 20 })
    expect(rect(root)).toEqual({ x: 0, y: 0, width: 50, height: 20 })
    expect(rect(child)).toEqual({ x: 0, y: 5, width: 50, height: 10 })
  })

  it('applies frame sizing behavior without children', () => {
    const fixed = new Frame({ width: 50, height: 20 })
    const ideal = new Frame({
      idealWidth: 40,
      idealHeight: 16,
      minWidth: 48,
      maxHeight: 14,
    })
    const expanding = new Frame({ maxWidth: 'infinity', maxHeight: 'infinity' })

    layout(fixed, { width: 100, height: 100 })
    layout(ideal, { width: 100, height: 100 })
    layout(expanding, { width: 80, height: 24 })

    expect(rect(fixed)).toEqual({ x: 0, y: 0, width: 50, height: 20 })
    expect(rect(ideal)).toEqual({ x: 0, y: 0, width: 48, height: 14 })
    expect(rect(expanding)).toEqual({ x: 0, y: 0, width: 80, height: 24 })
  })

  it('adds padding around child measurements and placement', () => {
    const child = box({ width: 10, height: 20 })
    const root = new Padding({ horizontal: 4, vertical: 2 }).append(child)

    layout(root)

    expect(rect(root)).toEqual({ x: 0, y: 0, width: 18, height: 24 })
    expect(rect(child)).toEqual({ x: 4, y: 2, width: 10, height: 20 })
  })

  it('passes measurement and placement through noop', () => {
    const measured: ProposedSize[] = []
    const child = box(
      { width: 10, height: 20 },
      {
        measure: (proposal) => {
          measured.push(proposal)
          return { width: proposal.width ?? 10, height: proposal.height ?? 20 }
        },
      },
    )
    const root = new Noop().append(child)

    layout(root, { width: 30, height: 40 })

    expect(measured[0]).toEqual({ width: 30, height: 40 })
    expect(rect(root)).toEqual({ x: 0, y: 0, width: 30, height: 40 })
    expect(rect(child)).toEqual({ x: 0, y: 0, width: 30, height: 40 })
  })

  it('measures empty noop from the proposal', () => {
    const root = new Noop()

    layout(root, { width: 80 })

    expect(rect(root)).toEqual({
      x: 0,
      y: 0,
      width: 80,
      height: 0,
    })
  })

  it('stores child rects in parent-local coordinates', () => {
    const leading = box({ width: 10, height: 10 })
    const nested = box({ width: 8, height: 8 })
    const padded = new Padding({ left: 4 }).append(nested)
    const root = new HStack({ spacing: 5, alignment: 'top' }).append(leading, padded)

    layout(root)

    expect(rect(root)).toEqual({ x: 0, y: 0, width: 27, height: 10 })
    expect(rect(padded)).toEqual({ x: 15, y: 0, width: 12, height: 8 })
    expect(rect(nested)).toEqual({ x: 4, y: 0, width: 8, height: 8 })
  })

  it('does not let background or overlay decorations affect measured size', () => {
    const backgroundContent = box({ width: 20, height: 10 })
    const backgroundDecoration = box({ width: 100, height: 80 })
    const overlayContent = box({ width: 20, height: 10 })
    const overlayDecoration = box({ width: 100, height: 80 })
    const withBackground = new Background().append(backgroundContent, backgroundDecoration)
    const withOverlay = new Overlay().append(overlayContent, overlayDecoration)

    layout(withBackground)
    layout(withOverlay)

    expect(rect(withBackground)).toEqual({ x: 0, y: 0, width: 20, height: 10 })
    expect(rect(withOverlay)).toEqual({ x: 0, y: 0, width: 20, height: 10 })
    expect(rect(backgroundContent)).toEqual({ x: 0, y: 0, width: 20, height: 10 })
    expect(rect(overlayContent)).toEqual({ x: 0, y: 0, width: 20, height: 10 })
    expect(rect(backgroundDecoration)).toEqual({ x: -40, y: -35, width: 100, height: 80 })
    expect(rect(overlayDecoration)).toEqual({ x: -40, y: -35, width: 100, height: 80 })
    expect(withBackground.children).toEqual([backgroundContent, backgroundDecoration])
    expect(withOverlay.children).toEqual([overlayContent, overlayDecoration])
  })

  it('writes rects on nodes and preserves graph metadata on nodes', () => {
    const content = box({ width: 20, height: 10 })
    const group = new VStack().append(content)
    const decoration = box({ width: 20, height: 10 })
    const root = new Background().append(group, decoration)
    const rootId = root.id

    const stats = layout(root)

    expect(stats.nodes).toBe(4)
    expect(root.id).toBe(rootId)
    expect(root.parent).toBe(null)
    expect(root.children).toEqual([group, decoration])
    expect(group.parent).toBe(root)
    expect(group.children).toEqual([content])
    expect(rect(group)).toEqual({ x: 0, y: 0, width: 20, height: 10 })
    expect(rect(root)).toEqual({ x: 0, y: 0, width: 20, height: 10 })
    expect(rect(content)).toEqual({ x: 0, y: 0, width: 20, height: 10 })
  })

  it('supports command-style custom layout placement', () => {
    class FlowLayout extends Layout {
      constructor() {
        super('flow')
      }

      override measureSelf({ children, proposal }: LayoutMeasureInput): Size {
        const sizes = children.map((child) => child.measure(proposal))
        return {
          width: sizes.reduce((sum, size) => sum + size.width, 0),
          height: sizes.reduce((max, size) => Math.max(max, size.height), 0),
        }
      }

      override placeChildren({ bounds, children, proposal }: LayoutPlaceInput): void {
        let x = bounds.x
        for (const child of children) {
          const size = child.measure(proposal)
          child.place({ x, y: bounds.y, width: size.width, height: size.height }, size)
          x += size.width
        }
      }
    }

    const first = box({ width: 10, height: 8 })
    const second = box({ width: 14, height: 12 })
    const custom = new FlowLayout().append(first, second)

    layout(custom)

    expect(rect(custom)).toEqual({ x: 0, y: 0, width: 24, height: 12 })
    expect(rect(first)).toEqual({ x: 0, y: 0, width: 10, height: 8 })
    expect(rect(second)).toEqual({ x: 10, y: 0, width: 14, height: 12 })
  })
})

describe('mutation and caching', () => {
  it('returns stats and updates node layout when properties change', () => {
    const first = box({ width: 10, height: 10 })
    const second = box({ width: 10, height: 10 })
    const row = new HStack({ spacing: 5 }).append(first, second)
    const onInvalidate = vi.fn()
    const engine = new LayoutEngine({ root: row, onInvalidate })

    const firstStats = engine.layout({})
    expect(firstStats.nodes).toBe(3)
    expect(rect(row)?.width).toBe(25)

    row.spacing = 20
    expect(onInvalidate).toHaveBeenLastCalledWith({ id: row.id, node: row, kind: 'measure', cause: 'spacing' })
    const secondStats = engine.layout({})
    expect(secondStats.nodes).toBe(3)
    expect(rect(row)?.width).toBe(40)
  })

  it('does not remeasure when only alignment changes', () => {
    const child = box({ width: 10, height: 10 })
    const row = new HStack({ spacing: 5, alignment: 'top' }).append(child, new Spacer())
    const engine = new LayoutEngine({ root: row })

    engine.layout({ height: 30 })
    row.alignment = 'bottom'
    const stats = engine.layout({ height: 30 })

    expect(stats.measureCalls).toBe(0)
    expect(rect(child)).toEqual({ x: 0, y: 20, width: 10, height: 10 })
  })

  it('lets custom subclass props choose measure or placement invalidation', () => {
    type OffsetRowProps = {
      gap: number
      yOffset: number
    }

    class OffsetRow extends Layout {
      private _props: OffsetRowProps

      constructor(props: OffsetRowProps) {
        super('offset-row')
        this._props = props
      }

      get props(): OffsetRowProps {
        return this._props
      }

      set props(value: OffsetRowProps) {
        if (Object.is(this._props, value)) return
        const previous = this._props
        this._props = value
        if (previous.gap !== value.gap) {
          this.markMeasureDirty('gap')
        } else if (previous.yOffset !== value.yOffset) {
          this.markPlacementDirty('yOffset')
        }
      }

      override measureSelf({ children, proposal }: LayoutMeasureInput): Size {
        const sizes = children.map((child) => child.measure(proposal))
        return {
          width: sizes.reduce((sum, size) => sum + size.width, 0) + this._props.gap,
          height: sizes.reduce((max, size) => Math.max(max, size.height), 0),
        }
      }

      override placeChildren({ children, proposal }: LayoutPlaceInput): void {
        let x = 0
        for (const child of children) {
          const size = child.measure(proposal)
          child.place({ x, y: this._props.yOffset, width: size.width, height: size.height }, size)
          x += size.width + this._props.gap
        }
      }
    }

    const first = box({ width: 10, height: 10 })
    const second = box({ width: 10, height: 10 })
    const row = new OffsetRow({ gap: 5, yOffset: 0 }).append(first, second)
    const onInvalidate = vi.fn()
    const engine = new LayoutEngine({ root: row, onInvalidate })

    engine.layout({})
    row.props = { gap: 5, yOffset: 4 }
    const placementStats = engine.layout({})
    expect(onInvalidate).toHaveBeenLastCalledWith({ id: row.id, node: row, kind: 'placement', cause: 'yOffset' })
    expect(placementStats.measureCalls).toBe(0)
    expect(rect(first)).toEqual({ x: 0, y: 4, width: 10, height: 10 })

    row.props = { gap: 8, yOffset: 4 }
    const measureStats = engine.layout({})
    expect(onInvalidate).toHaveBeenLastCalledWith({ id: row.id, node: row, kind: 'measure', cause: 'gap' })
    expect(measureStats.measureCalls).toBeGreaterThan(0)
    expect(rect(row)?.width).toBe(28)
  })

  it('invalidates leaf and ancestors from measure keys and explicit invalidation', () => {
    let measured = 0
    const child = new TestLeaf(
      () => {
        measured += 1
        return { width: measured, height: 10 }
      },
    )
    const root = new HStack().append(child)
    const onInvalidate = vi.fn()
    const engine = new LayoutEngine({ root, onInvalidate })

    engine.layout({})
    expect(rect(root)?.width).toBe(1)
    expect(engine.layout({}).measureCalls).toBe(0)

    child.measureKey = 'next'
    expect(onInvalidate).toHaveBeenLastCalledWith({ id: child.id, node: child, kind: 'measure', cause: 'measureKey' })
    engine.layout({})
    expect(rect(root)?.width).toBe(2)

    child.invalidateMeasure('manual')
    expect(onInvalidate).toHaveBeenLastCalledWith({ id: child.id, node: child, kind: 'measure', cause: 'manual' })
    engine.layout({})
    expect(rect(root)?.width).toBe(3)
  })

  it('uses DOM-like reparenting semantics', () => {
    const child = box({ width: 10, height: 10 })
    const first = new HStack().append(child)
    const second = new VStack()

    second.append(child)

    expect(first.children).toHaveLength(0)
    expect(second.children).toEqual([child])
    expect(child.parent).toBe(second)
  })

  it('supports append, prepend, insertBefore, replaceChildren, remove, and dispose', () => {
    const first = box({ width: 1, height: 1 })
    const second = box({ width: 1, height: 1 })
    const third = box({ width: 1, height: 1 })
    const root = new HStack()

    expect(root.append(second)).toBe(root)
    expect(root.prepend(first)).toBe(root)
    expect(root.insertBefore(third, second)).toBe(root)
    expect(root.children).toEqual([first, third, second])

    third.remove()
    expect(root.children).toEqual([first, second])
    expect(third.parent).toBe(null)

    expect(root.replaceChildren(third)).toBe(root)
    expect(first.parent).toBe(null)
    expect(second.parent).toBe(null)
    expect(root.children).toEqual([third])

    root.dispose()
    expect(root.parent).toBe(null)
    expect(third.parent).toBe(null)
  })

  it('emits structure invalidations and updates layout activity for changed children', () => {
    const onInvalidate = vi.fn()
    const onActive = vi.fn()
    const onInactive = vi.fn()
    class ActiveLeaf extends TestLeaf {
      protected override onLayoutActive(): void {
        onActive()
      }

      protected override onLayoutInactive(): void {
        onInactive()
      }
    }
    const root = new HStack()
    const child = new ActiveLeaf(() => ({ width: 1, height: 1 }))
    const engine = new LayoutEngine({ root, onInvalidate })

    expect(child.isLayoutActive()).toBe(false)
    root.append(child)
    expect(onInvalidate).toHaveBeenLastCalledWith({ id: root.id, node: root, kind: 'structure', cause: 'children' })
    expect(child.isLayoutActive()).toBe(true)
    expect(onActive).toHaveBeenCalledTimes(1)

    child.remove()
    expect(onInvalidate).toHaveBeenLastCalledWith({ id: root.id, node: root, kind: 'structure', cause: 'children' })
    expect(child.isLayoutActive()).toBe(false)
    expect(onInactive).toHaveBeenCalledTimes(1)

    engine.dispose()
  })

  it('keeps shared roots active until the last engine detaches', () => {
    const onActive = vi.fn()
    const onInactive = vi.fn()
    class ActiveLeaf extends TestLeaf {
      protected override onLayoutActive(): void {
        onActive()
      }

      protected override onLayoutInactive(): void {
        onInactive()
      }
    }
    const root = new ActiveLeaf(() => ({ width: 1, height: 1 }))
    const first = new LayoutEngine({ root })
    const second = new LayoutEngine({ root })

    expect(root.isLayoutActive()).toBe(true)
    expect(onActive).toHaveBeenCalledTimes(1)

    first.dispose()
    expect(root.isLayoutActive()).toBe(true)
    expect(onInactive).not.toHaveBeenCalled()

    second.dispose()
    expect(root.isLayoutActive()).toBe(false)
    expect(onInactive).toHaveBeenCalledTimes(1)
  })

  it('caps measurement cache growth for highly variable layouts', () => {
    const engine = new LayoutEngine({ root: box({ width: 10, height: 10 }), maxCachedMeasurements: 4 })

    for (let width = 1; width <= 10; width += 1) {
      engine.layout({ width })
    }

    expect(engine.layout({ width: 11 }).cacheMisses).toBeGreaterThan(0)
  })

  it('can disable measurement caching', () => {
    const engine = new LayoutEngine({
      root: new HStack().append(box({ width: 10, height: 10 }), box({ width: 10, height: 10 })),
      maxCachedMeasurements: 0,
    })

    const first = engine.layout({ width: 100 })
    const second = engine.layout({ width: 100 })

    expect(first.cacheHits).toBe(0)
    expect(second.cacheHits).toBe(0)
    expect(second.measureCalls).toBe(first.measureCalls)
  })
})
