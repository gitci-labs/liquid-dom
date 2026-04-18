import { composeTransform, getMinimumScale, invertMatrix, multiplyMatrices, scaleOutputMatrix } from './matrix'
import { Container, flattenContainers, Scene } from './scene'
import { BLUR_SHADER, GLASS_SHADER, PRESENT_SHADER } from './shaders'
import type { SurfaceProfile } from './types'

const GPU_BUFFER_USAGE = {
  UNIFORM: 0x40,
  STORAGE: 0x80,
  COPY_DST: 0x08,
} as const

const GPU_TEXTURE_USAGE = {
  TEXTURE_BINDING: 0x04,
  COPY_DST: 0x02,
  RENDER_ATTACHMENT: 0x10,
} as const

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createRenderTarget(device: GPUDevice, format: GPUTextureFormat, width: number, height: number) {
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
      GPU_TEXTURE_USAGE.COPY_DST,
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
  private sampler: GPUSampler | null = null
  private blurPipeline: GPURenderPipeline | null = null
  private glassPipeline: GPURenderPipeline | null = null
  private presentPipeline: GPURenderPipeline | null = null
  private targets: RenderTargetSet | null = null

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
    this.globalsBuffer?.destroy()
    this.shapesBuffer?.destroy()
    this.blurHorizontalBuffer?.destroy()
    this.blurVerticalBuffer?.destroy()
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

    this.device = device
    this.context = context
    this.presentationFormat = presentationFormat
    this.sampler = sampler
    this.globalsBuffer = globalsBuffer
    this.blurHorizontalBuffer = blurHorizontalBuffer
    this.blurVerticalBuffer = blurVerticalBuffer
    this.blurPipeline = blurPipeline
    this.glassPipeline = glassPipeline
    this.presentPipeline = presentPipeline
    this.initialized = true

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

    this.globals[12] = Math.cos(container.lightDirection)
    this.globals[13] = Math.sin(container.lightDirection)
    this.globals[14] = 0
    this.globals[15] = 0

    this.globals[16] = container.specularStrength
    this.globals[17] = container.specularWidth * dpr
    this.globals[18] = container.specularSharpness
    this.globals[19] = container.specularOpacity

    this.globals[20] = container.edgeSaturation
    this.globals[21] = container.reflectionOffset * dpr
    this.globals[22] = container.reflectionSaturation
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

  private packShapes(container: Container, containerTransform: { a: number; b: number; c: number; d: number; e: number; f: number }) {
    const dpr = this.currentDpr
    const packed = new Float32Array(Math.max(container._children.length, 1) * 16)
    let activeCount = 0

    for (const glass of container._children) {
      const worldCss = multiplyMatrices(containerTransform, composeTransform(glass))

      const worldDevice = scaleOutputMatrix(worldCss, dpr)
      const inverse = invertMatrix(worldDevice)
      if (!inverse) {
        continue
      }

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

    return activeCount
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

  private renderContainer(
    encoder: GPUCommandEncoder,
    container: Container,
    sharpSource: GPUTexture,
    target: GPUTexture,
    shapeCount: number,
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

    this.writeGlobals(container, shapeCount)

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

    const containers = flattenContainers(this.scene)
      .sort((left, right) => left.container.zIndex - right.container.zIndex || left.traversalIndex - right.traversalIndex)

    let currentScene = this.targets.background
    let nextScene = this.targets.sceneA

    for (const entry of containers) {
      const encoder = this.device.createCommandEncoder()
      const shapeCount = this.packShapes(entry.container, entry.transform)
      this.blurTexture(encoder, currentScene, entry.container)
      this.renderContainer(encoder, entry.container, currentScene, nextScene, shapeCount)
      this.device.queue.submit([encoder.finish()])
      currentScene = nextScene
      nextScene = nextScene === this.targets.sceneA ? this.targets.sceneB : this.targets.sceneA
    }

    const encoder = this.device.createCommandEncoder()
    this.presentTexture(encoder, currentScene)
    this.device.queue.submit([encoder.finish()])
    this.pendingRender = false
  }
}
