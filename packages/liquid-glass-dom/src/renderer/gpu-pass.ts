const OPAQUE_BLACK = { r: 0, g: 0, b: 0, a: 1 } as const

type FullscreenPassOptions = {
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  target: GPUTexture
  clearValue?: GPUColorDict
}

type SceneTargets = {
  sceneA: GPUTexture
  sceneB: GPUTexture
}

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

export class PingPongComposer {
  encoder: GPUCommandEncoder
  private currentTexture: GPUTexture
  private nextTexture: GPUTexture

  constructor(private readonly device: GPUDevice, targets: SceneTargets) {
    this.encoder = device.createCommandEncoder()
    this.currentTexture = targets.sceneA
    this.nextTexture = targets.sceneB
    clearRenderTarget(this.encoder, this.currentTexture)
  }

  get current() {
    return this.currentTexture
  }

  get next() {
    return this.nextTexture
  }

  submitAndSwap() {
    this.device.queue.submit([this.encoder.finish()])
    this.encoder = this.device.createCommandEncoder()
    const previousCurrent = this.currentTexture
    this.currentTexture = this.nextTexture
    this.nextTexture = previousCurrent
  }

  submit() {
    this.device.queue.submit([this.encoder.finish()])
  }
}
