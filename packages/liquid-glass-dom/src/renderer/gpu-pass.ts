const OPAQUE_BLACK = { r: 0, g: 0, b: 0, a: 1 } as const

/** Inputs required to draw a full-screen triangle into a render target. */
type FullscreenPassOptions = {
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  target: GPUTexture
  clearValue?: GPUColorDict
}

/** Pair of scene textures used as the ping-pong composition targets. */
type SceneTargets = {
  sceneA: GPUTexture
  sceneB: GPUTexture
}

/** Creates a bind group for bind-group layout zero of a pipeline. */
export function createPipelineBindGroup(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  entries: GPUBindGroupEntry[],
) {
  return device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries,
  })
}

/** Clears a texture by opening and ending a render pass. */
export function clearRenderTarget(
  encoder: GPUCommandEncoder,
  target: GPUTexture,
  clearValue: GPUColorDict = OPAQUE_BLACK,
) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        clearValue,
        loadOp: 'clear',
        storeOp: 'store',
        view: target.createView(),
      },
    ],
  })
  pass.end()
}

/** Draws a full-screen triangle pass into a target texture. */
export function drawFullscreenPass(
  encoder: GPUCommandEncoder,
  { pipeline, bindGroup, target, clearValue = OPAQUE_BLACK }: FullscreenPassOptions,
) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        clearValue,
        loadOp: 'clear',
        storeOp: 'store',
        view: target.createView(),
      },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(3)
  pass.end()
}

/** Manages two scene targets and a command encoder for incremental composition. */
export class PingPongComposer {
  /** Active encoder for the current composition step. */
  encoder: GPUCommandEncoder
  private currentTexture: GPUTexture
  private nextTexture: GPUTexture

  /** Starts a composition sequence with sceneA cleared as the current texture. */
  constructor(private readonly device: GPUDevice, targets: SceneTargets) {
    this.encoder = device.createCommandEncoder()
    this.currentTexture = targets.sceneA
    this.nextTexture = targets.sceneB
    clearRenderTarget(this.encoder, this.currentTexture)
  }

  /** Texture containing the latest submitted composition result. */
  get current() {
    return this.currentTexture
  }

  /** Texture to render the next composition pass into. */
  get next() {
    return this.nextTexture
  }

  /** Submits the current encoder and swaps current/next targets. */
  submitAndSwap() {
    this.device.queue.submit([this.encoder.finish()])
    this.encoder = this.device.createCommandEncoder()
    const previousCurrent = this.currentTexture
    this.currentTexture = this.nextTexture
    this.nextTexture = previousCurrent
  }

  /** Submits the final pending encoder without swapping targets. */
  submit() {
    this.device.queue.submit([this.encoder.finish()])
  }
}
