import { Container, Scene } from '../scene'
import { DomContentSync } from './dom-content-sync'
import { GPU_TEXTURE_USAGE } from './gpu-constants'
import { clearRenderTarget } from './gpu-pass'
import { copyTextureRegion, createRenderTarget } from './gpu-targets'
import {
  getHtmlHostOrder,
  getLayerContainers,
  getSortedSceneLayers,
} from './scene-order'
import { PointerController } from './pointer-controller'
import {
  WebGpuGlassCore,
  resolveSpecularWidthPx,
  type WebGpuGlassCoreRenderOptions,
  type WebGpuGlassCoreInit,
} from './core'
import { WebGpuDomContentSource, type WebGpuDomContentSourceInit } from './dom-content-source'
import type { WebGpuGlassContentSource } from './content-source'

export {
  WebGpuGlassCore,
  WebGpuDomContentSource,
  resolveSpecularWidthPx,
  type WebGpuGlassCoreInit,
  type WebGpuGlassCoreRenderOptions,
  type WebGpuGlassContentSource,
  type WebGpuDomContentSourceInit,
}

/**
 * Constructor options for {@link Renderer}.
 */
type RendererInit = {
  /** Scene to render. If omitted, a new empty scene is created. */
  scene?: Scene
  /** Maximum device pixel ratio used for internal render targets. Defaults to `2`. */
  maxDpr?: number
}

/**
 * Imperative WebGPU renderer for a liquid-glass scene graph.
 *
 * The renderer owns a canvas and a DOM subtree root that is copied into GPU
 * textures. Rendering itself is delegated to {@link WebGpuGlassCore}, which can
 * also be hosted by non-DOM renderers.
 */
export class Renderer {
  /** Scene currently rendered by this renderer. */
  readonly scene: Scene
  /** Canvas element that presents the rendered output. */
  readonly canvas: HTMLCanvasElement
  /** Maximum device pixel ratio used for internal render targets. */
  maxDpr: number

  private readonly targetCanvas: HTMLCanvasElement
  private readonly domContent: DomContentSync
  private readonly pointerController: PointerController

  private unsubscribeSceneMutations: (() => void) | null = null
  private initError: unknown = null
  private destroyed = false
  private initialized = false
  private pendingSceneContentSync = true
  private sceneContentSyncQueued = false
  private currentDpr = 1
  private resizeObserver: ResizeObserver | null = null

  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private presentationFormat: GPUTextureFormat | null = null
  private core: WebGpuGlassCore | null = null
  private canvasConfigured = false
  private lastFrameTexture: GPUTexture | null = null

  /** Handles canvas paint events by copying managed DOM content into GPU textures. */
  private readonly handlePaintEvent = (event: Event) => {
    if (this.destroyed || !this.core) {
      return
    }

    this.domContent.handlePaintEvent(event)
  }

  /** Marks scene-derived DOM and interaction state as dirty after scene mutations. */
  private readonly handleSceneMutation = () => {
    this.queueSceneContentSync()
  }

  /**
   * Creates a renderer and begins asynchronous WebGPU initialization immediately.
   */
  constructor(options: RendererInit = {}) {
    this.scene = options.scene ?? new Scene()
    this.maxDpr = options.maxDpr ?? 2
    this.targetCanvas = document.createElement('canvas')
    this.targetCanvas.setAttribute('layoutsubtree', 'true')
    this.targetCanvas.style.display = 'block'
    this.domContent = new DomContentSync({
      targetCanvas: this.targetCanvas,
      getCurrentDpr: () => this.currentDpr,
    })
    this.pointerController = new PointerController({
      targetCanvas: this.targetCanvas,
      renderer: this,
      isDestroyed: () => this.destroyed,
      flushSceneContentSync: () => this.flushSceneContentSync(),
      getSceneHtmlHosts: () => this.domContent.sceneHtmlHosts,
      getGlassContentHosts: () => this.domContent.glassContentHosts,
    })

    this.targetCanvas.addEventListener('paint', this.handlePaintEvent as EventListener)
    this.targetCanvas.addEventListener('pointermove', this.pointerController.handlePointerMove, true)
    this.targetCanvas.addEventListener('pointerdown', this.pointerController.handlePointerDown, true)
    this.targetCanvas.addEventListener('pointerup', this.pointerController.handlePointerUp, true)
    this.targetCanvas.addEventListener('pointercancel', this.pointerController.handlePointerCancel, true)
    this.targetCanvas.addEventListener('pointerleave', this.pointerController.handlePointerLeave, true)
    this.unsubscribeSceneMutations = this.scene._subscribe(this.handleSceneMutation)

    this.canvas = this.targetCanvas
    void this.initialize().catch((error) => {
      this.initError = error
      console.error(error)
    })
  }

  /** Enables or disables cached backdrop metrics for a container. */
  setBackdropMetricsTracking(container: Container, enabled: boolean) {
    this.core?.setBackdropMetricsTracking(container, enabled)
  }

  /** Returns the latest completed cached backdrop metrics for a tracked container. */
  getBackdropMetrics(container: Container) {
    return this.core?.getBackdropMetrics(container) ?? null
  }

  /** Renders one frame if the renderer is initialized. */
  render() {
    if (this.destroyed) {
      return
    }

    if (this.initError) {
      throw this.initError
    }

    const layers = this.syncSceneNow()
    if (!this.initialized) {
      return
    }

    this.drawFrame(layers)
  }

  /** Tears down observers, event listeners, and GPU resources owned by this renderer. */
  destroy() {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.targetCanvas.removeEventListener('paint', this.handlePaintEvent as EventListener)
    this.targetCanvas.removeEventListener('pointermove', this.pointerController.handlePointerMove, true)
    this.targetCanvas.removeEventListener('pointerdown', this.pointerController.handlePointerDown, true)
    this.targetCanvas.removeEventListener('pointerup', this.pointerController.handlePointerUp, true)
    this.targetCanvas.removeEventListener('pointercancel', this.pointerController.handlePointerCancel, true)
    this.targetCanvas.removeEventListener('pointerleave', this.pointerController.handlePointerLeave, true)
    this.unsubscribeSceneMutations?.()
    this.unsubscribeSceneMutations = null
    this.resizeObserver?.disconnect()
    this.core?.destroy()
    this.core = null
    this.lastFrameTexture?.destroy()
    this.lastFrameTexture = null
    this.domContent.destroy()
    this.pointerController.clear()
  }

  /** Creates WebGPU resources and pipelines needed by the renderer. */
  private async initialize() {
    const gpuNavigator = navigator as Navigator & { gpu?: GPU }
    if (!gpuNavigator.gpu) {
      throw new Error('WebGPU is not available in this browser.')
    }

    const adapter = await gpuNavigator.gpu.requestAdapter()
    if (!adapter) {
      throw new Error('No compatible GPU adapter was returned.')
    }

    const device = await adapter.requestDevice()
    const context = this.targetCanvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) {
      throw new Error('Unable to acquire a WebGPU canvas context.')
    }

    const presentationFormat = gpuNavigator.gpu.getPreferredCanvasFormat()
    this.device = device
    this.context = context
    this.presentationFormat = presentationFormat
    this.core = new WebGpuGlassCore({ device, format: presentationFormat })
    this.domContent.setDevice(device, presentationFormat)
    this.initialized = true
    this.syncCanvasSize()

    this.resizeObserver = new ResizeObserver(() => {
      this.syncCanvasSize()
    })
    this.resizeObserver.observe(this.targetCanvas)
    this.queueSceneContentSync()
  }

  /** Synchronizes canvas/backing texture dimensions with CSS size and DPR. */
  private syncCanvasSize() {
    if (!this.device || !this.context || !this.presentationFormat) {
      return
    }

    const bounds = this.targetCanvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr)
    const nextWidth = Math.max(1, Math.round(bounds.width * dpr))
    const nextHeight = Math.max(1, Math.round(bounds.height * dpr))

    this.currentDpr = dpr

    if (
      !this.canvasConfigured ||
      this.targetCanvas.width !== nextWidth ||
      this.targetCanvas.height !== nextHeight
    ) {
      const previousLastFrame = this.lastFrameTexture
      const previousWidth = this.targetCanvas.width
      const previousHeight = this.targetCanvas.height
      this.targetCanvas.width = nextWidth
      this.targetCanvas.height = nextHeight
      this.context.configure({
        device: this.device,
        format: this.presentationFormat,
        usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC | GPU_TEXTURE_USAGE.COPY_DST,
        alphaMode: 'opaque',
      })
      this.canvasConfigured = true
      this.lastFrameTexture = createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight)
      this.preservePreviousFrameAfterResize(previousLastFrame, previousWidth, previousHeight)
      previousLastFrame?.destroy()
    }

    this.syncSceneNow()
  }

  /** Paints the previous completed frame into the newly configured canvas target. */
  private preservePreviousFrameAfterResize(previousFrame: GPUTexture | null, previousWidth: number, previousHeight: number) {
    if (
      !previousFrame ||
      !this.device ||
      !this.context ||
      !this.lastFrameTexture ||
      previousWidth <= 0 ||
      previousHeight <= 0
    ) {
      return
    }

    const copyWidth = Math.min(previousWidth, this.targetCanvas.width)
    const copyHeight = Math.min(previousHeight, this.targetCanvas.height)
    const encoder = this.device.createCommandEncoder()
    const currentTexture = this.context.getCurrentTexture()
    const region = {
      sourceX: 0,
      sourceY: 0,
      destinationX: 0,
      destinationY: 0,
      width: copyWidth,
      height: copyHeight,
    }

    clearRenderTarget(encoder, this.lastFrameTexture)
    clearRenderTarget(encoder, currentTexture)
    copyTextureRegion(encoder, previousFrame, this.lastFrameTexture, region)
    copyTextureRegion(encoder, previousFrame, currentTexture, region)
    this.device.queue.submit([encoder.finish()])
  }

  /** Queues scene-derived DOM and pointer state synchronization on a microtask. */
  private queueSceneContentSync() {
    this.pendingSceneContentSync = true

    if (this.sceneContentSyncQueued || this.destroyed) {
      return
    }

    this.sceneContentSyncQueued = true
    queueMicrotask(() => {
      this.sceneContentSyncQueued = false

      if (this.destroyed || !this.pendingSceneContentSync) {
        return
      }

      this.syncSceneNow()
    })
  }

  /** Immediately synchronizes scene-derived DOM, content, and pointer caches. */
  private syncSceneNow() {
    const layers = getSortedSceneLayers(this.scene)
    const containers = getLayerContainers(layers)
    const hostOrder = getHtmlHostOrder(layers)

    this.pointerController.syncInteractions(containers)
    this.domContent.sync(layers, containers, hostOrder)

    this.pendingSceneContentSync = false
    return layers
  }

  /** Flushes any queued scene content synchronization before pointer work. */
  private flushSceneContentSync() {
    if (this.pendingSceneContentSync) {
      this.syncSceneNow()
    }
  }

  /** Draws a complete frame for the provided sorted scene layers. */
  private drawFrame(layers = getSortedSceneLayers(this.scene)) {
    if (
      this.destroyed ||
      !this.context ||
      !this.core ||
      !this.device ||
      !this.lastFrameTexture ||
      this.targetCanvas.width <= 0 ||
      this.targetCanvas.height <= 0
    ) {
      return
    }

    this.core.render({
      layers,
      width: this.targetCanvas.width,
      height: this.targetCanvas.height,
      dpr: this.currentDpr,
      outputTexture: this.lastFrameTexture,
      contentSource: this.domContent,
    })

    const encoder = this.device.createCommandEncoder()
    copyTextureRegion(encoder, this.lastFrameTexture, this.context.getCurrentTexture(), {
      sourceX: 0,
      sourceY: 0,
      destinationX: 0,
      destinationY: 0,
      width: this.targetCanvas.width,
      height: this.targetCanvas.height,
    })
    this.device.queue.submit([encoder.finish()])
  }
}
