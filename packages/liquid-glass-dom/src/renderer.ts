import { GlassPointerEvent, type GlassPointerEventType } from './events'
import {
  composeTransform,
  getMinimumScale,
  invertMatrix,
  multiplyMatrices,
  scaleOutputMatrix,
  type Matrix2D,
} from './matrix'
import { Container, flattenContainers, Glass, Scene } from './scene'
import { BLUR_SHADER, GLASS_SHADER, METRICS_SHADER, PRESENT_SHADER } from './shaders'
import type { BackdropMetrics, SurfaceProfile } from './types'

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

const BACKDROP_METRICS_SIZE = 32
const BACKDROP_METRICS_BYTES_PER_ROW = 256
const BACKDROP_METRICS_BUFFER_SIZE = BACKDROP_METRICS_BYTES_PER_ROW * BACKDROP_METRICS_SIZE
const CONTENT_ATLAS_PADDING = 1

type HTMLCanvasElementWithSubtree = HTMLCanvasElement

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
  background: GPUTexture
  blurPing: GPUTexture
  blur: GPUTexture
  sceneA: GPUTexture
  sceneB: GPUTexture
}

type BoundsRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type PackedShapesResult = {
  shapeCount: number
  bounds: BoundsRect | null
}

type GlassContentEntry = {
  glass: Glass
  host: HTMLDivElement
  contentVersion: number
  width: number
  height: number
  deviceWidth: number
  deviceHeight: number
  atlasX: number
  atlasY: number
  atlasWidth: number
  atlasHeight: number
  contentU: number
  contentV: number
  contentScaleU: number
  contentScaleV: number
}

type ContentLayoutRect = {
  x: number
  y: number
  width: number
  height: number
}

type ContentAtlasLayout = {
  width: number
  height: number
  rects: Map<Glass, ContentLayoutRect>
}

type BackdropMetricsState = {
  container: Container
  readbackBuffer: GPUBuffer | null
  metrics: BackdropMetrics | null
  pendingReadback: boolean
  inScene: boolean
  cleanupAfterPending: boolean
}

type GlassInteractionEntry = {
  glass: Glass
  container: Container
  containerOrder: number
  glassOrder: number
  transform: Matrix2D
  inverseTransform: Matrix2D
  halfWidth: number
  halfHeight: number
  cornerRadius: number
  cornerTransitionSpeed: number
}

type PointerSnapshot = {
  nativeEvent: PointerEvent
  canvasX: number
  canvasY: number
}

type PointerState = {
  hoveredGlass: Glass | null
  capturedGlass: Glass | null
  pressedGlass: Glass | null
  lastSnapshot: PointerSnapshot | null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createRenderTarget(
  device: GPUDevice,
  format: GPUTextureFormat,
  width: number,
  height: number,
  extraUsage = 0,
) {
  return device.createTexture({
    size: {
      width,
      height,
      depthOrArrayLayers: 1,
    },
    format,
    usage:
      GPU_TEXTURE_USAGE.TEXTURE_BINDING |
      GPU_TEXTURE_USAGE.RENDER_ATTACHMENT |
      GPU_TEXTURE_USAGE.COPY_DST |
      extraUsage,
  })
}

function destroyTargets(targets: RenderTargetSet | null) {
  if (!targets) {
    return
  }

  targets.background.destroy()
  targets.blurPing.destroy()
  targets.blur.destroy()
  targets.sceneA.destroy()
  targets.sceneB.destroy()
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

function transformPoint(matrix: Matrix2D, x: number, y: number) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }
}

function matrixToCssTransform(matrix: Matrix2D) {
  return `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${matrix.e}, ${matrix.f})`
}

function squircleLength(x: number, y: number) {
  return ((x ** 4 + y ** 4) ** 0.25)
}

function circularLength(x: number, y: number) {
  return Math.hypot(x, y)
}

function sdRoundRect(
  localX: number,
  localY: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
  cornerTransitionSpeed: number,
) {
  const cornerLimit = Math.min(halfWidth, halfHeight)
  const clampedRadius = Math.min(radius, cornerLimit)
  const blendDistance = Math.max(cornerTransitionSpeed, 0.0001)
  const circleBlend = clamp((radius - cornerLimit) / blendDistance, 0, 1)
  const qx = Math.abs(localX) - halfWidth + clampedRadius
  const qy = Math.abs(localY) - halfHeight + clampedRadius
  const cornerX = Math.max(qx, 0)
  const cornerY = Math.max(qy, 0)
  const cornerDistance =
    squircleLength(cornerX, cornerY) * (1 - circleBlend) +
    circularLength(cornerX, cornerY) * circleBlend
  return cornerDistance + Math.min(Math.max(qx, qy), 0) - clampedRadius
}

function createEmptyBounds(): BoundsRect {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  }
}

function expandBounds(bounds: BoundsRect, x: number, y: number) {
  bounds.minX = Math.min(bounds.minX, x)
  bounds.minY = Math.min(bounds.minY, y)
  bounds.maxX = Math.max(bounds.maxX, x)
  bounds.maxY = Math.max(bounds.maxY, y)
}

function hasBounds(bounds: BoundsRect) {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    bounds.maxX > bounds.minX &&
    bounds.maxY > bounds.minY
  )
}

function srgbToLinear(channel: number) {
  if (channel <= 0.04045) {
    return channel / 12.92
  }

  return ((channel + 0.055) / 1.055) ** 2.4
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0
  }

  if (values.length === 1) {
    return values[0]
  }

  const index = clamp((values.length - 1) * p, 0, values.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const blend = index - lower
  return values[lower] + (values[upper] - values[lower]) * blend
}

function nextPowerOfTwo(value: number) {
  let next = 1
  while (next < value) {
    next *= 2
  }
  return next
}

function tryPackContentAtlas(entries: GlassContentEntry[], atlasWidth: number) {
  const rects = new Map<Glass, ContentLayoutRect>()
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const entry of entries) {
    const rectWidth = entry.deviceWidth + CONTENT_ATLAS_PADDING * 2
    const rectHeight = entry.deviceHeight + CONTENT_ATLAS_PADDING * 2

    if (rectWidth > atlasWidth) {
      return null
    }

    if (cursorX > 0 && cursorX + rectWidth > atlasWidth) {
      cursorX = 0
      cursorY += rowHeight
      rowHeight = 0
    }

    rects.set(entry.glass, {
      x: cursorX,
      y: cursorY,
      width: rectWidth,
      height: rectHeight,
    })

    cursorX += rectWidth
    rowHeight = Math.max(rowHeight, rectHeight)
  }

  return {
    width: atlasWidth,
    height: cursorY + rowHeight,
    rects,
  }
}

function packContentAtlas(entries: GlassContentEntry[], maxTextureSize: number): ContentAtlasLayout {
  if (entries.length === 0) {
    throw new Error('Cannot build a glass content atlas without any content entries.')
  }

  let maxEntryWidth = 1
  for (const entry of entries) {
    maxEntryWidth = Math.max(maxEntryWidth, entry.deviceWidth + CONTENT_ATLAS_PADDING * 2)
  }

  let atlasWidth = nextPowerOfTwo(maxEntryWidth)
  while (atlasWidth <= maxTextureSize) {
    const layout = tryPackContentAtlas(entries, atlasWidth)
    if (layout && layout.height <= maxTextureSize) {
      return layout
    }

    atlasWidth *= 2
  }

  throw new Error('Glass content atlas exceeds the maximum supported texture size.')
}

function parseBackdropMetrics(buffer: GPUBuffer): BackdropMetrics | null {
  const bytes = new Uint8Array(buffer.getMappedRange())
  const luminances: number[] = []
  let red = 0
  let green = 0
  let blue = 0

  for (let y = 0; y < BACKDROP_METRICS_SIZE; y += 1) {
    const rowOffset = y * BACKDROP_METRICS_BYTES_PER_ROW

    for (let x = 0; x < BACKDROP_METRICS_SIZE; x += 1) {
      const offset = rowOffset + x * 4
      const alpha = bytes[offset + 3] / 255
      if (alpha <= 0.5) {
        continue
      }

      const linearRed = bytes[offset] / 255
      const linearGreen = bytes[offset + 1] / 255
      const linearBlue = bytes[offset + 2] / 255
      const luminance = linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722

      red += linearRed
      green += linearGreen
      blue += linearBlue
      luminances.push(luminance)
    }
  }

  if (luminances.length === 0) {
    return null
  }

  luminances.sort((left, right) => left - right)

  const count = luminances.length
  return {
    averageLinearColor: {
      r: red / count,
      g: green / count,
      b: blue / count,
    },
    averageLuminance: luminances.reduce((sum, value) => sum + value, 0) / count,
    luminanceP10: percentile(luminances, 0.1),
    luminanceP50: percentile(luminances, 0.5),
    luminanceP90: percentile(luminances, 0.9),
  }
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
  /** Immediate child of the canvas whose DOM contents are copied into the backdrop texture. */
  readonly htmlRoot: HTMLDivElement
  /** Maximum device pixel ratio used for internal render targets. */
  maxDpr: number

  private readonly targetCanvas: HTMLCanvasElementWithSubtree
  private readonly globals = new Float32Array(32)
  private readonly blurHorizontalParams = new Float32Array(4)
  private readonly blurVerticalParams = new Float32Array(4)
  private readonly backdropMetricsBounds = new Float32Array(4)
  private readonly backdropMetricsStateByContainer = new WeakMap<Container, BackdropMetricsState>()
  private readonly trackedBackdropContainers = new Set<Container>()
  private readonly pendingBackdropMetricStates = new Set<BackdropMetricsState>()
  private readonly glassContentEntries = new Map<Glass, GlassContentEntry>()
  private readonly glassContentHosts = new Set<HTMLDivElement>()
  private glassInteractionEntries = new Map<Glass, GlassInteractionEntry>()
  private glassInteractionOrder: GlassInteractionEntry[] = []
  private readonly pointerStates = new Map<number, PointerState>()

  private initPromise: Promise<void> | null = null
  private unsubscribeSceneMutations: (() => void) | null = null
  private initError: unknown = null
  private destroyed = false
  private initialized = false
  private backgroundReady = false
  private contentReady = true
  private needsBackgroundCopy = true
  private needsContentCopy = false
  private pendingRender = false
  private pendingSceneContentSync = true
  private sceneContentSyncQueued = false
  private currentDpr = 1
  private resizeObserver: ResizeObserver | null = null

  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private presentationFormat: GPUTextureFormat | null = null
  private globalsBuffer: GPUBuffer | null = null
  private shapesBuffer: GPUBuffer | null = null
  private shapeCapacity = 0
  private blurHorizontalBuffer: GPUBuffer | null = null
  private blurVerticalBuffer: GPUBuffer | null = null
  private backdropMetricsBoundsBuffer: GPUBuffer | null = null
  private sampler: GPUSampler | null = null
  private blurPipeline: GPURenderPipeline | null = null
  private glassPipeline: GPURenderPipeline | null = null
  private backdropMetricsPipeline: GPURenderPipeline | null = null
  private presentPipeline: GPURenderPipeline | null = null
  private targets: RenderTargetSet | null = null
  private backdropMetricsTarget: GPUTexture | null = null
  private emptyContentTexture: GPUTexture | null = null
  private glassContentAtlas: GPUTexture | null = null
  private glassContentAtlasWidth = 0
  private glassContentAtlasHeight = 0

  private readonly handlePaintEvent = (event: Event) => {
    if (this.destroyed || !this.device || !this.targets) {
      return
    }

    const changedElements = (event as CanvasPaintEvent).changedElements
    const hasChangedElements = Array.isArray(changedElements)
    const shouldCopyBackground =
      this.needsBackgroundCopy ||
      !hasChangedElements ||
      changedElements.includes(this.htmlRoot)
    const shouldCopyContent =
      this.needsContentCopy ||
      !hasChangedElements ||
      changedElements.some((element) => element instanceof HTMLDivElement && this.glassContentHosts.has(element))

    if (shouldCopyBackground) {
      this.copyBackgroundElement()
      this.backgroundReady = true
      this.needsBackgroundCopy = false
    }

    if (shouldCopyContent) {
      this.copyGlassContentAtlas()
    }

    if (this.pendingRender) {
      this.drawFrame()
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
    this.targetCanvas = document.createElement('canvas') as HTMLCanvasElementWithSubtree
    this.targetCanvas.setAttribute('layoutsubtree', 'true')
    this.targetCanvas.style.display = 'block'

    this.htmlRoot = document.createElement('div')
    this.htmlRoot.style.position = 'absolute'
    this.htmlRoot.style.inset = '0'
    this.htmlRoot.style.width = '100%'
    this.htmlRoot.style.height = '100%'
    this.htmlRoot.style.overflow = 'hidden'
    this.htmlRoot.style.zIndex = '0'
    this.targetCanvas.append(this.htmlRoot)
    this.targetCanvas.addEventListener('paint', this.handlePaintEvent as EventListener)
    this.targetCanvas.addEventListener('pointermove', this.handlePointerMove, true)
    this.targetCanvas.addEventListener('pointerdown', this.handlePointerDown, true)
    this.targetCanvas.addEventListener('pointerup', this.handlePointerUp, true)
    this.targetCanvas.addEventListener('pointercancel', this.handlePointerCancel, true)
    this.targetCanvas.addEventListener('pointerleave', this.handlePointerLeave, true)
    this.unsubscribeSceneMutations = this.scene._subscribe(this.handleSceneMutation)

    this.canvas = this.targetCanvas
    this.initPromise = this.initialize().catch((error) => {
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

    this.pendingRender = true
    const containers = this.syncSceneNow()
    if (!this.initialized) {
      return
    }

    this.drawFrame(containers)
  }

  /**
   * Tears down observers, event listeners, and GPU resources owned by this renderer.
   */
  destroy() {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.pendingRender = false
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
    this.backdropMetricsTarget?.destroy()
    this.backdropMetricsTarget = null
    this.glassContentAtlas?.destroy()
    this.glassContentAtlas = null
    this.glassContentAtlasWidth = 0
    this.glassContentAtlasHeight = 0
    this.emptyContentTexture?.destroy()
    this.emptyContentTexture = null
    this.globalsBuffer?.destroy()
    this.shapesBuffer?.destroy()
    this.blurHorizontalBuffer?.destroy()
    this.blurVerticalBuffer?.destroy()
    this.backdropMetricsBoundsBuffer?.destroy()

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

    for (const entry of this.glassContentEntries.values()) {
      entry.host.remove()
    }
    this.glassContentEntries.clear()
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

    const globalsBuffer = device.createBuffer({
      size: this.globals.byteLength,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    })

    const blurHorizontalBuffer = device.createBuffer({
      size: this.blurHorizontalParams.byteLength,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    })

    const blurVerticalBuffer = device.createBuffer({
      size: this.blurVerticalParams.byteLength,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    })

    const backdropMetricsBoundsBuffer = device.createBuffer({
      size: this.backdropMetricsBounds.byteLength,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    })

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

    const presentPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: PRESENT_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: PRESENT_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format: presentationFormat }],
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

    const emptyContentTexture = device.createTexture({
      size: {
        width: 1,
        height: 1,
        depthOrArrayLayers: 1,
      },
      format: presentationFormat,
      usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: emptyContentTexture },
      new Uint8Array([0, 0, 0, 0]),
      { bytesPerRow: 4 },
      {
        width: 1,
        height: 1,
        depthOrArrayLayers: 1,
      },
    )

    this.device = device
    this.context = context
    this.presentationFormat = presentationFormat
    this.sampler = sampler
    this.globalsBuffer = globalsBuffer
    this.blurHorizontalBuffer = blurHorizontalBuffer
    this.blurVerticalBuffer = blurVerticalBuffer
    this.backdropMetricsBoundsBuffer = backdropMetricsBoundsBuffer
    this.blurPipeline = blurPipeline
    this.glassPipeline = glassPipeline
    this.backdropMetricsPipeline = backdropMetricsPipeline
    this.presentPipeline = presentPipeline
    this.backdropMetricsTarget = backdropMetricsTarget
    this.emptyContentTexture = emptyContentTexture
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
      this.targetCanvas.width = nextWidth
      this.targetCanvas.height = nextHeight
      destroyTargets(this.targets)
      this.targets = {
        background: createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight),
        blurPing: createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight),
        blur: createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight),
        sceneA: createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight),
        sceneB: createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight),
      }
      this.backgroundReady = false
      this.contentReady = this.glassContentEntries.size === 0
      this.needsBackgroundCopy = true
      this.needsContentCopy = this.glassContentEntries.size > 0
    }

    this.context.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'opaque',
    })

    this.syncSceneNow()
  }

  private ensureShapesBuffer(requiredCount: number) {
    if (!this.device) {
      return
    }

    const nextCapacity = Math.max(requiredCount, 1)
    if (this.shapesBuffer && nextCapacity <= this.shapeCapacity) {
      return
    }

    this.shapesBuffer?.destroy()
    this.shapesBuffer = this.device.createBuffer({
      size: nextCapacity * 20 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
    })
    this.shapeCapacity = nextCapacity
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

  private copyBackgroundElement() {
    if (!this.device || !this.targets) {
      return
    }

    ;(this.device.queue as GPUQueueWithElementCopy).copyElementImageToTexture(
      this.htmlRoot,
      this.targetCanvas.width,
      this.targetCanvas.height,
      { texture: this.targets.background },
    )
  }

  private createGlassContentHost() {
    const host = document.createElement('div')
    host.style.position = 'absolute'
    host.style.left = '0'
    host.style.top = '0'
    host.style.display = 'block'
    host.style.overflow = 'hidden'
    host.style.contain = 'paint'
    host.style.transformOrigin = '0 0'
    this.targetCanvas.prepend(host)
    this.glassContentHosts.add(host)
    return host
  }

  private removeGlassContentEntry(glass: Glass) {
    const entry = this.glassContentEntries.get(glass)
    if (!entry) {
      return
    }

    entry.host.remove()
    this.glassContentHosts.delete(entry.host)
    this.glassContentEntries.delete(glass)
  }

  private getSortedContainers() {
    return flattenContainers(this.scene).sort(
      (left, right) =>
        left.container.zIndex - right.container.zIndex || left.traversalIndex - right.traversalIndex,
    )
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
    const containers = this.getSortedContainers()

    this.syncGlassInteractions(containers)
    if (this.initialized && this.device) {
      this.syncGlassContent(containers)
    }

    this.pendingSceneContentSync = false
    return containers
  }

  private syncGlassInteractions(containers: ReturnType<typeof flattenContainers>) {
    const previousEntries = this.glassInteractionEntries
    const nextEntries = new Map<Glass, GlassInteractionEntry>()
    const nextOrder: GlassInteractionEntry[] = []

    for (let containerOrder = 0; containerOrder < containers.length; containerOrder += 1) {
      const entry = containers[containerOrder]

      for (let glassOrder = 0; glassOrder < entry.container._children.length; glassOrder += 1) {
        const glass = entry.container._children[glassOrder]
        if (glass.width <= 0 || glass.height <= 0) {
          continue
        }

        const transform = multiplyMatrices(entry.transform, composeTransform(glass))
        const inverseTransform = invertMatrix(transform)
        if (!inverseTransform) {
          continue
        }

        const interactionEntry = {
          glass,
          container: entry.container,
          containerOrder,
          glassOrder,
          transform,
          inverseTransform,
          halfWidth: glass.width * 0.5,
          halfHeight: glass.height * 0.5,
          cornerRadius: glass.cornerRadius,
          cornerTransitionSpeed: glass.cornerTransitionSpeed,
        } satisfies GlassInteractionEntry

        nextEntries.set(glass, interactionEntry)
        nextOrder.push(interactionEntry)
      }
    }

    nextOrder.sort(
      (left, right) =>
        left.containerOrder - right.containerOrder ||
        left.glass.zIndex - right.glass.zIndex ||
        left.glassOrder - right.glassOrder,
    )

    this.glassInteractionEntries = nextEntries
    this.glassInteractionOrder = nextOrder
    this.handleRemovedInteractionTargets(previousEntries)
  }

  private measureInteractionEntry(entry: GlassInteractionEntry, canvasX: number, canvasY: number) {
    const localPoint = transformPoint(entry.inverseTransform, canvasX, canvasY)
    const centeredX = localPoint.x - entry.halfWidth
    const centeredY = localPoint.y - entry.halfHeight
    return {
      localX: localPoint.x,
      localY: localPoint.y,
      inside:
        sdRoundRect(
          centeredX,
          centeredY,
          entry.halfWidth,
          entry.halfHeight,
          entry.cornerRadius,
          entry.cornerTransitionSpeed,
        ) <= 0,
    }
  }

  private hitTestGlassAt(canvasX: number, canvasY: number) {
    for (let index = this.glassInteractionOrder.length - 1; index >= 0; index -= 1) {
      const entry = this.glassInteractionOrder[index]
      if (this.measureInteractionEntry(entry, canvasX, canvasY).inside) {
        return entry
      }
    }

    return null
  }

  private getPointerState(pointerId: number) {
    let state = this.pointerStates.get(pointerId)
    if (state) {
      return state
    }

    state = {
      hoveredGlass: null,
      capturedGlass: null,
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
      ? this.measureInteractionEntry(entry, snapshot.canvasX, snapshot.canvasY)
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
        this.updateHoveredGlass(state, this.hitTestGlassAt(snapshot.canvasX, snapshot.canvasY), snapshot)
      }

      this.cleanupPointerState(pointerId, state)
    }
  }

  private handleNativePointerEvent(type: GlassPointerEventType, event: PointerEvent) {
    if (this.destroyed) {
      return
    }

    if (this.pendingSceneContentSync) {
      this.syncSceneNow()
    }

    const state = this.getPointerState(event.pointerId)
    const snapshot = this.createPointerSnapshot(event)
    state.lastSnapshot = snapshot

    const capturedEntry = state.capturedGlass
      ? this.glassInteractionEntries.get(state.capturedGlass) ?? null
      : null

    if (capturedEntry) {
      if (type === 'pointerleave') {
        return
      }

      const measurement = this.measureInteractionEntry(capturedEntry, snapshot.canvasX, snapshot.canvasY)
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
        state.pressedGlass = null
        this.releaseNativePointerCapture(event.pointerId)
        this.updateHoveredGlass(state, this.hitTestGlassAt(snapshot.canvasX, snapshot.canvasY), snapshot)
      }

      if (this.pendingSceneContentSync) {
        this.syncSceneNow()
      }
      this.cleanupPointerState(event.pointerId, state)
      return
    }

    if (type === 'pointerleave') {
      if (state.hoveredGlass) {
        const hoveredEntry = this.glassInteractionEntries.get(state.hoveredGlass) ?? null
        this.dispatchGlassPointerEvent('pointerleave', state.hoveredGlass, hoveredEntry, snapshot, false)
        state.hoveredGlass = null
      }

      if (this.pendingSceneContentSync) {
        this.syncSceneNow()
      }
      this.cleanupPointerState(event.pointerId, state)
      return
    }

    const hitEntry = this.hitTestGlassAt(snapshot.canvasX, snapshot.canvasY)
    this.updateHoveredGlass(state, hitEntry, snapshot)

    if (hitEntry) {
      this.dispatchGlassPointerEvent(type, hitEntry.glass, hitEntry, snapshot, true)

      if (type === 'pointerdown') {
        state.pressedGlass = hitEntry.glass
        if (this.pendingSceneContentSync) {
          this.syncSceneNow()
        }

        if (this.glassInteractionEntries.has(hitEntry.glass)) {
          state.capturedGlass = hitEntry.glass
          try {
            this.targetCanvas.setPointerCapture(event.pointerId)
          } catch {
            state.capturedGlass = null
            state.pressedGlass = null
          }
        }
      }
    }

    if (this.pendingSceneContentSync) {
      this.syncSceneNow()
    }
    this.cleanupPointerState(event.pointerId, state)
  }

  private syncGlassContent(containers: ReturnType<typeof flattenContainers>) {
    if (!this.device) {
      return false
    }

    const activeGlasses = new Set<Glass>()
    const activeEntries: GlassContentEntry[] = []
    let layoutChanged = false
    let contentChanged = false

    for (const entry of containers) {
      const containerTransform = entry.transform

      for (const glass of entry.container._children) {
        const content = glass.content
        if (!content || glass.width <= 0 || glass.height <= 0) {
          continue
        }

        activeGlasses.add(glass)

        let contentEntry = this.glassContentEntries.get(glass)
        if (!contentEntry) {
          contentEntry = {
            glass,
            host: this.createGlassContentHost(),
            contentVersion: -1,
            width: -1,
            height: -1,
            deviceWidth: 0,
            deviceHeight: 0,
            atlasX: 0,
            atlasY: 0,
            atlasWidth: 0,
            atlasHeight: 0,
            contentU: 0,
            contentV: 0,
            contentScaleU: 0,
            contentScaleV: 0,
          }
          this.glassContentEntries.set(glass, contentEntry)
          layoutChanged = true
          contentChanged = true
        }

        if (contentEntry.contentVersion !== glass._contentVersion || content.parentElement !== contentEntry.host) {
          contentEntry.host.replaceChildren()
          contentEntry.host.append(content)
          contentEntry.contentVersion = glass._contentVersion
          contentChanged = true
        }

        const nextDeviceWidth = Math.max(1, Math.round(glass.width * this.currentDpr))
        const nextDeviceHeight = Math.max(1, Math.round(glass.height * this.currentDpr))
        if (
          contentEntry.width !== glass.width ||
          contentEntry.height !== glass.height ||
          contentEntry.deviceWidth !== nextDeviceWidth ||
          contentEntry.deviceHeight !== nextDeviceHeight
        ) {
          contentEntry.width = glass.width
          contentEntry.height = glass.height
          contentEntry.deviceWidth = nextDeviceWidth
          contentEntry.deviceHeight = nextDeviceHeight
          contentEntry.host.style.width = `${glass.width}px`
          contentEntry.host.style.height = `${glass.height}px`
          layoutChanged = true
          contentChanged = true
        }

        contentEntry.host.style.transform = matrixToCssTransform(
          multiplyMatrices(containerTransform, composeTransform(glass)),
        )

        activeEntries.push(contentEntry)
      }
    }

    const entryOrder = new Map<GlassContentEntry, number>()
    for (let index = 0; index < activeEntries.length; index += 1) {
      entryOrder.set(activeEntries[index], index)
    }

    const sortedInteractionEntries = [...activeEntries].sort(
      (left, right) =>
        left.glass.zIndex - right.glass.zIndex || (entryOrder.get(left) ?? 0) - (entryOrder.get(right) ?? 0),
    )
    for (let index = 0; index < sortedInteractionEntries.length; index += 1) {
      sortedInteractionEntries[index].host.style.zIndex = String(index + 1)
    }

    for (const glass of this.glassContentEntries.keys()) {
      if (!activeGlasses.has(glass)) {
        this.removeGlassContentEntry(glass)
        layoutChanged = true
        contentChanged = true
      }
    }

    if (activeEntries.length === 0) {
      this.glassContentAtlas?.destroy()
      this.glassContentAtlas = null
      this.glassContentAtlasWidth = 0
      this.glassContentAtlasHeight = 0
      this.contentReady = true
      this.needsContentCopy = false
      return true
    }

    if (layoutChanged) {
      const layout = packContentAtlas(activeEntries, this.device.limits.maxTextureDimension2D)
      const nextAtlasWidth = Math.max(layout.width, 1)
      const nextAtlasHeight = Math.max(layout.height, 1)
      const rebuildAtlas =
        !this.glassContentAtlas ||
        nextAtlasWidth !== this.glassContentAtlasWidth ||
        nextAtlasHeight !== this.glassContentAtlasHeight

      if (
        rebuildAtlas ||
        activeEntries.some(
          (entry) =>
            entry.atlasWidth !== nextAtlasWidth ||
            entry.atlasHeight !== nextAtlasHeight ||
            !layout.rects.has(entry.glass),
        )
      ) {
        this.glassContentAtlas?.destroy()
        this.glassContentAtlas = this.device.createTexture({
          size: {
            width: nextAtlasWidth,
            height: nextAtlasHeight,
            depthOrArrayLayers: 1,
          },
          format: this.presentationFormat ?? 'bgra8unorm',
          usage:
            GPU_TEXTURE_USAGE.TEXTURE_BINDING |
            GPU_TEXTURE_USAGE.COPY_DST |
            GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
        })
        this.glassContentAtlasWidth = nextAtlasWidth
        this.glassContentAtlasHeight = nextAtlasHeight
      }

      for (const entry of activeEntries) {
        const rect = layout.rects.get(entry.glass)
        if (!rect) {
          continue
        }

        entry.atlasX = rect.x
        entry.atlasY = rect.y
        entry.atlasWidth = nextAtlasWidth
        entry.atlasHeight = nextAtlasHeight
        entry.contentU = (rect.x + CONTENT_ATLAS_PADDING) / nextAtlasWidth
        entry.contentV = (rect.y + CONTENT_ATLAS_PADDING) / nextAtlasHeight
        entry.contentScaleU = entry.deviceWidth / nextAtlasWidth
        entry.contentScaleV = entry.deviceHeight / nextAtlasHeight
      }

      this.contentReady = false
      this.needsContentCopy = true
    } else if (contentChanged) {
      this.contentReady = false
      this.needsContentCopy = true
    }

    return this.contentReady
  }

  private copyGlassContentAtlas() {
    if (!this.device || !this.glassContentAtlas || this.glassContentEntries.size === 0) {
      this.contentReady = true
      this.needsContentCopy = false
      return
    }

    for (const entry of this.glassContentEntries.values()) {
      ;(this.device.queue as GPUQueueWithElementCopy).copyElementImageToTexture(
        entry.host,
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
    }

    this.contentReady = true
    this.needsContentCopy = false
  }

  private writeGlobals(container: Container, shapeCount: number) {
    if (!this.device || !this.globalsBuffer) {
      return
    }

    const width = this.targetCanvas.width
    const height = this.targetCanvas.height
    const dpr = this.currentDpr

    this.globals[0] = width
    this.globals[1] = height
    this.globals[2] = 0
    this.globals[3] = 0

    this.globals[4] = container.spacing * dpr
    this.globals[5] = container.blur * dpr
    this.globals[6] = 0
    this.globals[7] = container.bezelWidth * dpr

    this.globals[8] = container.thickness * dpr
    this.globals[9] = container.displacementFactor
    this.globals[10] = container.ior
    this.globals[11] = container.dispersion

    this.globals[12] = Math.sin(container.lightDirection)
    this.globals[13] = -Math.cos(container.lightDirection)
    this.globals[14] = container.specularFalloff
    this.globals[15] = container.contentIor

    this.globals[16] = container.specularStrength
    this.globals[17] = container.specularWidth * dpr
    this.globals[18] = container.specularSharpness
    this.globals[19] = container.specularOpacity

    this.globals[20] = container.oppositeSpecularStrength
    this.globals[21] = container.reflectionOffset * dpr
    this.globals[22] = container.contentDepth * dpr
    this.globals[23] = shapeCount

    this.globals[24] = container.tint.r
    this.globals[25] = container.tint.g
    this.globals[26] = container.tint.b
    this.globals[27] = container.tint.a

    this.globals[28] = getSurfaceProfileIndex(container.surfaceProfile)
    this.globals[29] = 0
    this.globals[30] = 0
    this.globals[31] = 0

    this.device.queue.writeBuffer(this.globalsBuffer, 0, this.globals)
  }

  private writeBlurParams(container: Container) {
    if (!this.device || !this.blurHorizontalBuffer || !this.blurVerticalBuffer) {
      return
    }

    const blurRadius = container.blur * this.currentDpr
    this.blurHorizontalParams[0] = 1
    this.blurHorizontalParams[1] = 0
    this.blurHorizontalParams[2] = blurRadius
    this.blurHorizontalParams[3] = 0

    this.blurVerticalParams[0] = 0
    this.blurVerticalParams[1] = 1
    this.blurVerticalParams[2] = blurRadius
    this.blurVerticalParams[3] = 0

    this.device.queue.writeBuffer(this.blurHorizontalBuffer, 0, this.blurHorizontalParams)
    this.device.queue.writeBuffer(this.blurVerticalBuffer, 0, this.blurVerticalParams)
  }

  private writeBackdropMetricsBounds(bounds: BoundsRect) {
    if (!this.device || !this.backdropMetricsBoundsBuffer) {
      return
    }

    this.backdropMetricsBounds[0] = bounds.minX
    this.backdropMetricsBounds[1] = bounds.minY
    this.backdropMetricsBounds[2] = bounds.maxX
    this.backdropMetricsBounds[3] = bounds.maxY
    this.device.queue.writeBuffer(this.backdropMetricsBoundsBuffer, 0, this.backdropMetricsBounds)
  }

  private packShapes(container: Container, containerTransform: Matrix2D): PackedShapesResult {
    const dpr = this.currentDpr
    const packed = new Float32Array(Math.max(container._children.length, 1) * 20)
    const bounds = createEmptyBounds()
    let activeCount = 0

    for (const glass of container._children) {
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

      const offset = activeCount * 20
      const contentEntry = this.glassContentEntries.get(glass)
      const halfWidth = glass.width * 0.5
      const halfHeight = glass.height * 0.5
      packed[offset + 0] = inverse.a
      packed[offset + 1] = inverse.c
      packed[offset + 2] = inverse.e
      packed[offset + 3] = getMinimumScale(worldDevice)

      packed[offset + 4] = inverse.b
      packed[offset + 5] = inverse.d
      packed[offset + 6] = inverse.f
      packed[offset + 7] = glass.cornerRadius

      packed[offset + 8] = halfWidth
      packed[offset + 9] = halfHeight
      packed[offset + 10] = halfWidth
      packed[offset + 11] = halfHeight

      packed[offset + 12] = glass.cornerTransitionSpeed
      packed[offset + 13] = 0
      packed[offset + 14] = 0
      packed[offset + 15] = 0

      packed[offset + 16] = contentEntry?.contentU ?? 0
      packed[offset + 17] = contentEntry?.contentV ?? 0
      packed[offset + 18] = contentEntry?.contentScaleU ?? 0
      packed[offset + 19] = contentEntry?.contentScaleV ?? 0

      activeCount += 1
    }

    this.ensureShapesBuffer(activeCount)
    if (this.device && this.shapesBuffer) {
      this.device.queue.writeBuffer(this.shapesBuffer, 0, packed)
    }

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

    const horizontalBindGroup = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: source.createView() },
        { binding: 2, resource: { buffer: this.blurHorizontalBuffer } },
      ],
    })

    const horizontalPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
          view: this.targets.blurPing.createView(),
        },
      ],
    })
    horizontalPass.setPipeline(this.blurPipeline)
    horizontalPass.setBindGroup(0, horizontalBindGroup)
    horizontalPass.draw(3)
    horizontalPass.end()

    const verticalBindGroup = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.targets.blurPing.createView() },
        { binding: 2, resource: { buffer: this.blurVerticalBuffer } },
      ],
    })

    const verticalPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
          view: this.targets.blur.createView(),
        },
      ],
    })
    verticalPass.setPipeline(this.blurPipeline)
    verticalPass.setBindGroup(0, verticalBindGroup)
    verticalPass.draw(3)
    verticalPass.end()
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
      !this.shapesBuffer ||
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

    const bindGroup = this.device.createBindGroup({
      layout: this.backdropMetricsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuffer } },
        { binding: 1, resource: { buffer: this.shapesBuffer } },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: this.targets.blur.createView() },
        { binding: 4, resource: { buffer: this.backdropMetricsBoundsBuffer } },
      ],
    })

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
          view: this.backdropMetricsTarget.createView(),
        },
      ],
    })
    pass.setPipeline(this.backdropMetricsPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()

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
      !this.shapesBuffer ||
      !this.targets
    ) {
      return
    }

    const contentTexture = this.glassContentAtlas ?? this.emptyContentTexture
    if (!contentTexture) {
      return
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.glassPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuffer } },
        { binding: 1, resource: { buffer: this.shapesBuffer } },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: sharpSource.createView() },
        { binding: 4, resource: this.targets.blur.createView() },
        { binding: 5, resource: contentTexture.createView() },
      ],
    })

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
          view: target.createView(),
        },
      ],
    })
    pass.setPipeline(this.glassPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
  }

  private presentTexture(encoder: GPUCommandEncoder, source: GPUTexture) {
    if (!this.device || !this.context || !this.sampler || !this.presentPipeline) {
      return
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: source.createView() },
      ],
    })

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
          view: this.context.getCurrentTexture().createView(),
        },
      ],
    })
    pass.setPipeline(this.presentPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
  }

  private drawFrame(containers = this.getSortedContainers()) {
    if (
      this.destroyed ||
      !this.device ||
      !this.context ||
      !this.targets ||
      !this.glassPipeline ||
      !this.blurPipeline ||
      !this.presentPipeline
    ) {
      return
    }
    if (!this.backgroundReady || !this.contentReady) {
      return
    }

    const seenContainers = new Set<Container>()

    let currentScene = this.targets.background
    let nextScene = this.targets.sceneA

    for (const entry of containers) {
      const encoder = this.device.createCommandEncoder()
      const packedShapes = this.packShapes(entry.container, entry.transform)
      this.writeGlobals(entry.container, packedShapes.shapeCount)
      this.blurTexture(encoder, currentScene, entry.container)

      const metricsState = this.trackedBackdropContainers.has(entry.container)
        ? this.getOrCreateBackdropMetricsState(entry.container)
        : null
      let scheduledMetricsReadback = false

      if (metricsState) {
        seenContainers.add(entry.container)
        scheduledMetricsReadback = this.renderBackdropMetrics(encoder, metricsState, packedShapes.bounds)
      }

      this.renderContainer(encoder, currentScene, nextScene)
      this.device.queue.submit([encoder.finish()])

      if (metricsState && scheduledMetricsReadback) {
        this.scheduleBackdropMetricsReadback(metricsState)
      }

      currentScene = nextScene
      nextScene = nextScene === this.targets.sceneA ? this.targets.sceneB : this.targets.sceneA
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

    const encoder = this.device.createCommandEncoder()
    this.presentTexture(encoder, currentScene)
    this.device.queue.submit([encoder.finish()])
    this.pendingRender = false
  }
}
