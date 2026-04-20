import {
  composeTransform,
  getMinimumScale,
  invertMatrix,
  multiplyMatrices,
  scaleOutputMatrix,
  type Matrix2D,
} from './matrix'
import { Container, flattenContainers, Scene } from './scene'
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

type HTMLCanvasElementWithSubtree = HTMLCanvasElement & {
  requestPaint?: () => void
}

type GPUQueueWithElementCopy = GPUQueue & {
  copyElementImageToTexture: (
    source: Element,
    width: number,
    height: number,
    destination: { texture: GPUTexture },
  ) => void
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

type BackdropMetricsState = {
  container: Container
  readbackBuffer: GPUBuffer | null
  metrics: BackdropMetrics | null
  pendingReadback: boolean
  inScene: boolean
  cleanupAfterPending: boolean
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

  private initPromise: Promise<void> | null = null
  private initError: unknown = null
  private destroyed = false
  private initialized = false
  private backgroundReady = false
  private pendingRender = false
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

  private readonly handlePaintEvent = () => {
    if (this.destroyed || !this.device || !this.targets) {
      return
    }

    this.copyBackgroundElement()
    this.backgroundReady = true

    if (this.pendingRender) {
      this.drawFrame()
    }
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
    this.targetCanvas.append(this.htmlRoot)
    this.targetCanvas.addEventListener('paint', this.handlePaintEvent as EventListener)

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
    if (!this.initialized) {
      return
    }

    this.drawFrame()
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
    this.resizeObserver?.disconnect()
    destroyTargets(this.targets)
    this.targets = null
    this.backdropMetricsTarget?.destroy()
    this.backdropMetricsTarget = null
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

    this.syncCanvasSize()
    this.targetCanvas.requestPaint?.()
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
      this.targetCanvas.requestPaint?.()
    }

    this.context.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'opaque',
    })
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
      size: nextCapacity * 16 * Float32Array.BYTES_PER_ELEMENT,
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
    this.globals[15] = 0

    this.globals[16] = container.specularStrength
    this.globals[17] = container.specularWidth * dpr
    this.globals[18] = container.specularSharpness
    this.globals[19] = container.specularOpacity

    this.globals[20] = container.oppositeSpecularStrength
    this.globals[21] = container.reflectionOffset * dpr
    this.globals[22] = container.oppositeSpecularWidth * dpr
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
    const packed = new Float32Array(Math.max(container._children.length, 1) * 16)
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

      const offset = activeCount * 16
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

    const bindGroup = this.device.createBindGroup({
      layout: this.glassPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuffer } },
        { binding: 1, resource: { buffer: this.shapesBuffer } },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: sharpSource.createView() },
        { binding: 4, resource: this.targets.blur.createView() },
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

  private drawFrame() {
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

    this.syncCanvasSize()
    if (!this.targets || !this.backgroundReady) {
      this.targetCanvas.requestPaint?.()
      return
    }

    const containers = flattenContainers(this.scene).sort(
      (left, right) => left.container.zIndex - right.container.zIndex || left.traversalIndex - right.traversalIndex,
    )
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
