import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react'
import { WebGpuGlassCore } from '@liquid-dom/core'
import type { LiquidSceneRef } from '@liquid-dom/react'

const BACKGROUND_BRIGHTNESS = 0.7
const MAX_RENDER_DPR = 2

export type StageSize = {
  width: number
  height: number
}

type BlendingWebGpuCanvasProps = {
  requestRenderRef: MutableRefObject<() => void>
  sceneRef: RefObject<LiquidSceneRef | null>
  stageSize: StageSize
}

type BlendingWebGpuState = {
  context: GPUCanvasContext
  core: WebGpuGlassCore
  device: GPUDevice
  format: GPUTextureFormat
}

type BackdropTextureState = {
  height: number
  texture: GPUTexture
  width: number
}

export function BlendingWebGpuCanvas({
  requestRenderRef,
  sceneRef,
  stageSize,
}: BlendingWebGpuCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const gpuStateRef = useRef<BlendingWebGpuState | null>(null)
  const backdropTextureRef = useRef<BackdropTextureState | null>(null)
  const backgroundImageRef = useRef<HTMLImageElement | null>(null)
  const backdropDirtyRef = useRef(true)
  const stagingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const renderFrameRef = useRef<(time: number) => void>(() => undefined)

  const scheduleRender = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return
    }

    animationFrameRef.current = requestAnimationFrame((time) => renderFrameRef.current(time))
  }, [])

  renderFrameRef.current = (time) => {
    animationFrameRef.current = null
    const canvas = canvasRef.current
    const gpuState = gpuStateRef.current
    const scene = sceneRef.current
    if (!canvas || !gpuState || !scene || stageSize.width <= 0 || stageSize.height <= 0) {
      return
    }

    const dpr = Math.min(getDevicePixelRatio(), MAX_RENDER_DPR)
    const width = Math.max(1, Math.round(stageSize.width * dpr))
    const height = Math.max(1, Math.round(stageSize.height * dpr))
    if (canvas.width !== width) {
      canvas.width = width
    }
    if (canvas.height !== height) {
      canvas.height = height
    }

    const backdropTexture = getBackdropTexture(
      gpuState.device,
      gpuState.format,
      width,
      height,
      backdropTextureRef,
      backdropDirtyRef,
    )
    if (backdropDirtyRef.current) {
      paintBackgroundTexture(
        gpuState.device,
        backdropTexture.texture,
        width,
        height,
        backgroundImageRef.current,
        stagingCanvasRef,
      )
      backdropDirtyRef.current = false
    }

    const lastFrameTime = lastFrameTimeRef.current ?? time
    const delta = Math.max(0, time - lastFrameTime)
    lastFrameTimeRef.current = time

    scene.update({ width: stageSize.width, height: stageSize.height }, delta)
    gpuState.core.render({
      scene: scene.scene,
      width,
      height,
      dpr,
      outputTexture: gpuState.context.getCurrentTexture(),
      backdropTexture: backdropTexture.texture,
    })
  }

  useEffect(() => {
    requestRenderRef.current = scheduleRender
    return () => {
      if (requestRenderRef.current === scheduleRender) {
        requestRenderRef.current = () => undefined
      }
    }
  }, [requestRenderRef, scheduleRender])

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      const canvas = canvasRef.current
      if (!canvas || !navigator.gpu) {
        return
      }

      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter || cancelled) {
        return
      }

      const device = await adapter.requestDevice()
      if (cancelled) {
        device.destroy()
        return
      }

      const context = canvas.getContext('webgpu')
      if (!context) {
        device.destroy()
        return
      }

      const format = navigator.gpu.getPreferredCanvasFormat()
      context.configure({
        alphaMode: 'opaque',
        device,
        format,
      })
      const core = new WebGpuGlassCore({ device, format })
      gpuStateRef.current = { context, core, device, format }
      scheduleRender()
    }

    void initialize().catch((error) => {
      console.error(error)
    })

    return () => {
      cancelled = true
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      backdropTextureRef.current?.texture.destroy()
      backdropTextureRef.current = null
      gpuStateRef.current?.core.destroy()
      gpuStateRef.current?.device.destroy()
      gpuStateRef.current = null
    }
  }, [scheduleRender])

  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.decoding = 'async'
    image.src = '/assets/background.jpg'

    async function decodeImage() {
      try {
        await image.decode()
      } catch {
        // Keep the black stage fallback if the demo asset has not been added yet.
      }

      if (cancelled) {
        return
      }

      if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        backgroundImageRef.current = image
        backdropDirtyRef.current = true
        scheduleRender()
      }
    }

    void decodeImage()

    return () => {
      cancelled = true
    }
  }, [scheduleRender])

  useEffect(() => {
    backdropDirtyRef.current = true
    scheduleRender()
  }, [scheduleRender, stageSize.height, stageSize.width])

  return <canvas ref={canvasRef} className="blending-canvas" />
}

function getBackdropTexture(
  device: GPUDevice,
  format: GPUTextureFormat,
  width: number,
  height: number,
  textureRef: MutableRefObject<BackdropTextureState | null>,
  dirtyRef: MutableRefObject<boolean>,
) {
  const current = textureRef.current
  if (current && current.width === width && current.height === height) {
    return current
  }

  current?.texture.destroy()
  const texture = device.createTexture({
    format,
    size: { width, height },
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING,
  })
  const next = { height, texture, width }
  textureRef.current = next
  dirtyRef.current = true
  return next
}

function paintBackgroundTexture(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  image: HTMLImageElement | null,
  stagingCanvasRef: MutableRefObject<HTMLCanvasElement | null>,
) {
  const stagingCanvas = stagingCanvasRef.current ?? document.createElement('canvas')
  stagingCanvasRef.current = stagingCanvas
  if (stagingCanvas.width !== width) {
    stagingCanvas.width = width
  }
  if (stagingCanvas.height !== height) {
    stagingCanvas.height = height
  }

  const context = stagingCanvas.getContext('2d')
  if (!context) {
    return
  }

  context.save()
  context.filter = 'none'
  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)

  if (image) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
    const imageWidth = image.naturalWidth * scale
    const imageHeight = image.naturalHeight * scale
    const imageX = (width - imageWidth) * 0.5
    const imageY = (height - imageHeight) * 0.5
    context.filter = `brightness(${BACKGROUND_BRIGHTNESS})`
    context.drawImage(image, imageX, imageY, imageWidth, imageHeight)
  }

  context.restore()
  device.queue.copyExternalImageToTexture(
    { source: stagingCanvas },
    { texture },
    { width, height },
  )
}

function getDevicePixelRatio() {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}
