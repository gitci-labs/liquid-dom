import { describe, expect, it, vi } from 'vitest'
import {
  HyperFramesLiquidController,
  hasHyperFramesWebGpuSupport,
  type HyperFramesTimelineLike,
  type LiquidRendererLike,
} from '../src'

type FakeElement = {
  classList: { add: ReturnType<typeof vi.fn> }
  parentElement: unknown
  remove: ReturnType<typeof vi.fn>
  setAttribute: ReturnType<typeof vi.fn>
  style: Record<string, string>
}

function fakeElement(): FakeElement {
  return {
    classList: { add: vi.fn() },
    parentElement: null,
    remove: vi.fn(),
    setAttribute: vi.fn(),
    style: {},
  }
}

function fakeRenderer(ready: Promise<unknown> = Promise.resolve()) {
  return {
    canvas: fakeElement() as unknown as LiquidRendererLike['canvas'],
    destroy: vi.fn(),
    ready,
    render: vi.fn(),
  }
}

function fakeTimeline(time = 0) {
  const callbacks = new Map<string, (...args: unknown[]) => void>()
  const timeline: HyperFramesTimelineLike & { fire: (name: string) => void; setTime: (next: number) => void } = {
    eventCallback(name, callback) {
      if (callback === undefined) return callbacks.get(name)
      if (callback === null) callbacks.delete(name)
      else callbacks.set(name, callback)
      return undefined
    },
    fire(name) {
      callbacks.get(name)?.()
    },
    setTime(next) {
      time = next
    },
    time: () => time,
  }
  return timeline
}

describe('HyperFramesLiquidController', () => {
  it('queues the latest render until the renderer is ready', async () => {
    let resolveReady!: () => void
    const renderer = fakeRenderer(new Promise<void>((resolve) => {
      resolveReady = resolve
    }))
    const onFrame = vi.fn()
    const controller = new HyperFramesLiquidController({ renderer, onFrame })

    controller.renderAt(1)
    controller.renderAt(2)
    expect(renderer.render).not.toHaveBeenCalled()

    resolveReady()
    await controller.ready

    expect(onFrame).toHaveBeenCalledTimes(1)
    expect(onFrame.mock.calls[0]?.[0].time).toBe(2)
    expect(renderer.render).toHaveBeenCalledTimes(1)
  })

  it('renders from GSAP-style timeline callbacks without replacing existing callbacks', async () => {
    const renderer = fakeRenderer()
    const timeline = fakeTimeline(0)
    const existing = vi.fn()
    timeline.eventCallback?.('onUpdate', existing)
    const onFrame = vi.fn()

    const controller = new HyperFramesLiquidController({ renderer, timeline, onFrame })
    await controller.ready
    timeline.setTime(3.5)
    timeline.fire('onUpdate')

    expect(existing).toHaveBeenCalledTimes(1)
    expect(onFrame.mock.calls.at(-1)?.[0].time).toBe(3.5)
    expect(renderer.render).toHaveBeenCalledTimes(2)
  })

  it('restores timeline callbacks and destroys the renderer', async () => {
    const renderer = fakeRenderer()
    const timeline = fakeTimeline(0)
    const existing = vi.fn()
    timeline.eventCallback?.('onComplete', existing)

    const controller = new HyperFramesLiquidController({ renderer, timeline })
    await controller.ready
    controller.destroy()
    timeline.fire('onComplete')

    expect(existing).toHaveBeenCalledTimes(1)
    expect(renderer.destroy).toHaveBeenCalledTimes(1)
    expect(renderer.canvas.remove).toHaveBeenCalledTimes(1)
  })

  it('falls back when WebGPU initialization fails after support detection', async () => {
    const initError = new Error('adapter unavailable')
    const renderer = fakeRenderer(Promise.reject(initError))
    const fallback = fakeRenderer()
    const onFallback = vi.fn()
    const onFrame = vi.fn()
    const controller = new HyperFramesLiquidController({
      renderer,
      fallbackRenderer: () => fallback,
      onFallback,
      onFrame,
    })

    controller.renderAt(4)
    await controller.ready

    expect(controller.mode).toBe('fallback')
    expect(controller.renderer).toBe(fallback)
    expect(onFallback).toHaveBeenCalledWith(initError)
    expect(renderer.destroy).toHaveBeenCalledTimes(1)
    expect(renderer.canvas.remove).toHaveBeenCalledTimes(1)
    expect(onFrame.mock.calls.at(-1)?.[0]).toMatchObject({ mode: 'fallback', time: 4 })
    expect(fallback.render).toHaveBeenCalledTimes(1)
  })

  it('rejects initialization errors when no fallback renderer is provided', async () => {
    const initError = new Error('webgpu unavailable')
    const renderer = fakeRenderer(Promise.reject(initError))
    const onError = vi.fn()
    const controller = new HyperFramesLiquidController({ renderer, onError })

    await expect(controller.ready).rejects.toThrow('webgpu unavailable')
    expect(onError).toHaveBeenCalledWith(initError)
  })
})

describe('hasHyperFramesWebGpuSupport', () => {
  it('reports whether navigator.gpu is present', () => {
    const originalNavigator = globalThis.navigator
    vi.stubGlobal('navigator', { gpu: {} })
    expect(hasHyperFramesWebGpuSupport()).toBe(true)
    vi.stubGlobal('navigator', {})
    expect(hasHyperFramesWebGpuSupport()).toBe(false)
    vi.stubGlobal('navigator', originalNavigator)
  })
})
