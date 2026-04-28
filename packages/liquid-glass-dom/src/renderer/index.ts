import {
  composeTransform,
  getMinimumScale,
  invertMatrix,
  multiplyMatrices,
  scaleOutputMatrix,
  transformPoint,
  type Matrix2D,
} from '../matrix'
import { BackdropMetricsTracker, type BackdropMetricsState } from './backdrop-metrics-state'
import {
  DomContentSync,
  getCopiedCssSize,
  getTextureUvScale,
  type SceneHtmlEntry,
} from './dom-content-sync'
import { GPU_BUFFER_USAGE, GPU_TEXTURE_USAGE } from './gpu-constants'
import {
  clearRenderTarget,
  createPipelineBindGroup,
  drawFullscreenPass,
  PingPongComposer,
} from './gpu-pass'
import {
  GpuStructArrayBuffer,
  GpuStructBuffer,
  type GpuStructDefinition,
} from './gpu-layout'
import {
  copyTextureRegion,
  createRenderTarget,
  destroyTargets,
  type RenderTargetSet,
} from './gpu-targets'
import {
  BACKDROP_METRICS_BYTES_PER_ROW,
  BACKDROP_METRICS_SIZE,
  createEmptyBounds,
  expandBounds,
  hasBounds,
  type BoundsRect,
} from './metrics'
import {
  BackdropMetricsBoundsLayout,
  BlurParamsLayout,
  GlobalsLayout,
  HtmlCompositeParamsLayout,
  ShapeDataLayout,
} from './shader-layouts'
import {
  getHtmlHostOrder,
  getLayerContainers,
  getSortedGlasses,
  getSortedSceneLayers,
} from './scene-order'
import { Container, Html, Scene } from '../scene'
import { BLUR_SHADER, GLASS_SHADER, HTML_COMPOSITE_SHADER, METRICS_SHADER } from '../shaders'
import { PointerController } from './pointer-controller'
import type { SurfaceProfile } from '../types'

/**
 * Constructor options for {@link Renderer}.
 */
type RendererInit = {
  /** Scene to render. If omitted, a new empty scene is created. */
  scene?: Scene
  /** Maximum device pixel ratio used for internal render targets. Defaults to `2`. */
  maxDpr?: number
}

type PackedShapesResult = {
  shapeCount: number
  bounds: BoundsRect | null
}

type GlobalsBuffer = GpuStructBuffer<GpuStructDefinition<typeof GlobalsLayout>>
type ShapeDataBuffer = GpuStructArrayBuffer<GpuStructDefinition<typeof ShapeDataLayout>>
type BlurParamsBuffer = GpuStructBuffer<GpuStructDefinition<typeof BlurParamsLayout>>
type BackdropMetricsBoundsBuffer = GpuStructBuffer<GpuStructDefinition<typeof BackdropMetricsBoundsLayout>>
type HtmlCompositeParamsBuffer = GpuStructBuffer<GpuStructDefinition<typeof HtmlCompositeParamsLayout>>

/** Maps a public surface profile string to the shader enum value. */
function getSurfaceProfileIndex(profile: SurfaceProfile) {
  if (profile === 'convex') {
    return 0
  }
  if (profile === 'concave') {
    return 1
  }
  return 2
}


/**
 * Imperative WebGPU renderer for a liquid-glass scene graph.
 *
 * The renderer owns a canvas and a DOM subtree root that is copied into a GPU
 * texture and used as the backdrop for blur, refraction, reflection, and glass tint.
 */
export class Renderer {
  /** Scene currently rendered by this renderer. */
  readonly scene: Scene
  /** Canvas element that presents the rendered output. */
  readonly canvas: HTMLCanvasElement
  /** Maximum device pixel ratio used for internal render targets. */
  maxDpr: number

  private readonly targetCanvas: HTMLCanvasElement
  private readonly backdropMetrics = new BackdropMetricsTracker(() => this.destroyed)
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
  private globalsBuffer: GlobalsBuffer | null = null
  private shapesBuffer: ShapeDataBuffer | null = null
  private blurHorizontalBuffer: BlurParamsBuffer | null = null
  private blurVerticalBuffer: BlurParamsBuffer | null = null
  private backdropMetricsBoundsBuffer: BackdropMetricsBoundsBuffer | null = null
  private htmlCompositeParamsBuffer: HtmlCompositeParamsBuffer | null = null
  private sampler: GPUSampler | null = null
  private blurPipeline: GPURenderPipeline | null = null
  private glassPipeline: GPURenderPipeline | null = null
  private htmlCompositePipeline: GPURenderPipeline | null = null
  private backdropMetricsPipeline: GPURenderPipeline | null = null
  private targets: RenderTargetSet | null = null
  private lastFrameTexture: GPUTexture | null = null
  private backdropMetricsTarget: GPUTexture | null = null

  /** Handles canvas paint events by copying managed DOM content into GPU textures. */
  private readonly handlePaintEvent = (event: Event) => {
    if (this.destroyed || !this.device || !this.targets) {
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

  /**
   * Enables or disables cached backdrop metrics for a container.
   */
  setBackdropMetricsTracking(container: Container, enabled: boolean) {
    this.backdropMetrics.setTracking(container, enabled)
  }

  /**
   * Returns the latest completed cached backdrop metrics for a tracked container.
   */
  getBackdropMetrics(container: Container) {
    return this.backdropMetrics.getMetrics(container)
  }

  /**
   * Renders one frame if the renderer is initialized and a backdrop snapshot is available.
   */
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

  /**
   * Tears down observers, event listeners, and GPU resources owned by this renderer.
   */
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
    destroyTargets(this.targets)
    this.targets = null
    this.lastFrameTexture?.destroy()
    this.lastFrameTexture = null
    this.backdropMetricsTarget?.destroy()
    this.backdropMetricsTarget = null
    this.globalsBuffer?.destroy()
    this.shapesBuffer?.destroy()
    this.blurHorizontalBuffer?.destroy()
    this.blurVerticalBuffer?.destroy()
    this.backdropMetricsBoundsBuffer?.destroy()
    this.htmlCompositeParamsBuffer?.destroy()
    this.backdropMetrics.destroy()
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
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    const uniformBufferUsage = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST

    const globalsBuffer = new GpuStructBuffer(device, GlobalsLayout, uniformBufferUsage)
    const blurHorizontalBuffer = new GpuStructBuffer(device, BlurParamsLayout, uniformBufferUsage)
    const blurVerticalBuffer = new GpuStructBuffer(device, BlurParamsLayout, uniformBufferUsage)
    const backdropMetricsBoundsBuffer = new GpuStructBuffer(device, BackdropMetricsBoundsLayout, uniformBufferUsage)
    const htmlCompositeParamsBuffer = new GpuStructBuffer(device, HtmlCompositeParamsLayout, uniformBufferUsage)

    const blurPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: BLUR_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: BLUR_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format: presentationFormat }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    const glassPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: GLASS_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: GLASS_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format: presentationFormat }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    const htmlCompositePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: HTML_COMPOSITE_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: HTML_COMPOSITE_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format: presentationFormat }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    const backdropMetricsPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: METRICS_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: METRICS_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    const backdropMetricsTarget = device.createTexture({
      size: {
        width: BACKDROP_METRICS_SIZE,
        height: BACKDROP_METRICS_SIZE,
        depthOrArrayLayers: 1,
      },
      format: 'rgba8unorm',
      usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC,
    })

    this.device = device
    this.context = context
    this.presentationFormat = presentationFormat
    this.sampler = sampler
    this.globalsBuffer = globalsBuffer
    this.blurHorizontalBuffer = blurHorizontalBuffer
    this.blurVerticalBuffer = blurVerticalBuffer
    this.backdropMetricsBoundsBuffer = backdropMetricsBoundsBuffer
    this.htmlCompositeParamsBuffer = htmlCompositeParamsBuffer
    this.blurPipeline = blurPipeline
    this.glassPipeline = glassPipeline
    this.htmlCompositePipeline = htmlCompositePipeline
    this.backdropMetricsPipeline = backdropMetricsPipeline
    this.backdropMetricsTarget = backdropMetricsTarget
    this.backdropMetrics.setDevice(device)
    this.domContent.setDevice(device, presentationFormat)
    this.initialized = true

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
      this.targetCanvas.width !== nextWidth ||
      this.targetCanvas.height !== nextHeight ||
      !this.targets
    ) {
      const previousLastFrame = this.lastFrameTexture
      const previousLastFrameWidth = this.targetCanvas.width
      const previousLastFrameHeight = this.targetCanvas.height

      this.targetCanvas.width = nextWidth
      this.targetCanvas.height = nextHeight
      destroyTargets(this.targets)
      this.targets = {
        blurPing: createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight),
        blur: createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight),
        sceneA: createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight),
        sceneB: createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight),
      }

      this.lastFrameTexture = createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight)

      this.context.configure({
        device: this.device,
        format: this.presentationFormat,
        usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_DST,
        alphaMode: 'opaque',
      })

      this.preservePreviousFrameAfterResize(previousLastFrame, previousLastFrameWidth, previousLastFrameHeight)
      previousLastFrame?.destroy()
    }

    this.syncSceneNow()
  }

  /** Ensures the shape storage buffer can hold the active glass count. */
  private ensureShapesBuffer(requiredCount: number) {
    if (!this.device) {
      return
    }

    if (!this.shapesBuffer) {
      this.shapesBuffer = new GpuStructArrayBuffer(
        this.device,
        ShapeDataLayout,
        GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
      )
    }

    this.shapesBuffer.ensureCapacity(requiredCount)
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

  /** Writes per-container global shader parameters. */
  private writeGlobals(container: Container, shapeCount: number) {
    if (!this.device || !this.globalsBuffer) {
      return
    }

    const width = this.targetCanvas.width
    const height = this.targetCanvas.height
    const dpr = this.currentDpr

    this.globalsBuffer.write({
      canvas: {
        width,
        height,
      },
      shape: {
        smoothing: container.spacing * dpr,
        bezelWidth: container.bezelWidth * dpr,
        shapeCount,
        surfaceProfile: getSurfaceProfileIndex(container.surfaceProfile),
      },
      glass: {
        thickness: container.thickness * dpr,
        displacementFactor: container.displacementFactor,
        ior: container.ior,
        dispersion: container.dispersion,
      },
      content: {
        ior: container.contentIor,
        depth: container.contentDepth * dpr,
      },
      lighting: {
        x: Math.sin(container.lightDirection),
        y: -Math.cos(container.lightDirection),
      },
      specular: {
        strength: container.specularStrength,
        width: container.specularWidth * dpr,
        sharpness: container.specularSharpness,
        opacity: container.specularOpacity,
      },
      specularSecondary: {
        oppositeStrength: container.oppositeSpecularStrength,
        falloff: container.specularFalloff,
        reflectionOffset: container.reflectionOffset * dpr,
      },
      tint: {
        r: container.tint.r,
        g: container.tint.g,
        b: container.tint.b,
        a: container.tint.a,
      },
    })
  }

  /** Writes blur direction and radius uniforms for a container. */
  private writeBlurParams(container: Container) {
    if (!this.device || !this.blurHorizontalBuffer || !this.blurVerticalBuffer) {
      return
    }

    const blurRadius = container.blur * this.currentDpr
    this.blurHorizontalBuffer.write({
      params: {
        directionX: 1,
        directionY: 0,
        radius: blurRadius,
      },
    })
    this.blurVerticalBuffer.write({
      params: {
        directionX: 0,
        directionY: 1,
        radius: blurRadius,
      },
    })
  }

  /** Writes the device-pixel bounds sampled by the backdrop metrics pass. */
  private writeBackdropMetricsBounds(bounds: BoundsRect) {
    if (!this.device || !this.backdropMetricsBoundsBuffer) {
      return
    }

    this.backdropMetricsBoundsBuffer.write({
      bounds: {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      },
    })
  }

  /** Packs visible glass shapes into the storage buffer and accumulates bounds. */
  private packShapes(container: Container, containerTransform: Matrix2D): PackedShapesResult {
    const dpr = this.currentDpr
    const glasses = getSortedGlasses(container)
    const bounds = createEmptyBounds()
    let activeCount = 0

    this.ensureShapesBuffer(glasses.length)
    const shapesBuffer = this.shapesBuffer

    for (const glass of glasses) {
      const worldCss = multiplyMatrices(containerTransform, composeTransform(glass))
      const worldDevice = scaleOutputMatrix(worldCss, dpr)
      const inverse = invertMatrix(worldDevice)
      if (!inverse) {
        continue
      }

      const topLeft = transformPoint(worldDevice, 0, 0)
      const topRight = transformPoint(worldDevice, glass.width, 0)
      const bottomLeft = transformPoint(worldDevice, 0, glass.height)
      const bottomRight = transformPoint(worldDevice, glass.width, glass.height)
      expandBounds(bounds, topLeft.x, topLeft.y)
      expandBounds(bounds, topRight.x, topRight.y)
      expandBounds(bounds, bottomLeft.x, bottomLeft.y)
      expandBounds(bounds, bottomRight.x, bottomRight.y)

      const contentRange = this.domContent.getGlassContentRange(glass)
      const halfWidth = glass.width * 0.5
      const halfHeight = glass.height * 0.5
      shapesBuffer?.writeAt(activeCount, {
        inverse0: {
          a: inverse.a,
          c: inverse.c,
          e: inverse.e,
          minimumScale: getMinimumScale(worldDevice),
        },
        inverse1: {
          b: inverse.b,
          d: inverse.d,
          f: inverse.f,
          cornerRadius: glass.cornerRadius,
        },
        geometry: {
          halfWidth,
          halfHeight,
          cornerTransitionSpeed: glass.cornerTransitionSpeed,
        },
        contentRange: {
          start: contentRange?.start ?? 0,
          count: contentRange?.count ?? 0,
        },
      })

      activeCount += 1
    }

    shapesBuffer?.upload(activeCount)

    return {
      shapeCount: activeCount,
      bounds: hasBounds(bounds) ? bounds : null,
    }
  }

  /** Runs the separable blur passes for one container backdrop. */
  private blurTexture(encoder: GPUCommandEncoder, source: GPUTexture, targetContainer: Container) {
    if (
      !this.device ||
      !this.sampler ||
      !this.blurPipeline ||
      !this.blurHorizontalBuffer ||
      !this.blurVerticalBuffer ||
      !this.targets
    ) {
      return
    }

    this.writeBlurParams(targetContainer)

    const horizontalBindGroup = createPipelineBindGroup(this.device, this.blurPipeline, [
      { binding: 0, resource: this.sampler },
      { binding: 1, resource: source.createView() },
      { binding: 2, resource: this.blurHorizontalBuffer.bindingResource },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.blurPipeline,
      bindGroup: horizontalBindGroup,
      target: this.targets.blurPing,
    })

    const verticalBindGroup = createPipelineBindGroup(this.device, this.blurPipeline, [
      { binding: 0, resource: this.sampler },
      { binding: 1, resource: this.targets.blurPing.createView() },
      { binding: 2, resource: this.blurVerticalBuffer.bindingResource },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.blurPipeline,
      bindGroup: verticalBindGroup,
      target: this.targets.blur,
    })
  }

  /** Renders and queues copy commands for one backdrop metrics target. */
  private renderBackdropMetrics(
    encoder: GPUCommandEncoder,
    state: BackdropMetricsState,
    bounds: BoundsRect | null,
  ) {
    if (
      !this.device ||
      !this.sampler ||
      !this.backdropMetricsPipeline ||
      !this.globalsBuffer ||
      !this.shapesBuffer?.buffer ||
      !this.backdropMetricsBoundsBuffer ||
      !this.backdropMetricsTarget ||
      !this.targets ||
      !bounds ||
      state.pendingReadback
    ) {
      if (!bounds && !state.pendingReadback) {
        state.metrics = null
      }
      return false
    }

    this.backdropMetrics.ensureResources(state)
    if (!state.readbackBuffer) {
      return false
    }

    this.writeBackdropMetricsBounds(bounds)

    const bindGroup = createPipelineBindGroup(this.device, this.backdropMetricsPipeline, [
      { binding: 0, resource: this.globalsBuffer.bindingResource },
      { binding: 1, resource: this.shapesBuffer.bindingResource },
      { binding: 2, resource: this.sampler },
      { binding: 3, resource: this.targets.blur.createView() },
      { binding: 4, resource: this.backdropMetricsBoundsBuffer.bindingResource },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.backdropMetricsPipeline,
      bindGroup,
      target: this.backdropMetricsTarget,
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    })

    encoder.copyTextureToBuffer(
      { texture: this.backdropMetricsTarget },
      {
        buffer: state.readbackBuffer,
        bytesPerRow: BACKDROP_METRICS_BYTES_PER_ROW,
        rowsPerImage: BACKDROP_METRICS_SIZE,
      },
      {
        width: BACKDROP_METRICS_SIZE,
        height: BACKDROP_METRICS_SIZE,
        depthOrArrayLayers: 1,
      },
    )

    return true
  }

  /** Renders one container's glass shapes over the current scene texture. */
  private renderContainer(
    encoder: GPUCommandEncoder,
    sharpSource: GPUTexture,
    target: GPUTexture,
  ) {
    if (
      !this.device ||
      !this.sampler ||
      !this.glassPipeline ||
      !this.globalsBuffer ||
      !this.shapesBuffer?.buffer ||
      !this.targets
    ) {
      return
    }

    const contentEntriesBindingResource = this.domContent.contentEntriesBindingResource
    if (!contentEntriesBindingResource) {
      return
    }

    // The shader never reads this when all content ranges are empty, but the
    // bind group still needs a valid texture for the fixed glass pipeline layout.
    const contentTexture = this.domContent.atlasTexture ?? sharpSource

    const bindGroup = createPipelineBindGroup(this.device, this.glassPipeline, [
      { binding: 0, resource: this.globalsBuffer.bindingResource },
      { binding: 1, resource: this.shapesBuffer.bindingResource },
      { binding: 2, resource: this.sampler },
      { binding: 3, resource: sharpSource.createView() },
      { binding: 4, resource: this.targets.blur.createView() },
      { binding: 5, resource: contentTexture.createView() },
      { binding: 6, resource: contentEntriesBindingResource },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.glassPipeline,
      bindGroup,
      target,
    })
  }

  /** Copies the previous presented frame into newly resized presentation targets. */
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

    clearRenderTarget(encoder, this.lastFrameTexture)

    const currentTexture = this.context.getCurrentTexture()
    clearRenderTarget(encoder, currentTexture)

    const region = {
      sourceX: 0,
      sourceY: 0,
      destinationX: 0,
      destinationY: 0,
      width: copyWidth,
      height: copyHeight,
    }

    copyTextureRegion(encoder, previousFrame, this.lastFrameTexture, region)
    copyTextureRegion(encoder, previousFrame, currentTexture, region)
    this.device.queue.submit([encoder.finish()])
  }

  /** Writes uniforms for compositing one scene-attached HTML texture. */
  private writeHtmlCompositeParams(entry: SceneHtmlEntry) {
    if (!this.device || !this.htmlCompositeParamsBuffer || !entry.inverseTransform) {
      return
    }

    const inverse = entry.inverseTransform
    this.htmlCompositeParamsBuffer.write({
      canvas: {
        width: this.targetCanvas.width,
        height: this.targetCanvas.height,
        uScale: getTextureUvScale(entry.deviceWidth, entry.width, entry.textureWidth),
        vScale: getTextureUvScale(entry.deviceHeight, entry.height, entry.textureHeight),
      },
      inverse0: {
        a: inverse.a,
        c: inverse.c,
        e: inverse.e,
        copiedWidth: getCopiedCssSize(entry.copiedDeviceWidth, entry.deviceWidth, entry.width),
      },
      inverse1: {
        b: inverse.b,
        d: inverse.d,
        f: inverse.f,
        copiedHeight: getCopiedCssSize(entry.copiedDeviceHeight, entry.deviceHeight, entry.height),
      },
    })
  }

  /** Composites a scene-attached HTML layer over the current scene texture. */
  private compositeHtmlLayer(
    encoder: GPUCommandEncoder,
    sharpSource: GPUTexture,
    target: GPUTexture,
    entry: SceneHtmlEntry,
  ) {
    if (
      !this.device ||
      !this.sampler ||
      !this.htmlCompositePipeline ||
      !this.htmlCompositeParamsBuffer ||
      !entry.texture ||
      !entry.inverseTransform
    ) {
      return
    }

    this.writeHtmlCompositeParams(entry)

    const bindGroup = createPipelineBindGroup(this.device, this.htmlCompositePipeline, [
      { binding: 0, resource: this.sampler },
      { binding: 1, resource: sharpSource.createView() },
      { binding: 2, resource: entry.texture.createView() },
      { binding: 3, resource: this.htmlCompositeParamsBuffer.bindingResource },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.htmlCompositePipeline,
      bindGroup,
      target,
    })
  }

  /** Copies the completed scene texture into the canvas presentation texture. */
  private copyTextureToPresentation(encoder: GPUCommandEncoder, source: GPUTexture) {
    if (!this.context) {
      return
    }

    copyTextureRegion(encoder, source, this.context.getCurrentTexture(), {
      sourceX: 0,
      sourceY: 0,
      destinationX: 0,
      destinationY: 0,
      width: this.targetCanvas.width,
      height: this.targetCanvas.height,
    })
  }

  /** Draws a complete frame for the provided sorted scene layers. */
  private drawFrame(layers = getSortedSceneLayers(this.scene)) {
    if (
      this.destroyed ||
      !this.device ||
      !this.context ||
      !this.targets ||
      !this.glassPipeline ||
      !this.htmlCompositePipeline ||
      !this.blurPipeline
    ) {
      return
    }

    const seenContainers = new Set<Container>()
    const composer = new PingPongComposer(this.device, this.targets)

    for (const entry of layers) {
      if (entry.child instanceof Html) {
        const htmlEntry = this.domContent.getSceneHtmlEntry(entry.child)
        if (!htmlEntry || !htmlEntry.texture || !htmlEntry.inverseTransform) {
          continue
        }

        this.compositeHtmlLayer(composer.encoder, composer.current, composer.next, htmlEntry)
        composer.submitAndSwap()
        continue
      }

      const packedShapes = this.packShapes(entry.child, entry.transform)
      this.writeGlobals(entry.child, packedShapes.shapeCount)
      this.blurTexture(composer.encoder, composer.current, entry.child)

      const metricsState = this.backdropMetrics.getTrackedState(entry.child)
      let scheduledMetricsReadback = false

      if (metricsState) {
        seenContainers.add(entry.child)
        scheduledMetricsReadback = this.renderBackdropMetrics(composer.encoder, metricsState, packedShapes.bounds)
      }

      this.renderContainer(composer.encoder, composer.current, composer.next)
      composer.submitAndSwap()

      if (metricsState && scheduledMetricsReadback) {
        this.backdropMetrics.scheduleReadback(metricsState)
      }
    }

    this.backdropMetrics.markSceneMembership(seenContainers)

    this.copyTextureToPresentation(composer.encoder, composer.current)
    if (this.lastFrameTexture) {
      copyTextureRegion(composer.encoder, composer.current, this.lastFrameTexture, {
        sourceX: 0,
        sourceY: 0,
        destinationX: 0,
        destinationY: 0,
        width: this.targetCanvas.width,
        height: this.targetCanvas.height,
      })
    }
    composer.submit()
  }
}
