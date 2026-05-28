import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutEngine, Frame, HStack } from '../src/index'
import { DomLeaf, measureDomElement } from '../src/dom'

type ResizeObserverCallbackLike = (entries?: ResizeObserverEntry[]) => void

const resizeCallbacks: ResizeObserverCallbackLike[] = []
const resizeObservers: FakeResizeObserver[] = []
const originalResizeObserver = globalThis.ResizeObserver

class FakeResizeObserver {
  readonly callback: ResizeObserverCallbackLike

  constructor(callback: ResizeObserverCallbackLike) {
    this.callback = callback
    resizeCallbacks.push(callback)
    resizeObservers.push(this)
  }

  observe = vi.fn()
  disconnect = vi.fn()
}

describe('dom adapter', () => {
  beforeEach(() => {
    resizeCallbacks.splice(0)
    resizeObservers.splice(0)
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
    mockCloneIntrinsicSizes()
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
    document.body.replaceChildren()
  })

  it('measures HTMLElement border boxes and writes node geometry', () => {
    const first = elementWithSize(30, 20)
    const second = elementWithSize(40, 10)
    document.body.append(first, second)
    const firstNode = new DomLeaf({ element: first })
    const secondNode = new DomLeaf({ element: second })
    const root = new HStack({ spacing: 5, alignment: 'top' }).append(firstNode, secondNode)
    const engine = new LayoutEngine({ root })

    const stats = engine.layout({})

    expect(stats.nodes).toBe(3)
    expect(root.layout?.rect).toEqual({ x: 0, y: 0, width: 75, height: 20 })
    expect(firstNode.layout?.rect).toEqual({ x: 0, y: 0, width: 30, height: 20 })
    expect(secondNode.layout?.rect).toEqual({ x: 35, y: 0, width: 40, height: 10 })
  })

  it('measures through clones without mutating live elements', () => {
    const element = document.createElement('div')
    element.style.width = '72px'
    element.style.height = '24px'
    document.body.append(element)
    const node = new DomLeaf({ element })
    const engine = new LayoutEngine({ root: node })

    engine.layout({})

    expect(node.layout?.rect).toEqual({ x: 0, y: 0, width: 72, height: 24 })
    expect(element.style.position).toBe('')
    expect(element.style.transform).toBe('')
    expect(element.style.boxSizing).toBe('')
  })

  it('starts observing only after becoming reachable from an engine root', () => {
    const element = elementWithSize(30, 20)
    const node = new DomLeaf({ element })

    expect(resizeCallbacks).toHaveLength(0)
    const engine = new LayoutEngine({ root: node })

    expect(resizeCallbacks).toHaveLength(1)
    expect(resizeObservers[0]?.observe).toHaveBeenCalledWith(element)
    engine.dispose()
    expect(resizeObservers[0]?.disconnect).toHaveBeenCalledTimes(1)
  })

  it('uses ResizeObserver invalidation for intrinsic DOM size changes', () => {
    const element = elementWithSize(30, 20)
    const onInvalidate = vi.fn()
    const leafNode = new DomLeaf({ element })
    const engine = new LayoutEngine({ root: leafNode, onInvalidate })
    engine.layout({})

    resizeCallbacks[0]?.([resizeEntry(42, 24)])

    expect(onInvalidate).toHaveBeenCalledWith({ id: leafNode.id, node: leafNode, kind: 'measure', cause: 'resize' })
    expect(engine.getDebugStats().invalidations).toBe(1)
  })

  it('does not observe leaves in detached subtrees', () => {
    const element = elementWithSize(30, 20)
    const node = new DomLeaf({ element })
    const detached = new HStack().append(node)
    const root = new HStack()
    const engine = new LayoutEngine({ root })

    expect(resizeCallbacks).toHaveLength(0)

    root.append(detached)
    expect(resizeCallbacks).toHaveLength(1)
    expect(node.isLayoutActive()).toBe(true)

    detached.remove()
    expect(node.isLayoutActive()).toBe(false)
    expect(resizeObservers[0]?.disconnect).toHaveBeenCalledTimes(1)

    engine.dispose()
  })

  it('resubscribes when the observed element changes while active', () => {
    const first = elementWithSize(30, 20)
    const second = elementWithSize(40, 24)
    const node = new DomLeaf({ element: first })
    const engine = new LayoutEngine({ root: node })

    expect(resizeObservers[0]?.observe).toHaveBeenCalledWith(first)
    node.element = second

    expect(resizeObservers[0]?.disconnect).toHaveBeenCalledTimes(1)
    expect(resizeObservers[1]?.observe).toHaveBeenCalledWith(second)

    engine.dispose()
  })

  it('disconnects observers when disposed', () => {
    const element = elementWithSize(30, 20)
    const node = new DomLeaf({ element })
    const engine = new LayoutEngine({ root: node })

    node.dispose()

    expect(resizeObservers[0]?.disconnect).toHaveBeenCalledTimes(1)
    expect(node.isLayoutActive()).toBe(false)
    engine.dispose()
  })

  it('supports constrained-width measurement', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const node = new DomLeaf({ element, sizing: 'constrained-width' })
    const root = new Frame({ width: 50 }).append(node)
    const engine = new LayoutEngine({ root })

    engine.layout({})

    expect(node.layout?.rect).toEqual({ x: 0, y: 0, width: 50, height: 80 })
    expect(element.style.width).toBe('')
  })

  it('supports fill measurement for proposed axes', () => {
    const element = document.createElement('div')
    element.textContent = 'long text'
    document.body.append(element)
    const node = new DomLeaf({ element, sizing: 'fill' })
    const root = new Frame({ width: 50, height: 70 }).append(node)
    const engine = new LayoutEngine({ root })

    engine.layout({})

    expect(node.layout?.rect).toEqual({ x: 0, y: 0, width: 50, height: 70 })
  })

  it('preserves stylesheet-authored widths when measuring replacement elements', () => {
    const element = document.createElement('div')
    element.className = 'replacement-card'
    element.innerHTML = '<strong>Replacement target</strong><p>Wrapped content</p>'

    const size = measureDomElement(element)

    expect(size).toEqual({ width: 180, height: 95 })
  })

  it('preserves stylesheet-authored widths for unconstrained constrained-width measurement', () => {
    const element = document.createElement('div')
    element.className = 'replacement-card'
    element.innerHTML = '<strong>Replacement target</strong><p>Wrapped content</p>'

    const size = measureDomElement(element, {}, { sizing: 'constrained-width' })

    expect(size).toEqual({ width: 180, height: 95 })
  })

  it('remeasures constrained-width leaves when text content shrinks', () => {
    const element = document.createElement('div')
    element.textContent = 'long text'
    document.body.append(element)
    const node = new DomLeaf({ element, sizing: 'constrained-width' })
    const root = new Frame({ width: 50 }).append(node)
    const engine = new LayoutEngine({ root })

    engine.layout({})
    expect(node.layout?.rect.height).toBe(80)

    element.textContent = 'short'
    node.invalidateMeasure('content')
    engine.layout({})
    expect(node.layout?.rect.height).toBe(32)
  })
})

function elementWithSize(width: number, height: number) {
  const element = document.createElement('div')
  element.style.width = `${width}px`
  element.style.height = `${height}px`
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => null,
    }) as DOMRect
  return element
}

function mockCloneIntrinsicSizes() {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value() {
      const element = this as HTMLElement
      if (element.classList.contains('replacement-card')) {
        const maxContent = element.style.width === 'max-content'
        return rect(maxContent ? 360 : 180, maxContent ? 44 : 95)
      }
      return rect(0, 0)
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      const element = this as HTMLElement
      if (element.style.height === 'auto' && element.style.width === '50px') {
        return element.textContent === 'short' ? 32 : 80
      }
      return Number.parseFloat(element.style.height) || 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      const element = this as HTMLElement
      if (element.style.width === 'max-content') {
        return element.textContent === 'wide' ? 96 : 0
      }
      return Number.parseFloat(element.style.width) || 0
    },
  })
}

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => null,
  } as DOMRect
}

function resizeEntry(width: number, height: number): ResizeObserverEntry {
  return {
    contentRect: {
      width,
      height,
    },
  } as ResizeObserverEntry
}
