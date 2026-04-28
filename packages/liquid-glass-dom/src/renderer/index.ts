import { GlassPointerEvent, type GlassPointerEventType } from '../events'
import {
  composeTransform,
  getMinimumScale,
  invertMatrix,
  multiplyMatrices,
  scaleOutputMatrix,
  transformPoint,
  type Matrix2D,
} from '../matrix'
import {
  CONTENT_ATLAS_PADDING,
  getTextureBucketSize,
  packContentAtlas,
  type GlassContentEntry,
} from './content'
import {
  createGlassInteractionEntries,
  hitTestGlassInteractionEntries,
  matrixToCssTransform,
  measureGlassInteractionEntry,
  type GlassInteractionEntry,
  type PointerSnapshot,
  type PointerState,
} from './interaction'
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
  BACKDROP_METRICS_BUFFER_SIZE,
  BACKDROP_METRICS_BYTES_PER_ROW,
  BACKDROP_METRICS_SIZE,
  createEmptyBounds,
  expandBounds,
  hasBounds,
  parseBackdropMetrics,
  type BoundsRect,
} from './metrics'
import {
  BackdropMetricsBoundsLayout,
  BlurParamsLayout,
  ContentDataLayout,
  GlobalsLayout,
  HtmlCompositeParamsLayout,
  ShapeDataLayout,
} from './shader-layouts'
import { Container, flattenSceneLayers, Glass, Html, Scene, type TraversedSceneLayer } from '../scene'
import { BLUR_SHADER, GLASS_SHADER, HTML_COMPOSITE_SHADER, METRICS_SHADER } from '../shaders'
import type { BackdropMetrics, SurfaceProfile } from '../types'

const GPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  COPY_DST: 0x0008,
} as const

const GPU_TEXTURE_USAGE = {
  COPY_SRC: 0x01,
  TEXTURE_BINDING: 0x04,
  COPY_DST: 0x02,
  RENDER_ATTACHMENT: 0x10,
} as const

type GPUQueueWithElementCopy = GPUQueue & {
  copyElementImageToTexture: (
    source: Element,
    width: number,
    height: number,
    destination: { texture: GPUTexture; origin?: { x: number; y: number; z?: number } },
  ) => void
}

type CanvasPaintEvent = Event & {
  changedElements?: readonly Element[]
}

function changedElementsIncludeHost(changedElements: readonly Element[], hosts: Set<HTMLDivElement>) {
  for (const element of changedElements) {
    for (const host of hosts) {
      if (element === host || host.contains(element)) {
        return true
      }
    }
  }

  return false
}

function eventTargetsHost(event: Event, hosts: Set<HTMLDivElement>) {
  const path = event.composedPath()

  for (const host of hosts) {
    if (path.includes(host)) {
      return true
    }
  }

  return false
}

function syncHtmlHost(host: HTMLDivElement, canvas: HTMLCanvasElement, transform: string, zIndex: string) {
  if (host.parentElement !== canvas) {
    canvas.append(host)
  }
  if (host.style.transform !== transform) {
    host.style.transform = transform
  }
  if (host.style.zIndex !== zIndex) {
    host.style.zIndex = zIndex
  }
}

function syncHtmlHostDomOrder(canvas: HTMLCanvasElement, hostOrder: Map<Html, number>) {
  // Chrome's experimental layoutsubtree hit testing can follow canvas child order
  // even when the hosts have matching CSS z-index values, so keep DOM order in
  // sync with the renderer's visual order. The comparison avoids re-appending
  // every frame, which would continuously invalidate the canvas paint cache.
  const desiredHosts = [...hostOrder.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([html]) => html.host)
    .filter((host) => host.parentElement === canvas)
  const managedHosts = new Set(desiredHosts)
  const currentHosts = Array.from(canvas.children).filter((child) => managedHosts.has(child as HTMLDivElement))

  if (
    currentHosts.length === desiredHosts.length &&
    currentHosts.every((host, index) => host === desiredHosts[index])
  ) {
    return
  }

  for (const host of desiredHosts) {
    canvas.append(host)
  }
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

type RenderTargetSet = {
  blurPing: GPUTexture
  blur: GPUTexture
  sceneA: GPUTexture
  sceneB: GPUTexture
}

type PackedShapesResult = {
  shapeCount: number
  bounds: BoundsRect | null
}

type BackdropMetricsState = {
  container: Container
  readbackBuffer: GPUBuffer | null
  metrics: BackdropMetrics | null
  pendingReadback: boolean
  inScene: boolean
  cleanupAfterPending: boolean
}

type FlattenedContainer = {
  container: Container
  transform: Matrix2D
  traversalIndex: number
}

type SceneHtmlEntry = {
  html: Html
  texture: GPUTexture | null
  elementVersion: number
  width: number
  height: number
  deviceWidth: number
  deviceHeight: number
  copiedDeviceWidth: number
  copiedDeviceHeight: number
  textureWidth: number
  textureHeight: number
  transform: Matrix2D
  inverseTransform: Matrix2D | null
}

type GlassContentRange = {
  start: number
  count: number
}

type PreviousGlassContentAtlasEntry = {
  copiedDeviceWidth: number
  copiedDeviceHeight: number
  atlasX: number
  atlasY: number
}

type TextureCopyRegion = {
  sourceX: number
  sourceY: number
  destinationX: number
  destinationY: number
  width: number
  height: number
}

type GlobalsBuffer = GpuStructBuffer<GpuStructDefinition<typeof GlobalsLayout>>
type ShapeDataBuffer = GpuStructArrayBuffer<GpuStructDefinition<typeof ShapeDataLayout>>
type ContentDataBuffer = GpuStructArrayBuffer<GpuStructDefinition<typeof ContentDataLayout>>
type BlurParamsBuffer = GpuStructBuffer<GpuStructDefinition<typeof BlurParamsLayout>>
type BackdropMetricsBoundsBuffer = GpuStructBuffer<GpuStructDefinition<typeof BackdropMetricsBoundsLayout>>
type HtmlCompositeParamsBuffer = GpuStructBuffer<GpuStructDefinition<typeof HtmlCompositeParamsLayout>>

function createRenderTarget(
  device: GPUDevice,
  format: GPUTextureFormat,
  width: number,
  height: number,
) {
  return device.createTexture({
    size: {
      width,
      height,
      depthOrArrayLayers: 1,
    },
    format,
    usage:
      GPU_TEXTURE_USAGE.COPY_SRC |
      GPU_TEXTURE_USAGE.TEXTURE_BINDING |
      GPU_TEXTURE_USAGE.RENDER_ATTACHMENT |
      GPU_TEXTURE_USAGE.COPY_DST,
  })
}

function destroyTargets(targets: RenderTargetSet | null) {
  if (!targets) {
    return
  }

  targets.blurPing.destroy()
  targets.blur.destroy()
  targets.sceneA.destroy()
  targets.sceneB.destroy()
}

function copyTextureRegion(
  encoder: GPUCommandEncoder,
  source: GPUTexture,
  destination: GPUTexture,
  region: TextureCopyRegion,
) {
  const width = Math.floor(region.width)
  const height = Math.floor(region.height)

  if (width <= 0 || height <= 0) {
    return false
  }

  encoder.copyTextureToTexture(
    {
      texture: source,
      origin: {
        x: Math.floor(region.sourceX),
        y: Math.floor(region.sourceY),
        z: 0,
      },
    },
    {
      texture: destination,
      origin: {
        x: Math.floor(region.destinationX),
        y: Math.floor(region.destinationY),
        z: 0,
      },
    },
    {
      width,
      height,
      depthOrArrayLayers: 1,
    },
  )

  return true
}

function getCopiedCssSize(copiedDeviceSize: number, deviceSize: number, cssSize: number) {
  if (copiedDeviceSize <= 0 || deviceSize <= 0 || cssSize <= 0) {
    return 0
  }

  return copiedDeviceSize * cssSize / deviceSize
}

function getTextureUvScale(deviceSize: number, cssSize: number, textureSize: number) {
  if (deviceSize <= 0 || cssSize <= 0 || textureSize <= 0) {
    return 0
  }

  return deviceSize / cssSize / textureSize
}

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
  private readonly backdropMetricsStateByContainer = new WeakMap<Container, BackdropMetricsState>()
  private readonly trackedBackdropContainers = new Set<Container>()
  private readonly pendingBackdropMetricStates = new Set<BackdropMetricsState>()
  private readonly sceneHtmlEntries = new Map<Html, SceneHtmlEntry>()
  private readonly glassContentEntries = new Map<Html, GlassContentEntry>()
  private readonly glassContentRanges = new Map<Glass, GlassContentRange>()
  private glassContentOrder: GlassContentEntry[] = []
  private readonly sceneHtmlHosts = new Set<HTMLDivElement>()
  private readonly glassContentHosts = new Set<HTMLDivElement>()
  private glassInteractionEntries = new Map<Glass, GlassInteractionEntry>()
  private glassInteractionOrder: GlassInteractionEntry[] = []
  private readonly pointerStates = new Map<number, PointerState>()

  private unsubscribeSceneMutations: (() => void) | null = null
  private initError: unknown = null
  private destroyed = false
  private initialized = false
  private needsSceneHtmlCopy = false
  private needsContentCopy = false
  private pendingSceneContentSync = true
  private sceneContentSyncQueued = false
  private currentDpr = 1
  private resizeObserver: ResizeObserver | null = null

  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private presentationFormat: GPUTextureFormat | null = null
  private globalsBuffer: GlobalsBuffer | null = null
  private shapesBuffer: ShapeDataBuffer | null = null
  private contentEntriesBuffer: ContentDataBuffer | null = null
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
  private glassContentAtlas: GPUTexture | null = null
  private glassContentAtlasWidth = 0
  private glassContentAtlasHeight = 0

  private readonly handlePaintEvent = (event: Event) => {
    if (this.destroyed || !this.device || !this.targets) {
      return
    }

    const changedElements = (event as CanvasPaintEvent).changedElements
    const hasChangedElements = Array.isArray(changedElements)
    const shouldCopySceneHtml =
      this.needsSceneHtmlCopy ||
      !hasChangedElements ||
      changedElementsIncludeHost(changedElements, this.sceneHtmlHosts)
    const shouldCopyContent =
      this.needsContentCopy ||
      !hasChangedElements ||
      changedElementsIncludeHost(changedElements, this.glassContentHosts)

    if (shouldCopySceneHtml) {
      this.copySceneHtmlTextures()
    }

    if (shouldCopyContent) {
      this.copyGlassContentAtlas()
    }
  }

  private readonly handleSceneMutation = () => {
    this.queueSceneContentSync()
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointermove', event)
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointerdown', event)
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointerup', event)
  }

  private readonly handlePointerCancel = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointercancel', event)
  }

  private readonly handlePointerLeave = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointerleave', event)
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

    this.targetCanvas.addEventListener('paint', this.handlePaintEvent as EventListener)
    this.targetCanvas.addEventListener('pointermove', this.handlePointerMove, true)
    this.targetCanvas.addEventListener('pointerdown', this.handlePointerDown, true)
    this.targetCanvas.addEventListener('pointerup', this.handlePointerUp, true)
    this.targetCanvas.addEventListener('pointercancel', this.handlePointerCancel, true)
    this.targetCanvas.addEventListener('pointerleave', this.handlePointerLeave, true)
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
    if (enabled) {
      const state = this.getOrCreateBackdropMetricsState(container)
      state.cleanupAfterPending = false
      this.trackedBackdropContainers.add(container)
      this.ensureBackdropMetricsResources(state)
      return
    }

    this.trackedBackdropContainers.delete(container)
    const state = this.backdropMetricsStateByContainer.get(container)
    if (!state) {
      return
    }

    state.metrics = null
    state.inScene = false

    if (state.pendingReadback) {
      state.cleanupAfterPending = true
      return
    }

    this.cleanupBackdropMetricsState(state)
  }

  /**
   * Returns the latest completed cached backdrop metrics for a tracked container.
   */
  getBackdropMetrics(container: Container) {
    if (!this.trackedBackdropContainers.has(container)) {
      return null
    }

    const state = this.backdropMetricsStateByContainer.get(container)
    if (!state || !state.inScene) {
      return null
    }

    return state.metrics
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
    this.targetCanvas.removeEventListener('pointermove', this.handlePointerMove, true)
    this.targetCanvas.removeEventListener('pointerdown', this.handlePointerDown, true)
    this.targetCanvas.removeEventListener('pointerup', this.handlePointerUp, true)
    this.targetCanvas.removeEventListener('pointercancel', this.handlePointerCancel, true)
    this.targetCanvas.removeEventListener('pointerleave', this.handlePointerLeave, true)
    this.unsubscribeSceneMutations?.()
    this.unsubscribeSceneMutations = null
    this.resizeObserver?.disconnect()
    destroyTargets(this.targets)
    this.targets = null
    this.lastFrameTexture?.destroy()
    this.lastFrameTexture = null
    this.backdropMetricsTarget?.destroy()
    this.backdropMetricsTarget = null
    this.glassContentAtlas?.destroy()
    this.glassContentAtlas = null
    this.glassContentAtlasWidth = 0
    this.glassContentAtlasHeight = 0
    this.globalsBuffer?.destroy()
    this.shapesBuffer?.destroy()
    this.contentEntriesBuffer?.destroy()
    this.blurHorizontalBuffer?.destroy()
    this.blurVerticalBuffer?.destroy()
    this.backdropMetricsBoundsBuffer?.destroy()
    this.htmlCompositeParamsBuffer?.destroy()

    for (const container of this.trackedBackdropContainers) {
      const state = this.backdropMetricsStateByContainer.get(container)
      if (!state) {
        continue
      }

      if (state.pendingReadback) {
        state.cleanupAfterPending = true
      } else {
        this.cleanupBackdropMetricsState(state)
      }
    }
    this.trackedBackdropContainers.clear()

    for (const state of this.pendingBackdropMetricStates) {
      state.cleanupAfterPending = true
    }

    for (const entry of this.sceneHtmlEntries.values()) {
      entry.texture?.destroy()
      entry.html.host.remove()
    }
    this.sceneHtmlEntries.clear()
    this.sceneHtmlHosts.clear()

    for (const entry of this.glassContentEntries.values()) {
      entry.html.host.remove()
    }
    this.glassContentEntries.clear()
    this.glassContentRanges.clear()
    this.glassContentOrder = []
    this.glassContentHosts.clear()
    this.glassInteractionEntries.clear()
    this.glassInteractionOrder = []
    this.pointerStates.clear()
  }

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
    this.initialized = true

    for (const container of this.trackedBackdropContainers) {
      const state = this.backdropMetricsStateByContainer.get(container)
      if (state) {
        this.ensureBackdropMetricsResources(state)
      }
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.syncCanvasSize()
    })
    this.resizeObserver.observe(this.targetCanvas)
    this.queueSceneContentSync()
  }

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

  private ensureContentEntriesBuffer(requiredCount: number) {
    if (!this.device) {
      return
    }

    if (!this.contentEntriesBuffer) {
      this.contentEntriesBuffer = new GpuStructArrayBuffer(
        this.device,
        ContentDataLayout,
        GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
      )
    }

    this.contentEntriesBuffer.ensureCapacity(requiredCount)
  }

  private getOrCreateBackdropMetricsState(container: Container) {
    let state = this.backdropMetricsStateByContainer.get(container)
    if (state) {
      return state
    }

    state = {
      container,
      readbackBuffer: null,
      metrics: null,
      pendingReadback: false,
      inScene: false,
      cleanupAfterPending: false,
    }
    this.backdropMetricsStateByContainer.set(container, state)
    return state
  }

  private ensureBackdropMetricsResources(state: BackdropMetricsState) {
    if (!this.device || state.readbackBuffer) {
      return
    }

    state.readbackBuffer = this.device.createBuffer({
      size: BACKDROP_METRICS_BUFFER_SIZE,
      usage: GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
    })
  }

  private cleanupBackdropMetricsState(state: BackdropMetricsState) {
    if (state.pendingReadback) {
      state.cleanupAfterPending = true
      return
    }

    state.metrics = null
    state.inScene = false
    state.cleanupAfterPending = false
    this.pendingBackdropMetricStates.delete(state)
    state.readbackBuffer?.destroy()
    state.readbackBuffer = null
  }

  private scheduleBackdropMetricsReadback(state: BackdropMetricsState) {
    const readbackBuffer = state.readbackBuffer
    if (!readbackBuffer || state.pendingReadback) {
      return
    }

    state.pendingReadback = true
    this.pendingBackdropMetricStates.add(state)

    void readbackBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        if (this.destroyed || !this.trackedBackdropContainers.has(state.container) || !state.inScene) {
          state.metrics = null
          return
        }

        const nextMetrics = parseBackdropMetrics(readbackBuffer)
        if (!nextMetrics) {
          state.metrics = null
          return
        }

        state.metrics = nextMetrics
      })
      .catch((error) => {
        if (!this.destroyed && !state.cleanupAfterPending) {
          console.error(error)
        }
        state.metrics = null
      })
      .finally(() => {
        if (readbackBuffer.mapState === 'mapped') {
          readbackBuffer.unmap()
        }

        state.pendingReadback = false
        this.pendingBackdropMetricStates.delete(state)

        if (this.destroyed || state.cleanupAfterPending) {
          this.cleanupBackdropMetricsState(state)
        }
      })
  }

  private removeSceneHtmlEntry(html: Html, keepHostMounted: boolean) {
    const entry = this.sceneHtmlEntries.get(html)
    if (!entry) {
      return
    }

    entry.texture?.destroy()
    this.sceneHtmlHosts.delete(html.host)
    this.sceneHtmlEntries.delete(html)
    if (!keepHostMounted) {
      html.host.remove()
    }
  }

  private removeGlassContentEntry(html: Html, keepHostMounted: boolean) {
    const entry = this.glassContentEntries.get(html)
    if (!entry) {
      return
    }

    this.glassContentHosts.delete(html.host)
    this.glassContentEntries.delete(html)
    if (!keepHostMounted) {
      html.host.remove()
    }
  }

  private getSortedSceneLayers() {
    return flattenSceneLayers(this.scene).sort((left, right) => {
      const leftZIndex = left.child.zIndex
      const rightZIndex = right.child.zIndex
      return leftZIndex - rightZIndex || left.traversalIndex - right.traversalIndex
    })
  }

  private getSortedGlasses(container: Container) {
    return container._children
      .map((glass, index) => ({ glass, index }))
      .sort((left, right) => left.glass.zIndex - right.glass.zIndex || left.index - right.index)
      .map((entry) => entry.glass)
  }

  private getSortedGlassHtml(glass: Glass) {
    return glass._children
      .map((html, index) => ({ html, index }))
      .sort((left, right) => left.html.zIndex - right.html.zIndex || left.index - right.index)
      .map((entry) => entry.html)
  }

  private getLayerContainers(layers: TraversedSceneLayer[]): FlattenedContainer[] {
    return layers
      .filter((entry): entry is TraversedSceneLayer & { child: Container } => entry.child instanceof Container)
      .map((entry) => ({
        container: entry.child,
        transform: entry.transform,
        traversalIndex: entry.traversalIndex,
      }))
  }

  private getHtmlHostOrder(layers: TraversedSceneLayer[]) {
    const order = new Map<Html, number>()
    let nextOrder = 1

    for (const layer of layers) {
      if (layer.child instanceof Html) {
        if (layer.child.width > 0 && layer.child.height > 0) {
          order.set(layer.child, nextOrder)
          nextOrder += 1
        }
        continue
      }

      for (const glass of this.getSortedGlasses(layer.child)) {
        for (const html of this.getSortedGlassHtml(glass)) {
          if (html.width > 0 && html.height > 0) {
            order.set(html, nextOrder)
            nextOrder += 1
          }
        }
      }
    }

    return order
  }

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

  private syncSceneNow() {
    const layers = this.getSortedSceneLayers()
    const containers = this.getLayerContainers(layers)
    const hostOrder = this.getHtmlHostOrder(layers)

    this.syncGlassInteractions(containers)
    this.syncSceneHtml(layers, hostOrder)
    this.syncGlassContent(containers, hostOrder)
    syncHtmlHostDomOrder(this.targetCanvas, hostOrder)

    this.pendingSceneContentSync = false
    return layers
  }

  private flushSceneContentSync() {
    if (this.pendingSceneContentSync) {
      this.syncSceneNow()
    }
  }

  private syncGlassInteractions(containers: FlattenedContainer[]) {
    const previousEntries = this.glassInteractionEntries
    const { entriesByGlass, orderedEntries } = createGlassInteractionEntries(containers)
    this.glassInteractionEntries = entriesByGlass
    this.glassInteractionOrder = orderedEntries
    this.handleRemovedInteractionTargets(previousEntries)
  }

  private getPointerState(pointerId: number) {
    let state = this.pointerStates.get(pointerId)
    if (state) {
      return state
    }

    state = {
      hoveredGlass: null,
      capturedGlass: null,
      capturedWithNativePointerCapture: false,
      pressedGlass: null,
      lastSnapshot: null,
    }
    this.pointerStates.set(pointerId, state)
    return state
  }

  private createPointerSnapshot(event: PointerEvent): PointerSnapshot {
    const bounds = this.targetCanvas.getBoundingClientRect()
    return {
      nativeEvent: event,
      canvasX: event.clientX - bounds.left,
      canvasY: event.clientY - bounds.top,
    }
  }

  private dispatchGlassPointerEvent(
    type: GlassPointerEventType,
    glass: Glass,
    entry: GlassInteractionEntry | null,
    snapshot: PointerSnapshot,
    inside: boolean,
  ) {
    const localPoint = entry
      ? measureGlassInteractionEntry(entry, snapshot.canvasX, snapshot.canvasY)
      : { localX: 0, localY: 0 }
    const event = new GlassPointerEvent(type, {
      glass,
      renderer: this,
      nativeEvent: snapshot.nativeEvent,
      canvasX: snapshot.canvasX,
      canvasY: snapshot.canvasY,
      localX: localPoint.localX,
      localY: localPoint.localY,
      inside,
    })

    glass.dispatchEvent(event)
    if (event.defaultPrevented) {
      snapshot.nativeEvent.preventDefault()
    }
  }

  private updateHoveredGlass(state: PointerState, nextEntry: GlassInteractionEntry | null, snapshot: PointerSnapshot) {
    const currentGlass = state.hoveredGlass
    const nextGlass = nextEntry?.glass ?? null
    if (currentGlass === nextGlass) {
      return
    }

    if (currentGlass) {
      const currentEntry = this.glassInteractionEntries.get(currentGlass) ?? null
      this.dispatchGlassPointerEvent('pointerleave', currentGlass, currentEntry, snapshot, false)
    }

    state.hoveredGlass = nextGlass
    if (nextEntry) {
      this.dispatchGlassPointerEvent('pointerenter', nextEntry.glass, nextEntry, snapshot, true)
    }
  }

  private releaseNativePointerCapture(pointerId: number) {
    if (!this.targetCanvas.hasPointerCapture(pointerId)) {
      return
    }

    try {
      this.targetCanvas.releasePointerCapture(pointerId)
    } catch {
      // Ignore browsers rejecting a redundant release.
    }
  }

  private cleanupPointerState(pointerId: number, state: PointerState) {
    if (state.hoveredGlass || state.capturedGlass || state.pressedGlass) {
      return
    }

    this.pointerStates.delete(pointerId)
  }

  private finishPointerEvent(pointerId: number, state: PointerState) {
    this.flushSceneContentSync()
    this.cleanupPointerState(pointerId, state)
  }

  private handleRemovedInteractionTargets(previousEntries: Map<Glass, GlassInteractionEntry>) {
    for (const [pointerId, state] of this.pointerStates) {
      const snapshot = state.lastSnapshot
      const capturedGlass = state.capturedGlass
      if (capturedGlass && !this.glassInteractionEntries.has(capturedGlass)) {
        const previousEntry = previousEntries.get(capturedGlass) ?? null
        if (snapshot) {
          this.dispatchGlassPointerEvent('pointercancel', capturedGlass, previousEntry, snapshot, false)
        }
        state.capturedGlass = null
        state.capturedWithNativePointerCapture = false
        state.pressedGlass = null
        this.releaseNativePointerCapture(pointerId)
      }

      const hoveredGlass = state.hoveredGlass
      if (hoveredGlass && !this.glassInteractionEntries.has(hoveredGlass)) {
        const previousEntry = previousEntries.get(hoveredGlass) ?? null
        if (snapshot) {
          this.dispatchGlassPointerEvent('pointerleave', hoveredGlass, previousEntry, snapshot, false)
        }
        state.hoveredGlass = null
      }

      if (!state.capturedGlass && snapshot) {
        this.updateHoveredGlass(
          state,
          hitTestGlassInteractionEntries(this.glassInteractionOrder, snapshot.canvasX, snapshot.canvasY),
          snapshot,
        )
      }

      this.cleanupPointerState(pointerId, state)
    }
  }

  private handleNativePointerEvent(type: GlassPointerEventType, event: PointerEvent) {
    if (this.destroyed) {
      return
    }

    this.flushSceneContentSync()

    const state = this.getPointerState(event.pointerId)
    const snapshot = this.createPointerSnapshot(event)
    state.lastSnapshot = snapshot

    const capturedEntry = state.capturedGlass
      ? this.glassInteractionEntries.get(state.capturedGlass) ?? null
      : null

    if (capturedEntry) {
      if (type === 'pointerleave') {
        if (!state.capturedWithNativePointerCapture) {
          this.dispatchGlassPointerEvent('pointercancel', capturedEntry.glass, capturedEntry, snapshot, false)
          state.capturedGlass = null
          state.capturedWithNativePointerCapture = false
          state.pressedGlass = null
          this.updateHoveredGlass(state, null, snapshot)
          this.cleanupPointerState(event.pointerId, state)
        }
        return
      }

      const measurement = measureGlassInteractionEntry(capturedEntry, snapshot.canvasX, snapshot.canvasY)
      this.dispatchGlassPointerEvent(type, capturedEntry.glass, capturedEntry, snapshot, measurement.inside)

      if (type === 'pointerup' || type === 'pointercancel') {
        if (
          type === 'pointerup' &&
          event.button === 0 &&
          state.pressedGlass === capturedEntry.glass &&
          measurement.inside
        ) {
          this.dispatchGlassPointerEvent('click', capturedEntry.glass, capturedEntry, snapshot, true)
        }

        state.capturedGlass = null
        state.capturedWithNativePointerCapture = false
        state.pressedGlass = null
        this.releaseNativePointerCapture(event.pointerId)
        this.updateHoveredGlass(
          state,
          hitTestGlassInteractionEntries(this.glassInteractionOrder, snapshot.canvasX, snapshot.canvasY),
          snapshot,
        )
      }

      this.finishPointerEvent(event.pointerId, state)
      return
    }

    if (type === 'pointerleave') {
      if (state.hoveredGlass) {
        const hoveredEntry = this.glassInteractionEntries.get(state.hoveredGlass) ?? null
        this.dispatchGlassPointerEvent('pointerleave', state.hoveredGlass, hoveredEntry, snapshot, false)
        state.hoveredGlass = null
      }

      this.finishPointerEvent(event.pointerId, state)
      return
    }

    const hitEntry = hitTestGlassInteractionEntries(
      this.glassInteractionOrder,
      snapshot.canvasX,
      snapshot.canvasY,
    )
    this.updateHoveredGlass(state, hitEntry, snapshot)

    if (hitEntry) {
      this.dispatchGlassPointerEvent(type, hitEntry.glass, hitEntry, snapshot, true)

      if (type === 'pointerdown') {
        state.pressedGlass = hitEntry.glass
        this.flushSceneContentSync()

        if (this.glassInteractionEntries.has(hitEntry.glass)) {
          state.capturedGlass = hitEntry.glass
          state.capturedWithNativePointerCapture = false

          if (!eventTargetsHost(event, this.sceneHtmlHosts) && !eventTargetsHost(event, this.glassContentHosts)) {
            try {
              this.targetCanvas.setPointerCapture(event.pointerId)
              state.capturedWithNativePointerCapture = true
            } catch {
              state.capturedGlass = null
              state.pressedGlass = null
            }
          }
        }
      }
    }

    this.finishPointerEvent(event.pointerId, state)
  }

  private syncSceneHtml(layers: TraversedSceneLayer[], hostOrder: Map<Html, number>) {
    const activeHtml = new Set<Html>()
    let layoutChanged = false
    let contentChanged = false

    for (const layer of layers) {
      if (!(layer.child instanceof Html) || layer.child.width <= 0 || layer.child.height <= 0) {
        continue
      }

      const html = layer.child
      activeHtml.add(html)

      let entry = this.sceneHtmlEntries.get(html)
      if (!entry) {
        entry = {
          html,
          texture: null,
          elementVersion: -1,
          width: -1,
          height: -1,
          deviceWidth: 0,
          deviceHeight: 0,
          copiedDeviceWidth: 0,
          copiedDeviceHeight: 0,
          textureWidth: 0,
          textureHeight: 0,
          transform: layer.transform,
          inverseTransform: null,
        }
        this.sceneHtmlEntries.set(html, entry)
        layoutChanged = true
        contentChanged = true
      }

      entry.transform = layer.transform
      entry.inverseTransform = invertMatrix(scaleOutputMatrix(layer.transform, this.currentDpr))

      if (entry.elementVersion !== html._elementVersion) {
        entry.elementVersion = html._elementVersion
        contentChanged = true
      }

      const previousDeviceWidth = entry.deviceWidth
      const previousDeviceHeight = entry.deviceHeight
      const nextDeviceWidth = Math.max(1, Math.round(html.width * this.currentDpr))
      const nextDeviceHeight = Math.max(1, Math.round(html.height * this.currentDpr))
      let nextTextureWidth = entry.textureWidth
      let nextTextureHeight = entry.textureHeight
      let textureSizeChanged = false

      if (this.device) {
        nextTextureWidth = getTextureBucketSize(nextDeviceWidth, this.device.limits.maxTextureDimension2D)
        nextTextureHeight = getTextureBucketSize(nextDeviceHeight, this.device.limits.maxTextureDimension2D)
        textureSizeChanged =
          entry.textureWidth !== nextTextureWidth || entry.textureHeight !== nextTextureHeight
      }

      const contentSizeChanged =
        entry.deviceWidth !== nextDeviceWidth || entry.deviceHeight !== nextDeviceHeight
      if (
        entry.width !== html.width ||
        entry.height !== html.height ||
        contentSizeChanged
      ) {
        entry.width = html.width
        entry.height = html.height
        entry.deviceWidth = nextDeviceWidth
        entry.deviceHeight = nextDeviceHeight
        layoutChanged = true
        contentChanged = true
      }

      if (this.device && this.presentationFormat) {
        const rebuildTexture =
          !entry.texture ||
          textureSizeChanged

        if (rebuildTexture) {
          const previousTexture = entry.texture
          const nextTexture = this.device.createTexture({
            size: {
              width: nextTextureWidth,
              height: nextTextureHeight,
              depthOrArrayLayers: 1,
            },
            format: this.presentationFormat,
            // Required by Chrome's experimental DOM-to-texture copy path for scene Html layers.
            usage:
              GPU_TEXTURE_USAGE.COPY_SRC |
              GPU_TEXTURE_USAGE.TEXTURE_BINDING |
              GPU_TEXTURE_USAGE.COPY_DST |
              GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
          })

          if (previousTexture) {
            const encoder = this.device.createCommandEncoder()
            const copiedDeviceWidth = Math.min(entry.copiedDeviceWidth, previousDeviceWidth, nextTextureWidth)
            const copiedDeviceHeight = Math.min(entry.copiedDeviceHeight, previousDeviceHeight, nextTextureHeight)
            const copied = copyTextureRegion(encoder, previousTexture, nextTexture, {
              sourceX: 0,
              sourceY: 0,
              destinationX: 0,
              destinationY: 0,
              width: copiedDeviceWidth,
              height: copiedDeviceHeight,
            })

            if (copied) {
              this.device.queue.submit([encoder.finish()])
            }

            entry.copiedDeviceWidth = copiedDeviceWidth
            entry.copiedDeviceHeight = copiedDeviceHeight
          } else {
            entry.copiedDeviceWidth = 0
            entry.copiedDeviceHeight = 0
          }

          previousTexture?.destroy()
          entry.texture = nextTexture
          entry.textureWidth = nextTextureWidth
          entry.textureHeight = nextTextureHeight
          layoutChanged = true
          contentChanged = true
        }
      }

      if (entry.texture) {
        this.sceneHtmlHosts.add(html.host)
        syncHtmlHost(
          html.host,
          this.targetCanvas,
          matrixToCssTransform(layer.transform),
          String(hostOrder.get(html) ?? 0),
        )
      }
    }

    for (const html of [...this.sceneHtmlEntries.keys()]) {
      if (!activeHtml.has(html)) {
        this.removeSceneHtmlEntry(html, hostOrder.has(html))
        layoutChanged = true
        contentChanged = true
      }
    }

    if (activeHtml.size === 0) {
      this.needsSceneHtmlCopy = false
      return
    }

    if (layoutChanged || contentChanged) {
      this.needsSceneHtmlCopy = true
    }
  }

  private syncGlassContent(containers: FlattenedContainer[], hostOrder: Map<Html, number>) {
    const activeContentHtml = new Set<Html>()
    const activeEntries: GlassContentEntry[] = []
    const nextRanges = new Map<Glass, GlassContentRange>()
    const previousAtlasTexture = this.glassContentAtlas
    const previousAtlasEntries = new Map<Html, PreviousGlassContentAtlasEntry>()
    let layoutChanged = false
    let contentChanged = false

    if (previousAtlasTexture) {
      for (const entry of this.glassContentEntries.values()) {
        previousAtlasEntries.set(entry.html, {
          copiedDeviceWidth: entry.copiedDeviceWidth,
          copiedDeviceHeight: entry.copiedDeviceHeight,
          atlasX: entry.atlasX,
          atlasY: entry.atlasY,
        })
      }
    }

    for (const containerEntry of containers) {
      const containerTransform = containerEntry.transform

      for (const glass of this.getSortedGlasses(containerEntry.container)) {
        if (glass.width <= 0 || glass.height <= 0) {
          continue
        }

        const glassTransform = multiplyMatrices(containerTransform, composeTransform(glass))
        const contentStart = activeEntries.length

        for (const html of this.getSortedGlassHtml(glass)) {
          if (html.width <= 0 || html.height <= 0) {
            continue
          }

          const inverseTransform = invertMatrix(composeTransform(html))
          this.glassContentHosts.add(html.host)
          syncHtmlHost(
            html.host,
            this.targetCanvas,
            matrixToCssTransform(multiplyMatrices(glassTransform, composeTransform(html))),
            String(hostOrder.get(html) ?? 0),
          )

          if (!inverseTransform) {
            continue
          }
          activeContentHtml.add(html)

          let contentEntry = this.glassContentEntries.get(html)
          if (!contentEntry) {
            contentEntry = {
              html,
              glass,
              elementVersion: -1,
              width: -1,
              height: -1,
              deviceWidth: 0,
              deviceHeight: 0,
              copiedDeviceWidth: 0,
              copiedDeviceHeight: 0,
              atlasX: 0,
              atlasY: 0,
              inverseTransform,
            }
            this.glassContentEntries.set(html, contentEntry)
            layoutChanged = true
            contentChanged = true
          }

          if (contentEntry.glass !== glass) {
            contentEntry.glass = glass
            layoutChanged = true
          }

          contentEntry.inverseTransform = inverseTransform

          if (contentEntry.elementVersion !== html._elementVersion) {
            contentEntry.elementVersion = html._elementVersion
            contentChanged = true
          }

          const nextDeviceWidth = Math.max(1, Math.round(html.width * this.currentDpr))
          const nextDeviceHeight = Math.max(1, Math.round(html.height * this.currentDpr))
          if (
            contentEntry.width !== html.width ||
            contentEntry.height !== html.height ||
            contentEntry.deviceWidth !== nextDeviceWidth ||
            contentEntry.deviceHeight !== nextDeviceHeight
          ) {
            contentEntry.width = html.width
            contentEntry.height = html.height
            contentEntry.deviceWidth = nextDeviceWidth
            contentEntry.deviceHeight = nextDeviceHeight
            layoutChanged = true
            contentChanged = true
          }

          activeEntries.push(contentEntry)
        }

        const contentCount = activeEntries.length - contentStart
        if (contentCount > 0) {
          nextRanges.set(glass, {
            start: contentStart,
            count: contentCount,
          })
        }
      }
    }

    for (const html of [...this.glassContentEntries.keys()]) {
      if (!activeContentHtml.has(html)) {
        this.removeGlassContentEntry(html, hostOrder.has(html))
        layoutChanged = true
        contentChanged = true
      }
    }

    this.glassContentOrder = activeEntries
    this.glassContentRanges.clear()
    for (const [glass, range] of nextRanges) {
      this.glassContentRanges.set(glass, range)
    }

    if (!this.device) {
      this.needsContentCopy = false
      return
    }

    if (activeEntries.length === 0) {
      this.glassContentAtlas?.destroy()
      this.glassContentAtlas = null
      this.glassContentAtlasWidth = 0
      this.glassContentAtlasHeight = 0
      this.needsContentCopy = false
      return
    }

    if (layoutChanged || !this.glassContentAtlas) {
      const layout = packContentAtlas(activeEntries, this.device.limits.maxTextureDimension2D)
      const nextAtlasWidth = layout.width
      const nextAtlasHeight = layout.height
      const previousAtlasWidth = this.glassContentAtlasWidth
      const previousAtlasHeight = this.glassContentAtlasHeight
      const atlasLayoutChanged =
        !this.glassContentAtlas ||
        nextAtlasWidth !== this.glassContentAtlasWidth ||
        nextAtlasHeight !== this.glassContentAtlasHeight ||
        activeEntries.some((entry) => {
          const rect = layout.rects.get(entry.html)!
          return entry.atlasX !== rect.x || entry.atlasY !== rect.y
        })

      if (atlasLayoutChanged) {
        const nextAtlas = this.device.createTexture({
          size: {
            width: nextAtlasWidth,
            height: nextAtlasHeight,
            depthOrArrayLayers: 1,
          },
          format: this.presentationFormat ?? 'bgra8unorm',
          usage:
            GPU_TEXTURE_USAGE.COPY_SRC |
            GPU_TEXTURE_USAGE.TEXTURE_BINDING |
            GPU_TEXTURE_USAGE.COPY_DST |
            GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
        })

        if (previousAtlasTexture) {
          const encoder = this.device.createCommandEncoder()
          let copiedAny = false

          for (const entry of activeEntries) {
            const previousEntry = previousAtlasEntries.get(entry.html)
            const rect = layout.rects.get(entry.html)!
            if (!previousEntry) {
              entry.copiedDeviceWidth = 0
              entry.copiedDeviceHeight = 0
              continue
            }

            const sourceX = previousEntry.atlasX + CONTENT_ATLAS_PADDING
            const sourceY = previousEntry.atlasY + CONTENT_ATLAS_PADDING
            const destinationX = rect.x + CONTENT_ATLAS_PADDING
            const destinationY = rect.y + CONTENT_ATLAS_PADDING
            const copiedDeviceWidth = Math.min(
              previousEntry.copiedDeviceWidth,
              previousAtlasWidth - sourceX,
              nextAtlasWidth - destinationX,
            )
            const copiedDeviceHeight = Math.min(
              previousEntry.copiedDeviceHeight,
              previousAtlasHeight - sourceY,
              nextAtlasHeight - destinationY,
            )

            copiedAny =
              copyTextureRegion(encoder, previousAtlasTexture, nextAtlas, {
                sourceX,
                sourceY,
                destinationX,
                destinationY,
                width: copiedDeviceWidth,
                height: copiedDeviceHeight,
              }) || copiedAny

            entry.copiedDeviceWidth = Math.max(0, copiedDeviceWidth)
            entry.copiedDeviceHeight = Math.max(0, copiedDeviceHeight)
          }

          if (copiedAny) {
            this.device.queue.submit([encoder.finish()])
          }
        } else {
          for (const entry of activeEntries) {
            entry.copiedDeviceWidth = 0
            entry.copiedDeviceHeight = 0
          }
        }

        previousAtlasTexture?.destroy()
        this.glassContentAtlas = nextAtlas
        this.glassContentAtlasWidth = nextAtlasWidth
        this.glassContentAtlasHeight = nextAtlasHeight
      }

      for (const entry of activeEntries) {
        const rect = layout.rects.get(entry.html)!

        entry.atlasX = rect.x
        entry.atlasY = rect.y
      }

      this.needsContentCopy = true
    } else if (contentChanged) {
      this.needsContentCopy = true
    }

    this.writeContentEntries(activeEntries)
  }

  private writeContentEntries(entries: GlassContentEntry[]) {
    if (!this.device) {
      return
    }

    this.ensureContentEntriesBuffer(entries.length)
    if (!this.contentEntriesBuffer) {
      return
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const inverse = entry.inverseTransform

      this.contentEntriesBuffer.writeAt(index, {
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
        atlasRect: {
          u: (entry.atlasX + CONTENT_ATLAS_PADDING) / this.glassContentAtlasWidth,
          v: (entry.atlasY + CONTENT_ATLAS_PADDING) / this.glassContentAtlasHeight,
          uScale: getTextureUvScale(entry.deviceWidth, entry.width, this.glassContentAtlasWidth),
          vScale: getTextureUvScale(entry.deviceHeight, entry.height, this.glassContentAtlasHeight),
        },
      })
    }

    this.contentEntriesBuffer.upload(entries.length)
  }

  private copySceneHtmlTextures() {
    if (!this.device || this.sceneHtmlEntries.size === 0) {
      this.needsSceneHtmlCopy = false
      return true
    }

    let copiedAll = true
    for (const entry of this.sceneHtmlEntries.values()) {
      if (!entry.texture) {
        copiedAll = false
        continue
      }

      try {
        ;(this.device.queue as GPUQueueWithElementCopy).copyElementImageToTexture(
          entry.html.host,
          entry.deviceWidth,
          entry.deviceHeight,
          { texture: entry.texture },
        )
        entry.copiedDeviceWidth = entry.deviceWidth
        entry.copiedDeviceHeight = entry.deviceHeight
      } catch (error) {
        copiedAll = false
        if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
          console.error(error)
        }
      }
    }

    this.needsSceneHtmlCopy = !copiedAll
    return copiedAll
  }

  private copyGlassContentAtlas() {
    if (!this.device || !this.glassContentAtlas || this.glassContentOrder.length === 0) {
      this.needsContentCopy = false
      return true
    }

    let copiedAll = true
    let copiedAny = false
    for (const entry of this.glassContentOrder) {
      try {
        ;(this.device.queue as GPUQueueWithElementCopy).copyElementImageToTexture(
          entry.html.host,
          entry.deviceWidth,
          entry.deviceHeight,
          {
            texture: this.glassContentAtlas,
            origin: {
              x: entry.atlasX + CONTENT_ATLAS_PADDING,
              y: entry.atlasY + CONTENT_ATLAS_PADDING,
              z: 0,
            },
          },
        )
        entry.copiedDeviceWidth = entry.deviceWidth
        entry.copiedDeviceHeight = entry.deviceHeight
        copiedAny = true
      } catch (error) {
        copiedAll = false
        if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
          console.error(error)
        }
      }
    }

    if (copiedAny) {
      this.writeContentEntries(this.glassContentOrder)
    }

    this.needsContentCopy = !copiedAll
    return copiedAll
  }

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

  private packShapes(container: Container, containerTransform: Matrix2D): PackedShapesResult {
    const dpr = this.currentDpr
    const glasses = this.getSortedGlasses(container)
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

      const contentRange = this.glassContentRanges.get(glass)
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

    this.ensureBackdropMetricsResources(state)
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
      !this.contentEntriesBuffer?.buffer ||
      !this.targets
    ) {
      return
    }

    // The shader never reads this when all content ranges are empty, but the
    // bind group still needs a valid texture for the fixed glass pipeline layout.
    const contentTexture = this.glassContentAtlas ?? sharpSource

    const bindGroup = createPipelineBindGroup(this.device, this.glassPipeline, [
      { binding: 0, resource: this.globalsBuffer.bindingResource },
      { binding: 1, resource: this.shapesBuffer.bindingResource },
      { binding: 2, resource: this.sampler },
      { binding: 3, resource: sharpSource.createView() },
      { binding: 4, resource: this.targets.blur.createView() },
      { binding: 5, resource: contentTexture.createView() },
      { binding: 6, resource: this.contentEntriesBuffer.bindingResource },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.glassPipeline,
      bindGroup,
      target,
    })
  }

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

  private drawFrame(layers = this.getSortedSceneLayers()) {
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
        const htmlEntry = this.sceneHtmlEntries.get(entry.child)
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

      const metricsState = this.trackedBackdropContainers.has(entry.child)
        ? this.getOrCreateBackdropMetricsState(entry.child)
        : null
      let scheduledMetricsReadback = false

      if (metricsState) {
        seenContainers.add(entry.child)
        scheduledMetricsReadback = this.renderBackdropMetrics(composer.encoder, metricsState, packedShapes.bounds)
      }

      this.renderContainer(composer.encoder, composer.current, composer.next)
      composer.submitAndSwap()

      if (metricsState && scheduledMetricsReadback) {
        this.scheduleBackdropMetricsReadback(metricsState)
      }
    }

    for (const trackedContainer of this.trackedBackdropContainers) {
      const state = this.backdropMetricsStateByContainer.get(trackedContainer)
      if (!state) {
        continue
      }

      state.inScene = seenContainers.has(trackedContainer)
      if (!state.inScene) {
        state.metrics = null
      }
    }

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
