import {
  getMinimumScale,
  invertMatrix,
  multiplyMatrices,
  scaleOutputMatrix,
  transformPoint,
  type Matrix2D,
} from '../matrix'
import { BackdropMetricsTracker, type BackdropMetricsState } from './backdrop-metrics-state'
import {
  getCopiedCssSize,
  getTextureUvScale,
} from './dom-content-sync'
import type { SceneHtmlEntry, WebGpuGlassContentSource } from './content-source'
import { GPU_BUFFER_USAGE, GPU_TEXTURE_USAGE } from './gpu-constants'
import {
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
  createAdaptiveBlurTargetChain,
  createRenderTarget,
  destroyTargets,
  type RenderTargetSet,
} from './gpu-targets'
import {
  createAdaptiveBlurResources,
  destroyAdaptiveBlurResources,
  renderAdaptiveBlur,
  type AdaptiveBlurResources,
} from './adaptive-blur'
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
  ContentDataLayout,
  GlobalsLayout,
  HtmlCompositeParamsLayout,
  ShapeDataLayout,
} from './shader-layouts'
import {
  getSortedGlassLayers,
  getSortedSceneLayers,
} from './scene-order'
import { Container, Html, Scene, type TraversedSceneLayer } from '../scene'
import {
  DISPLACEMENT_FIELD_SHADER,
  GLASS_SHADER,
  HTML_COMPOSITE_SHADER,
  METRICS_SHADER,
  SHADOW_COMPOSITE_SHADER,
  SHADOW_MASK_SHADER,
  TEXTURE_BLIT_SHADER,
} from '../shaders'
import type { SpecularWidth, SurfaceProfile } from '../types'

/** Resolves public specular-width semantics into the shader's device-pixel space. */
export function resolveSpecularWidthPx(specularWidth: SpecularWidth, dpr: number) {
  return specularWidth === 'hairline' ? 1 : specularWidth * dpr
}

/** Constructor options for the reusable WebGPU glass core. */
export type WebGpuGlassCoreInit = {
  device: GPUDevice
  format: GPUTextureFormat
}

/** Inputs for one texture-in/texture-out core render. */
export type WebGpuGlassCoreRenderOptions = {
  layers?: TraversedSceneLayer[]
  scene?: Scene
  width: number
  height: number
  dpr: number
  outputTexture: GPUTexture
  backdropTexture?: GPUTexture | null
  contentSource?: WebGpuGlassContentSource | null
}

type PackedShapesResult = {
  shapeCount: number
  bounds: BoundsRect | null
}

type GlobalsBuffer = GpuStructBuffer<GpuStructDefinition<typeof GlobalsLayout>>
type ShapeDataBuffer = GpuStructArrayBuffer<GpuStructDefinition<typeof ShapeDataLayout>>
type BackdropMetricsBoundsBuffer = GpuStructBuffer<GpuStructDefinition<typeof BackdropMetricsBoundsLayout>>
type HtmlCompositeParamsBuffer = GpuStructBuffer<GpuStructDefinition<typeof HtmlCompositeParamsLayout>>
const DISPLACEMENT_FIELD_FORMAT = 'rgba16float' satisfies GPUTextureFormat
const SHADOW_MASK_FORMAT = 'rgba8unorm' satisfies GPUTextureFormat

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


/** Texture-in/texture-out WebGPU compositor for a liquid-glass scene graph. */
export class WebGpuGlassCore {
  private readonly backdropMetrics = new BackdropMetricsTracker(() => this.destroyed)

  private destroyed = false
  private currentDpr = 1
  private width = 1
  private height = 1
  private contentSource: WebGpuGlassContentSource | null = null

  private readonly device: GPUDevice
  private readonly format: GPUTextureFormat
  private globalsBuffer: GlobalsBuffer
  private shapesBuffer: ShapeDataBuffer | null = null
  private backdropMetricsBoundsBuffer: BackdropMetricsBoundsBuffer
  private htmlCompositeParamsBuffer: HtmlCompositeParamsBuffer
  private emptyContentEntriesBuffer: GpuStructArrayBuffer<GpuStructDefinition<typeof ContentDataLayout>>
  private sampler: GPUSampler
  private backdropBlurResources: AdaptiveBlurResources
  private displacementBlurResources: AdaptiveBlurResources
  private shadowBlurResources: AdaptiveBlurResources
  private displacementFieldPipeline: GPURenderPipeline
  private shadowMaskPipeline: GPURenderPipeline
  private shadowCompositePipeline: GPURenderPipeline
  private glassPipeline: GPURenderPipeline
  private htmlCompositePipeline: GPURenderPipeline
  private backdropMetricsPipeline: GPURenderPipeline
  private blitPipeline: GPURenderPipeline
  private targets: RenderTargetSet | null = null
  private backdropMetricsTarget: GPUTexture

  /** Creates reusable GPU resources for a host-owned WebGPU device. */
  constructor({ device, format }: WebGpuGlassCoreInit) {
    this.device = device
    this.format = format
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    const uniformBufferUsage = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST

    this.globalsBuffer = new GpuStructBuffer(device, GlobalsLayout, uniformBufferUsage)
    this.backdropMetricsBoundsBuffer = new GpuStructBuffer(device, BackdropMetricsBoundsLayout, uniformBufferUsage)
    this.htmlCompositeParamsBuffer = new GpuStructBuffer(device, HtmlCompositeParamsLayout, uniformBufferUsage)
    this.emptyContentEntriesBuffer = new GpuStructArrayBuffer(
      device,
      ContentDataLayout,
      GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
    )
    this.emptyContentEntriesBuffer.ensureCapacity(0)
    this.backdropBlurResources = createAdaptiveBlurResources(device, format)
    this.displacementBlurResources = createAdaptiveBlurResources(device, DISPLACEMENT_FIELD_FORMAT)
    this.shadowBlurResources = createAdaptiveBlurResources(device, SHADOW_MASK_FORMAT)

    this.displacementFieldPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: DISPLACEMENT_FIELD_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: DISPLACEMENT_FIELD_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format: DISPLACEMENT_FIELD_FORMAT }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    this.glassPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: GLASS_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: GLASS_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    this.shadowMaskPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: SHADOW_MASK_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: SHADOW_MASK_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format: SHADOW_MASK_FORMAT }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    this.shadowCompositePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: SHADOW_COMPOSITE_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: SHADOW_COMPOSITE_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    this.htmlCompositePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: HTML_COMPOSITE_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: HTML_COMPOSITE_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    this.backdropMetricsPipeline = device.createRenderPipeline({
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

    this.blitPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: TEXTURE_BLIT_SHADER }),
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: device.createShaderModule({ code: TEXTURE_BLIT_SHADER }),
        entryPoint: 'fragmentMain',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    this.backdropMetricsTarget = device.createTexture({
      size: {
        width: BACKDROP_METRICS_SIZE,
        height: BACKDROP_METRICS_SIZE,
        depthOrArrayLayers: 1,
      },
      format: 'rgba8unorm',
      usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC,
    })

    this.backdropMetrics.setDevice(device)
  }

  /** Enables or disables cached backdrop metrics for a container. */
  setBackdropMetricsTracking(container: Container, enabled: boolean) {
    this.backdropMetrics.setTracking(container, enabled)
  }

  /** Returns the latest completed cached backdrop metrics for a tracked container. */
  getBackdropMetrics(container: Container) {
    return this.backdropMetrics.getMetrics(container)
  }

  /** Draws one frame into a host-provided output texture. */
  render(options: WebGpuGlassCoreRenderOptions) {
    if (this.destroyed) {
      return
    }

    this.width = Math.max(1, Math.floor(options.width))
    this.height = Math.max(1, Math.floor(options.height))
    this.currentDpr = Math.max(options.dpr, 0.0001)
    this.contentSource = options.contentSource ?? null
    this.syncTargets()
    const layers = options.layers ?? (options.scene ? getSortedSceneLayers(options.scene) : [])
    try {
      this.drawFrame(layers, options.outputTexture, options.backdropTexture ?? null)
    } finally {
      this.contentSource = null
    }
  }

  /** Releases GPU resources owned by the core. */
  destroy() {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    destroyTargets(this.targets)
    this.targets = null
    this.backdropMetricsTarget.destroy()
    this.globalsBuffer.destroy()
    this.shapesBuffer?.destroy()
    this.emptyContentEntriesBuffer.destroy()
    destroyAdaptiveBlurResources(this.backdropBlurResources)
    destroyAdaptiveBlurResources(this.displacementBlurResources)
    destroyAdaptiveBlurResources(this.shadowBlurResources)
    this.backdropMetricsBoundsBuffer.destroy()
    this.htmlCompositeParamsBuffer.destroy()
    this.backdropMetrics.destroy()
  }

  /** Synchronizes internal render-target dimensions with the host output. */
  private syncTargets() {
    if (
      this.targets &&
      this.targets.backdropBlur.levels[0]?.width === this.width &&
      this.targets.backdropBlur.levels[0]?.height === this.height
    ) {
      return
    }

    destroyTargets(this.targets)
    this.targets = {
      backdropBlur: createAdaptiveBlurTargetChain(this.device, this.format, this.width, this.height),
      displacementBlur: createAdaptiveBlurTargetChain(this.device, DISPLACEMENT_FIELD_FORMAT, this.width, this.height),
      shadowBlur: createAdaptiveBlurTargetChain(this.device, SHADOW_MASK_FORMAT, this.width, this.height),
      sceneA: createRenderTarget(this.device, this.format, this.width, this.height),
      sceneB: createRenderTarget(this.device, this.format, this.width, this.height),
    }
  }

  /** Ensures the shape storage buffer can hold the active glass count. */
  private ensureShapesBuffer(requiredCount: number) {
    if (!this.shapesBuffer) {
      this.shapesBuffer = new GpuStructArrayBuffer(
        this.device,
        ShapeDataLayout,
        GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
      )
    }

    this.shapesBuffer.ensureCapacity(requiredCount)
  }

  /** Writes per-container global shader parameters. */
  private writeGlobals(container: Container, shapeCount: number) {
    const dpr = this.currentDpr

    this.globalsBuffer.write({
      canvas: {
        width: this.width,
        height: this.height,
      },
      shape: {
        smoothing: container.spacing * dpr,
        bezelWidth: container.bezelWidth * dpr,
        shapeCount,
        surfaceProfile: getSurfaceProfileIndex(container.surfaceProfile),
      },
      sdf: {
        normalDivergenceBlendPower: container.normalDivergenceBlendPower,
        normalDivergenceBlendEnabled: container.normalDivergenceBlendEnabled ? 1 : 0,
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
        width: resolveSpecularWidthPx(container.specularWidth, dpr),
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
      shadow: {
        offsetX: container.shadowOffsetX * dpr,
        offsetY: container.shadowOffsetY * dpr,
        spread: container.shadowSpread * dpr,
        blur: container.shadowBlur * dpr,
      },
      shadowColor: {
        r: container.shadowColor.r,
        g: container.shadowColor.g,
        b: container.shadowColor.b,
        a: container.shadowColor.a,
      },
      debug: {
        displacement: container.debugDisplacement ? 1 : 0,
      },
    })
  }

  /** Writes the device-pixel bounds sampled by the backdrop metrics pass. */
  private writeBackdropMetricsBounds(bounds: BoundsRect) {
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
    const glassLayers = getSortedGlassLayers(container)
    const bounds = createEmptyBounds()
    let activeCount = 0

    this.ensureShapesBuffer(glassLayers.length)
    const shapesBuffer = this.shapesBuffer

    for (const glassLayer of glassLayers) {
      const glass = glassLayer.glass
      const worldCss = multiplyMatrices(containerTransform, glassLayer.transform)
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

      const contentRange = this.contentSource?.getGlassContentRange?.(glass)
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

  /** Renders and filters the premultiplied surface field used for refraction displacement. */
  private renderDisplacementField(encoder: GPUCommandEncoder, targetContainer: Container) {
    if (!this.shapesBuffer?.buffer || !this.targets) {
      return null
    }

    const rawLevel = this.targets.displacementBlur.levels[0]
    const fieldBindGroup = createPipelineBindGroup(this.device, this.displacementFieldPipeline, [
      { binding: 0, resource: this.globalsBuffer.bindingResource },
      { binding: 1, resource: this.shapesBuffer.bindingResource },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.displacementFieldPipeline,
      bindGroup: fieldBindGroup,
      target: rawLevel.ping,
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    })

    return renderAdaptiveBlur({
      device: this.device,
      sampler: this.sampler,
      encoder,
      source: rawLevel.ping,
      radiusPx: targetContainer.displacementBlur * this.currentDpr,
      chain: this.targets.displacementBlur,
      resources: this.displacementBlurResources,
    })
  }

  /** Renders the container shadow mask, blurs it, and composites it under the glass. */
  private renderShadow(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    target: GPUTexture,
    targetContainer: Container,
  ) {
    if (
      targetContainer.shadowColor.a <= 0 ||
      !this.shapesBuffer?.buffer ||
      !this.targets
    ) {
      return false
    }

    const rawLevel = this.targets.shadowBlur.levels[0]
    const maskBindGroup = createPipelineBindGroup(this.device, this.shadowMaskPipeline, [
      { binding: 0, resource: this.globalsBuffer.bindingResource },
      { binding: 1, resource: this.shapesBuffer.bindingResource },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.shadowMaskPipeline,
      bindGroup: maskBindGroup,
      target: rawLevel.ping,
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    })

    const blurredMask = renderAdaptiveBlur({
      device: this.device,
      sampler: this.sampler,
      encoder,
      source: rawLevel.ping,
      radiusPx: targetContainer.shadowBlur * this.currentDpr,
      chain: this.targets.shadowBlur,
      resources: this.shadowBlurResources,
    })

    const compositeBindGroup = createPipelineBindGroup(this.device, this.shadowCompositePipeline, [
      { binding: 0, resource: this.sampler },
      { binding: 1, resource: source.createView() },
      { binding: 2, resource: blurredMask.createView() },
      { binding: 3, resource: this.globalsBuffer.bindingResource },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.shadowCompositePipeline,
      bindGroup: compositeBindGroup,
      target,
    })

    return true
  }

  /** Returns whether rendering this container will add a shadow composition pass. */
  private shouldRenderShadow(targetContainer: Container) {
    return targetContainer.shadowColor.a > 0 && Boolean(this.shapesBuffer?.buffer) && Boolean(this.targets)
  }

  /** Renders and queues copy commands for one backdrop metrics target. */
  private renderBackdropMetrics(
    encoder: GPUCommandEncoder,
    state: BackdropMetricsState,
    bounds: BoundsRect | null,
    blurredBackdrop: GPUTexture,
  ) {
    if (
      !this.shapesBuffer?.buffer ||
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
      { binding: 3, resource: blurredBackdrop.createView() },
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
    blurredBackdrop: GPUTexture,
    displacementField: GPUTexture,
    target: GPUTexture,
  ) {
    if (!this.shapesBuffer?.buffer) {
      return
    }

    const contentEntriesBindingResource =
      this.contentSource?.contentEntriesBindingResource ?? this.emptyContentEntriesBuffer.bindingResource

    // The shader never reads this when all content ranges are empty, but the
    // bind group still needs a valid texture for the fixed glass pipeline layout.
    const contentTexture = this.contentSource?.atlasTexture ?? sharpSource

    const bindGroup = createPipelineBindGroup(this.device, this.glassPipeline, [
      { binding: 0, resource: this.globalsBuffer.bindingResource },
      { binding: 1, resource: this.shapesBuffer.bindingResource },
      { binding: 2, resource: this.sampler },
      { binding: 3, resource: sharpSource.createView() },
      { binding: 4, resource: blurredBackdrop.createView() },
      { binding: 5, resource: contentTexture.createView() },
      { binding: 6, resource: contentEntriesBindingResource },
      { binding: 7, resource: displacementField.createView() },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.glassPipeline,
      bindGroup,
      target,
    })
  }

  /** Writes uniforms for compositing one scene-attached HTML texture. */
  private writeHtmlCompositeParams(entry: SceneHtmlEntry) {
    if (!entry.inverseTransform) {
      return
    }

    const inverse = entry.inverseTransform
    this.htmlCompositeParamsBuffer.write({
      canvas: {
        width: this.width,
        height: this.height,
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

  /** Samples one texture into another render attachment. */
  private blitTexture(encoder: GPUCommandEncoder, source: GPUTexture, target: GPUTexture) {
    const bindGroup = createPipelineBindGroup(this.device, this.blitPipeline, [
      { binding: 0, resource: this.sampler },
      { binding: 1, resource: source.createView() },
    ])
    drawFullscreenPass(encoder, {
      pipeline: this.blitPipeline,
      bindGroup,
      target,
    })
  }

  /** Draws a complete frame for the provided sorted scene layers. */
  private drawFrame(
    layers: TraversedSceneLayer[],
    outputTexture: GPUTexture,
    backdropTexture: GPUTexture | null,
  ) {
    if (this.destroyed || !this.targets) {
      return
    }

    const seenContainers = new Set<Container>()
    const composer = new PingPongComposer(this.device, this.targets)
    if (backdropTexture) {
      this.blitTexture(composer.encoder, backdropTexture, composer.current)
    }

    for (const entry of layers) {
      if (entry.child instanceof Html) {
        const htmlEntry = this.contentSource?.getSceneHtmlEntry?.(entry.child)
        if (!htmlEntry || !htmlEntry.texture || !htmlEntry.inverseTransform) {
          continue
        }

        this.compositeHtmlLayer(composer.encoder, composer.current, composer.next, htmlEntry)
        composer.submitAndSwap()
        continue
      }

      const packedShapes = this.packShapes(entry.child, entry.transform)
      this.writeGlobals(entry.child, packedShapes.shapeCount)
      const blurRadiusPx = entry.child.blur * this.currentDpr
      let blurredBackdrop = renderAdaptiveBlur({
        device: this.device,
        sampler: this.sampler,
        encoder: composer.encoder,
        source: composer.current,
        radiusPx: blurRadiusPx,
        chain: this.targets.backdropBlur,
        resources: this.backdropBlurResources,
      })
      if (blurRadiusPx <= 0 && this.shouldRenderShadow(entry.child)) {
        // With zero blur the "blurred" backdrop is the sharp scene texture.
        // The shadow pass below swaps the ping-pong targets before the glass
        // pass, which would otherwise make that texture become the glass render
        // target. Snapshot it into the blur chain so the glass pass never reads
        // from the same texture it writes to.
        blurredBackdrop = this.targets.backdropBlur.levels[0].pong
        this.blitTexture(composer.encoder, composer.current, blurredBackdrop)
      }
      const displacementField = this.renderDisplacementField(composer.encoder, entry.child)
      if (!displacementField) {
        continue
      }

      const metricsState = this.backdropMetrics.getTrackedState(entry.child)
      let scheduledMetricsReadback = false

      if (metricsState) {
        seenContainers.add(entry.child)
        scheduledMetricsReadback = this.renderBackdropMetrics(
          composer.encoder,
          metricsState,
          packedShapes.bounds,
          blurredBackdrop,
        )
      }

      if (this.renderShadow(composer.encoder, composer.current, composer.next, entry.child)) {
        composer.submitAndSwap()
      }

      this.renderContainer(composer.encoder, composer.current, blurredBackdrop, displacementField, composer.next)
      composer.submitAndSwap()

      if (metricsState && scheduledMetricsReadback) {
        this.backdropMetrics.scheduleReadback(metricsState)
      }
    }

    this.backdropMetrics.markSceneMembership(seenContainers)
    this.blitTexture(composer.encoder, composer.current, outputTexture)
    composer.submit()
  }
}
