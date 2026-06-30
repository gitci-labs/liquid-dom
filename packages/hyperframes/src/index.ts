import { Renderer, Scene } from '@liquid-dom/core'

export type HyperFramesTimelineLike = {
  time?: () => number
  eventCallback?: (type: string, callback?: ((...args: unknown[]) => void) | null) => unknown
}

export type LiquidRendererLike = {
  canvas: HTMLElement & Partial<HTMLCanvasElement>
  ready?: Promise<unknown>
  render: () => void
  destroy?: () => void
}

export type HyperFramesLiquidFrame = {
  controller: HyperFramesLiquidController
  mode: HyperFramesLiquidMode
  renderer: LiquidRendererLike
  time: number
}

export type HyperFramesLiquidMode = 'webgpu' | 'fallback'

export type HyperFramesLiquidControllerInit = {
  renderer: LiquidRendererLike
  fallbackRenderer?: LiquidRendererLike | (() => LiquidRendererLike)
  mount?: HTMLElement
  width?: number
  height?: number
  timeline?: HyperFramesTimelineLike | null
  initialTime?: number
  className?: string
  readyAttribute?: string
  mode?: HyperFramesLiquidMode
  renderOnReady?: boolean
  onFallback?: (error: unknown) => void
  onFrame?: (frame: HyperFramesLiquidFrame) => void
  onError?: (error: unknown) => void
}

export type HyperFramesLiquidRendererInit = Omit<HyperFramesLiquidControllerInit, 'mode' | 'renderer'> & {
  scene?: Scene
  maxDpr?: number
  fallback?: boolean
  fallbackElement?: HTMLElement | (() => HTMLElement)
}

type TimelineRestore = () => void

function currentTimelineTime(timeline: HyperFramesTimelineLike | null | undefined) {
  return timeline?.time?.() ?? 0
}

function hasNavigatorGpu() {
  return Boolean((globalThis.navigator as (Navigator & { gpu?: GPU }) | undefined)?.gpu)
}

function applyCanvasSizing(canvas: HTMLElement & Partial<HTMLCanvasElement>, width?: number, height?: number) {
  canvas.style.display = 'block'
  canvas.style.position ||= 'absolute'
  canvas.style.inset ||= '0'
  canvas.style.pointerEvents ||= 'none'

  if (width !== undefined) {
    canvas.style.width = `${width}px`
    if ('width' in canvas) {
      canvas.width = width
    }
  } else {
    canvas.style.width ||= '100%'
  }

  if (height !== undefined) {
    canvas.style.height = `${height}px`
    if ('height' in canvas) {
      canvas.height = height
    }
  } else {
    canvas.style.height ||= '100%'
  }

  canvas.setAttribute('data-liquid-dom-hyperframes-canvas', '')
  canvas.setAttribute('data-layout-ignore', '')
}

function appendCanvas(mount: HTMLElement | undefined, canvas: HTMLElement) {
  if (mount && canvas.parentElement !== mount) {
    mount.append(canvas)
  }
}

function chainTimelineCallback(
  timeline: HyperFramesTimelineLike,
  eventName: string,
  callback: () => void,
): TimelineRestore {
  const eventCallback = timeline.eventCallback
  if (!eventCallback) {
    return () => {}
  }

  const previous = eventCallback.call(timeline, eventName) as ((...args: unknown[]) => void) | undefined
  eventCallback.call(timeline, eventName, (...args: unknown[]) => {
    previous?.apply(timeline, args)
    callback()
  })

  return () => {
    eventCallback.call(timeline, eventName, previous ?? null)
  }
}

export function hasHyperFramesWebGpuSupport() {
  return hasNavigatorGpu()
}

export class HyperFramesLiquidController {
  renderer: LiquidRendererLike
  readonly ready: Promise<HyperFramesLiquidController>
  mode: HyperFramesLiquidMode

  private readonly fallbackRenderer?: LiquidRendererLike | (() => LiquidRendererLike)
  private readonly mount?: HTMLElement
  private readonly width?: number
  private readonly height?: number
  private readonly className?: string
  private readonly timeline?: HyperFramesTimelineLike | null
  private readonly readyAttribute: string
  private readonly onFallback?: (error: unknown) => void
  private readonly onFrame?: (frame: HyperFramesLiquidFrame) => void
  private readonly onError?: (error: unknown) => void
  private readonly renderOnReady: boolean
  private timelineRestores: TimelineRestore[] = []
  private destroyed = false
  private readyForFrames = false
  private pendingRenderTime: number | null = null

  constructor(options: HyperFramesLiquidControllerInit) {
    this.renderer = options.renderer
    this.fallbackRenderer = options.fallbackRenderer
    this.mount = options.mount
    this.width = options.width
    this.height = options.height
    this.className = options.className
    this.timeline = options.timeline
    this.mode = options.mode ?? 'webgpu'
    this.readyAttribute = options.readyAttribute ?? 'data-liquid-dom-ready'
    this.onFallback = options.onFallback
    this.onFrame = options.onFrame
    this.onError = options.onError
    this.renderOnReady = options.renderOnReady ?? true

    this.mountRenderer(this.renderer)
    this.connectTimeline(this.timeline)

    const initialTime = options.initialTime ?? currentTimelineTime(this.timeline)
    this.pendingRenderTime = initialTime
    this.ready = this.bootstrap()
  }

  renderAt(time = currentTimelineTime(this.timeline)) {
    if (this.destroyed) {
      return
    }

    if (!this.readyForFrames) {
      this.pendingRenderTime = time
      return
    }

    this.onFrame?.({
      controller: this,
      mode: this.mode,
      renderer: this.renderer,
      time,
    })
    this.renderer.render()
  }

  destroy() {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    for (const restore of this.timelineRestores.splice(0)) {
      restore()
    }
    this.renderer.destroy?.()
    this.renderer.canvas.remove()
  }

  private async bootstrap() {
    try {
      await this.renderer.ready
      return this.finishReady()
    } catch (error) {
      if (this.fallbackRenderer && !this.destroyed) {
        this.onFallback?.(error)
        this.useFallbackRenderer()
        await this.renderer.ready
        return this.finishReady()
      }
      this.onError?.(error)
      throw error
    }
  }

  private finishReady() {
    if (this.destroyed) {
      return this
    }
    this.readyForFrames = true
    this.mount?.setAttribute(this.readyAttribute, this.mode)
    if (this.renderOnReady) {
      this.renderAt(this.pendingRenderTime ?? currentTimelineTime(this.timeline))
    }
    return this
  }

  private mountRenderer(renderer: LiquidRendererLike) {
    applyCanvasSizing(renderer.canvas, this.width, this.height)
    if (this.className) {
      renderer.canvas.classList.add(this.className)
    }
    appendCanvas(this.mount, renderer.canvas)
  }

  private useFallbackRenderer() {
    const previous = this.renderer
    const fallback = typeof this.fallbackRenderer === 'function'
      ? this.fallbackRenderer()
      : this.fallbackRenderer
    if (!fallback) {
      return
    }

    previous.destroy?.()
    previous.canvas.remove()
    this.renderer = fallback
    this.mode = 'fallback'
    this.mountRenderer(this.renderer)
  }

  private connectTimeline(timeline: HyperFramesTimelineLike | null | undefined) {
    if (!timeline?.eventCallback) {
      return
    }

    const renderFromTimeline = () => this.renderAt(currentTimelineTime(timeline))
    this.timelineRestores.push(
      chainTimelineCallback(timeline, 'onStart', renderFromTimeline),
      chainTimelineCallback(timeline, 'onUpdate', renderFromTimeline),
      chainTimelineCallback(timeline, 'onComplete', renderFromTimeline),
      chainTimelineCallback(timeline, 'onReverseComplete', renderFromTimeline),
    )
  }
}

class CssFallbackLiquidRenderer implements LiquidRendererLike {
  readonly canvas: HTMLElement & Partial<HTMLCanvasElement>
  readonly ready = Promise.resolve()

  constructor(element?: HTMLElement | (() => HTMLElement)) {
    this.canvas = (typeof element === 'function' ? element() : element ?? createDefaultFallbackElement()) as HTMLElement & Partial<HTMLCanvasElement>
    this.canvas.setAttribute('data-liquid-dom-fallback', '')
  }

  render() {}
  destroy() {}
}

export function createDefaultFallbackElement() {
  const element = document.createElement('div')
  element.className = 'liquid-dom-hyperframes-fallback'
  element.style.position = 'absolute'
  element.style.inset = '0'
  element.style.pointerEvents = 'none'
  element.style.overflow = 'hidden'
  return element
}

export function createHyperFramesLiquidRenderer(options: HyperFramesLiquidRendererInit) {
  const canUseWebGpu = hasHyperFramesWebGpuSupport()
  const fallbackRenderer = options.fallback === false
    ? undefined
    : () => new CssFallbackLiquidRenderer(options.fallbackElement)

  if (!canUseWebGpu && options.fallback !== false) {
    return new HyperFramesLiquidController({
      ...options,
      mode: 'fallback',
      renderer: fallbackRenderer?.() ?? new CssFallbackLiquidRenderer(options.fallbackElement),
    })
  }

  return new HyperFramesLiquidController({
    ...options,
    mode: 'webgpu',
    fallbackRenderer,
    renderer: new Renderer({
      scene: options.scene,
      maxDpr: options.maxDpr,
      logInitializationErrors: false,
    }),
  })
}
