import {
  Scene,
  WebGpuGlassCore,
  type WebGpuGlassContentSource,
  type WebGpuGlassCoreRenderOptions,
} from 'liquid-glass-dom'
import {
  Vector2,
  type Camera,
  type Object3D,
  type RenderTarget,
  type Texture,
} from 'three'

export type ThreeWebGpuBackend = {
  isWebGPUBackend?: boolean
  device?: GPUDevice
  utils?: {
    getPreferredCanvasFormat?: () => GPUTextureFormat
  }
  get?: (object: object) => {
    texture?: GPUTexture
  }
}

export type ThreeWebGpuBackendReady = ThreeWebGpuBackend & {
  isWebGPUBackend: true
  device: GPUDevice
}

export type ThreeWebGpuRenderer = {
  backend?: unknown
  getContext: () => unknown
  getDrawingBufferSize: (target: Vector2) => Vector2
  getPixelRatio: () => number
}

export type ThreeWebGpuRenderTargetRenderer = ThreeWebGpuRenderer & {
  domElement: HTMLCanvasElement
  render: (scene: Object3D, camera: Camera) => void
  setRenderTarget: (target: RenderTarget | null) => void
}

export type ThreeWebGpuRendererValidationOptions = {
  owner?: string
  help?: string
}

type ThreeBackdrop = GPUTexture | RenderTarget | Texture

export type ThreeGlassRendererInit = {
  renderer: ThreeWebGpuRenderer
  scene?: Scene
  format?: GPUTextureFormat
  contentSource?: WebGpuGlassContentSource | null
}

export type ThreeGlassRenderOptions = {
  scene?: Scene
  backdrop: ThreeBackdrop
  contentSource?: WebGpuGlassContentSource | null
  outputTexture?: GPUTexture
  width?: number
  height?: number
  dpr?: number
}

function isGpuTexture(value: ThreeBackdrop): value is GPUTexture {
  return typeof (value as GPUTexture).createView === 'function'
}

function getRenderTargetTexture(renderTarget: RenderTarget) {
  const textures = (renderTarget as RenderTarget & { textures?: Texture[] }).textures
  return textures?.[0] ?? renderTarget.texture
}

function createRendererError(message: string, options: ThreeWebGpuRendererValidationOptions = {}) {
  const owner = options.owner ?? 'ThreeGlassRenderer'
  const suffix = options.help ? ` ${options.help}` : ''
  return new Error(`${owner} ${message}.${suffix}`)
}

function getRendererCandidate(renderer: unknown, options?: ThreeWebGpuRendererValidationOptions) {
  if (!renderer || typeof renderer !== 'object') {
    throw createRendererError('requires a Three renderer instance', options)
  }

  return renderer as Partial<ThreeWebGpuRenderTargetRenderer>
}

/** Returns the initialized WebGPU backend from a Three WebGPU renderer. */
export function requireThreeWebGpuBackend(
  renderer: unknown,
  options?: ThreeWebGpuRendererValidationOptions,
): ThreeWebGpuBackendReady {
  const candidate = getRendererCandidate(renderer, options)
  const backend = candidate.backend as ThreeWebGpuBackend | undefined
  if (!backend?.isWebGPUBackend || !backend.device) {
    throw createRendererError('requires Three.WebGPURenderer with the WebGPU backend', options)
  }

  return backend as ThreeWebGpuBackendReady
}

/** Validates the base methods needed to host liquid glass in a Three WebGPU renderer. */
export function requireThreeWebGpuRenderer(
  renderer: unknown,
  options?: ThreeWebGpuRendererValidationOptions,
): ThreeWebGpuRenderer {
  const candidate = getRendererCandidate(renderer, options)
  requireThreeWebGpuBackend(candidate, options)

  if (
    typeof candidate.getContext !== 'function' ||
    typeof candidate.getDrawingBufferSize !== 'function' ||
    typeof candidate.getPixelRatio !== 'function'
  ) {
    throw createRendererError('received a renderer that is missing required Three renderer methods', options)
  }

  return candidate as ThreeWebGpuRenderer
}

/** Returns the configured canvas context from a Three WebGPU renderer. */
export function requireThreeWebGpuCanvasContext(
  renderer: unknown,
  options?: ThreeWebGpuRendererValidationOptions,
) {
  const candidate = requireThreeWebGpuRenderer(renderer, options)
  const context = candidate.getContext()
  if (!context || typeof (context as GPUCanvasContext).getCurrentTexture !== 'function') {
    throw createRendererError('requires a renderer backed by a configured GPUCanvasContext', options)
  }

  return context as GPUCanvasContext
}

/** Validates the renderer methods needed to capture and composite an R3F scene. */
export function requireThreeWebGpuRenderTargetRenderer(
  renderer: unknown,
  options?: ThreeWebGpuRendererValidationOptions,
): ThreeWebGpuRenderTargetRenderer {
  const candidate = requireThreeWebGpuRenderer(renderer, options) as Partial<ThreeWebGpuRenderTargetRenderer>
  requireThreeWebGpuCanvasContext(candidate, options)

  if (
    !candidate.domElement ||
    typeof candidate.render !== 'function' ||
    typeof candidate.setRenderTarget !== 'function'
  ) {
    throw createRendererError('received a renderer that is missing required render-target methods', options)
  }

  return candidate as ThreeWebGpuRenderTargetRenderer
}

/** Hosts the reusable liquid-glass WebGPU core inside a Three WebGPU renderer. */
export class ThreeGlassRenderer {
  readonly scene: Scene

  private readonly renderer: ThreeWebGpuRenderer
  private readonly formatOverride: GPUTextureFormat | null
  private readonly contentSource: WebGpuGlassContentSource | null
  private core: WebGpuGlassCore | null = null

  constructor({ renderer, scene, format, contentSource }: ThreeGlassRendererInit) {
    this.renderer = renderer
    this.scene = scene ?? new Scene()
    this.formatOverride = format ?? null
    this.contentSource = contentSource ?? null
  }

  /** Raw WebGPU device owned by Three's WebGPU backend. */
  get device() {
    return requireThreeWebGpuBackend(this.renderer).device
  }

  /** Preferred output format used by Three's WebGPU backend. */
  get format() {
    const backend = requireThreeWebGpuBackend(this.renderer)
    return (
      this.formatOverride ??
      backend?.utils?.getPreferredCanvasFormat?.() ??
      navigator.gpu.getPreferredCanvasFormat()
    )
  }

  /** Returns Three's raw GPU texture for a render target, texture, or GPU texture. */
  getGpuTexture(backdrop: ThreeBackdrop) {
    if (isGpuTexture(backdrop)) {
      return backdrop
    }

    const backend = requireThreeWebGpuBackend(this.renderer)
    const texture = 'isRenderTarget' in backdrop && backdrop.isRenderTarget
      ? getRenderTargetTexture(backdrop)
      : backdrop
    const gpuTexture = backend.get?.(texture)?.texture
    if (!gpuTexture) {
      throw new Error('Unable to resolve a GPUTexture from the provided Three texture. Render or initialize it first.')
    }
    return gpuTexture
  }

  /** Renders liquid glass over a Three-rendered backdrop texture. */
  render(options: ThreeGlassRenderOptions) {
    const backend = requireThreeWebGpuBackend(this.renderer)
    const core = this.ensureCore(backend)
    const size = this.getOutputSize(options)

    core.render({
      scene: options.scene ?? this.scene,
      backdropTexture: this.getGpuTexture(options.backdrop),
      contentSource: options.contentSource ?? this.contentSource,
      outputTexture: options.outputTexture ?? requireThreeWebGpuCanvasContext(this.renderer).getCurrentTexture(),
      width: size.width,
      height: size.height,
      dpr: options.dpr ?? this.renderer.getPixelRatio(),
    } satisfies WebGpuGlassCoreRenderOptions)
  }

  /** Releases GPU resources owned by the adapter. */
  destroy() {
    this.core?.destroy()
    this.core = null
  }

  private ensureCore(backend: ThreeWebGpuBackendReady) {
    if (!this.core) {
      this.core = new WebGpuGlassCore({
        device: backend.device,
        format: this.format,
      })
    }
    return this.core
  }

  private getOutputSize(options: ThreeGlassRenderOptions) {
    if (options.width && options.height) {
      return {
        width: Math.max(1, Math.floor(options.width)),
        height: Math.max(1, Math.floor(options.height)),
      }
    }

    const size = this.renderer.getDrawingBufferSize(new Vector2())
    return {
      width: Math.max(1, Math.floor(size.x)),
      height: Math.max(1, Math.floor(size.y)),
    }
  }
}
