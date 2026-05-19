import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useFrame, useThree, type RootState } from '@react-three/fiber'
import { WebGpuDomContentSource } from '@liquid-dom/core'
import { LiquidScene, type LiquidSceneRef } from '@liquid-dom/react'
import {
  ThreeGlassRenderer,
  requireThreeWebGpuRenderTargetRenderer,
  type ThreeWebGpuRenderTargetRenderer,
} from '@liquid-dom/three'
import {
  RenderTarget,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  type RenderTargetOptions,
  type Scene,
} from 'three'

export type LiquidGlassR3FDpr = number | ((state: RootState) => number)

export type LiquidGlassR3FOutputTexture =
  | GPUTexture
  | null
  | undefined
  | ((state: RootState) => GPUTexture | null | undefined)

export type LiquidGlassR3FRenderTargetOptions = Pick<
  RenderTargetOptions,
  'colorSpace' | 'depthBuffer' | 'format' | 'samples' | 'stencilBuffer' | 'type'
>

export type UseLiquidGlassR3FOptions = {
  /** Ref exposed by LiquidScene. The hook renders this retained liquid-glass scene over the R3F scene. */
  sceneRootRef: RefObject<LiquidSceneRef | null>
  /** Wait for sceneRootRef.current instead of throwing when the root is not mounted yet. */
  deferUntilSceneRoot?: boolean
  /** Positive R3F render priority. Positive priorities take over final rendering. */
  renderPriority?: number
  /** Disable the bridge without unmounting it. */
  enabled?: boolean
  /** DPR passed into liquid-glass rendering. Defaults to the Three renderer pixel ratio. */
  dpr?: LiquidGlassR3FDpr
  /** Render liquid glass into this GPU texture instead of the canvas current texture. */
  outputTexture?: LiquidGlassR3FOutputTexture
  /** Internal Three render target settings used for the R3F backdrop capture. */
  renderTarget?: LiquidGlassR3FRenderTargetOptions
  /** Called when integration setup or rendering fails. If omitted, errors are thrown. */
  onError?: (error: unknown) => void
}

export type LiquidGlassR3FRootProps = {
  children?: ReactNode
  sceneRootRef?: RefObject<LiquidSceneRef | null>
}

export type LiquidGlassR3FSceneProps = {
  children?: ReactNode
}

export type LiquidGlassR3FRenderProps = Omit<
  UseLiquidGlassR3FOptions,
  'deferUntilSceneRoot' | 'sceneRootRef'
> & {
  sceneRootRef?: RefObject<LiquidSceneRef | null>
}

export type LiquidGlassR3FProps = LiquidGlassR3FRenderProps

type LiquidGlassR3FContextValue = {
  r3fInvalidate: (() => void) | null
  sceneRoot: LiquidSceneRef | null
  sceneRootRef: RefObject<LiquidSceneRef | null>
  setR3FInvalidate: (invalidate: (() => void) | null) => void
  setSceneRoot: (sceneRoot: LiquidSceneRef | null) => void
}

type BridgeResources = {
  backgroundTarget: RenderTarget
  contentSource: WebGpuDomContentSource
  glass: ThreeGlassRenderer
}

const DEFAULT_RENDER_PRIORITY = 1
const LiquidGlassR3FContext = createContext<LiquidGlassR3FContextValue | null>(null)

function createIntegrationError(message: string) {
  return new Error(`[@liquid-dom/r3f] ${message}`)
}

function reportError(error: unknown, onError: ((error: unknown) => void) | undefined) {
  if (onError) {
    onError(error)
    return
  }

  throw error
}

function useRequiredLiquidGlassR3FContext(componentName: string) {
  const context = useContext(LiquidGlassR3FContext)
  if (!context) {
    throw createIntegrationError(`${componentName} must be rendered inside <LiquidGlassR3F.Root>.`)
  }

  return context
}

function requireR3FWebGpuRenderer(renderer: unknown) {
  return requireThreeWebGpuRenderTargetRenderer(renderer, {
    owner: 'LiquidGlassR3F.Render',
    help: 'Pass an async WebGPU renderer to <Canvas gl={...}> and await renderer.init().',
  })
}

function resolveDpr(
  dpr: LiquidGlassR3FDpr | undefined,
  state: RootState,
  renderer: ThreeWebGpuRenderTargetRenderer,
) {
  const resolved = typeof dpr === 'function' ? dpr(state) : dpr
  if (resolved === undefined) {
    return renderer.getPixelRatio()
  }

  return Number.isFinite(resolved) && resolved > 0 ? resolved : renderer.getPixelRatio()
}

function resolveOutputTexture(outputTexture: LiquidGlassR3FOutputTexture, state: RootState) {
  return typeof outputTexture === 'function' ? outputTexture(state) : outputTexture
}

function createBackgroundTarget(options: LiquidGlassR3FRenderTargetOptions | undefined) {
  const backgroundTarget = new RenderTarget(1, 1, {
    format: options?.format ?? RGBAFormat,
    type: options?.type ?? UnsignedByteType,
    colorSpace: options?.colorSpace ?? SRGBColorSpace,
    depthBuffer: options?.depthBuffer ?? true,
    stencilBuffer: options?.stencilBuffer ?? false,
    samples: options?.samples ?? 0,
  })
  backgroundTarget.texture.name = '@liquid-dom/r3f-backdrop'
  return backgroundTarget
}

function disposeResources(resources: BridgeResources | null) {
  resources?.contentSource.destroy()
  resources?.glass.destroy()
  resources?.backgroundTarget.dispose()
}

/**
 * Renders a LiquidScene over the current React Three Fiber scene using Three's WebGPU renderer.
 *
 * Mount this hook inside an R3F <Canvas>. It uses a positive useFrame priority by default, so R3F's
 * automatic final render is disabled and this hook renders the Three scene into an intermediate
 * target before compositing liquid glass to the canvas or supplied output texture.
 */
export function useLiquidGlassR3F({
  sceneRootRef,
  deferUntilSceneRoot = false,
  renderPriority = DEFAULT_RENDER_PRIORITY,
  enabled = true,
  dpr,
  outputTexture,
  renderTarget,
  onError,
}: UseLiquidGlassR3FOptions) {
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const resourcesRef = useRef<BridgeResources | null>(null)
  const drawingSizeRef = useRef(new Vector2())
  const targetSizeRef = useRef({ width: 0, height: 0 })
  const onErrorRef = useRef(onError)
  const sceneRoot = sceneRootRef.current
  onErrorRef.current = onError

  useEffect(() => {
    if (!enabled) {
      disposeResources(resourcesRef.current)
      resourcesRef.current = null
      return undefined
    }

    if (renderPriority <= 0) {
      reportError(
        createIntegrationError('requires a positive renderPriority so the bridge can take over final rendering.'),
        onErrorRef.current,
      )
      return undefined
    }

    if (!sceneRoot) {
      if (deferUntilSceneRoot) {
        return undefined
      }

      reportError(
        createIntegrationError('requires sceneRootRef.current. Render a LiquidScene with the same ref.'),
        onErrorRef.current,
      )
      return undefined
    }

    const renderer = requireR3FWebGpuRenderer(gl)
    const backgroundTarget = createBackgroundTarget(renderTarget)
    const contentSource = new WebGpuDomContentSource({
      targetCanvas: renderer.domElement,
      getCurrentDpr: () => renderer.getPixelRatio(),
      scene: sceneRoot.scene,
    })
    const glass = new ThreeGlassRenderer({
      renderer,
      scene: sceneRoot.scene,
      contentSource,
    })

    try {
      contentSource.setDevice(glass.device, glass.format)
      resourcesRef.current = { backgroundTarget, contentSource, glass }
      invalidate()
    } catch (error) {
      disposeResources({ backgroundTarget, contentSource, glass })
      resourcesRef.current = null
      reportError(error, onErrorRef.current)
      return undefined
    }

    return () => {
      disposeResources(resourcesRef.current)
      resourcesRef.current = null
      targetSizeRef.current = { width: 0, height: 0 }
    }
  }, [
    enabled,
    deferUntilSceneRoot,
    gl,
    invalidate,
    renderPriority,
    renderTarget?.colorSpace,
    renderTarget?.depthBuffer,
    renderTarget?.format,
    renderTarget?.samples,
    renderTarget?.stencilBuffer,
    renderTarget?.type,
    sceneRoot,
    sceneRootRef,
  ])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    if (!sceneRoot) {
      return undefined
    }

    return sceneRoot.layoutScene.addInvalidationListener(() => {
      invalidate()
    })
  }, [enabled, invalidate, sceneRoot, sceneRootRef])

  useFrame((state, delta) => {
    if (!enabled) {
      return
    }

    const sceneRoot = sceneRootRef.current
    const resources = resourcesRef.current
    if (!sceneRoot || !resources) {
      return
    }

    try {
      const renderer = requireR3FWebGpuRenderer(state.gl)
      const drawingSize = renderer.getDrawingBufferSize(drawingSizeRef.current)
      const drawingWidth = Math.max(1, Math.floor(drawingSize.x))
      const drawingHeight = Math.max(1, Math.floor(drawingSize.y))
      if (
        targetSizeRef.current.width !== drawingWidth ||
        targetSizeRef.current.height !== drawingHeight
      ) {
        resources.backgroundTarget.setSize(drawingWidth, drawingHeight)
        targetSizeRef.current = { width: drawingWidth, height: drawingHeight }
      }

      sceneRoot.update({ width: state.size.width, height: state.size.height }, delta * 1000)

      renderer.setRenderTarget(resources.backgroundTarget)
      try {
        renderer.render(state.scene as Scene, state.camera)
      } finally {
        renderer.setRenderTarget(null)
      }

      resources.contentSource.sync()
      resources.glass.render({
        backdrop: resources.backgroundTarget,
        outputTexture: resolveOutputTexture(outputTexture, state) ?? undefined,
        width: drawingWidth,
        height: drawingHeight,
        dpr: resolveDpr(dpr, state, renderer),
      })
    } catch (error) {
      reportError(error, onErrorRef.current)
    }
  }, enabled ? renderPriority : 0)
}

/** Provider shared by the R3F render bridge and the DOM-side liquid-glass scene root. */
export function LiquidGlassR3FRoot({ children, sceneRootRef }: LiquidGlassR3FRootProps) {
  const internalSceneRootRef = useRef<LiquidSceneRef | null>(null)
  const resolvedSceneRootRef = sceneRootRef ?? internalSceneRootRef
  const [r3fInvalidate, setR3FInvalidateState] = useState<(() => void) | null>(null)
  const [sceneRoot, setSceneRootState] = useState<LiquidSceneRef | null>(resolvedSceneRootRef.current)
  const setR3FInvalidate = useCallback((invalidate: (() => void) | null) => {
    setR3FInvalidateState(() => invalidate)
  }, [])
  const setSceneRoot = useCallback((sceneRoot: LiquidSceneRef | null) => {
    resolvedSceneRootRef.current = sceneRoot
    setSceneRootState(sceneRoot)
  }, [resolvedSceneRootRef])
  const value = useMemo(() => ({
    r3fInvalidate,
    sceneRoot,
    sceneRootRef: resolvedSceneRootRef,
    setR3FInvalidate,
    setSceneRoot,
  }), [r3fInvalidate, resolvedSceneRootRef, sceneRoot, setR3FInvalidate, setSceneRoot])

  return (
    <LiquidGlassR3FContext.Provider value={value}>
      {children}
    </LiquidGlassR3FContext.Provider>
  )
}

/** DOM-side retained liquid-glass scene. Render this as a sibling of the R3F Canvas. */
export function LiquidGlassR3FScene({ children }: LiquidGlassR3FSceneProps) {
  const context = useRequiredLiquidGlassR3FContext('LiquidGlassR3F.Scene')

  return (
    <LiquidScene
      ref={context.setSceneRoot}
      onInvalidateFrame={context.r3fInvalidate ?? undefined}
      onInvalidateLayout={context.r3fInvalidate ?? undefined}
    >
      {children}
    </LiquidScene>
  )
}

/** R3F-side bridge. Render this inside an existing <Canvas>; it does not create or own the Canvas. */
export function LiquidGlassR3FRender(props: LiquidGlassR3FRenderProps) {
  const context = useContext(LiquidGlassR3FContext)
  const invalidate = useThree((state) => state.invalidate)
  const setR3FInvalidate = context?.setR3FInvalidate
  const sceneRootRef = props.sceneRootRef ?? context?.sceneRootRef
  if (!sceneRootRef) {
    throw createIntegrationError(
      'LiquidGlassR3F.Render requires sceneRootRef or must be rendered inside <LiquidGlassR3F.Root>.',
    )
  }

  useEffect(() => {
    setR3FInvalidate?.(invalidate)
    return () => {
      setR3FInvalidate?.(null)
    }
  }, [invalidate, setR3FInvalidate])

  useLiquidGlassR3F({
    ...props,
    sceneRootRef,
    deferUntilSceneRoot: true,
  })
  return null
}

/** Namespace-style component API plus the render bridge as the callable default. */
export const LiquidGlassR3F = Object.assign(LiquidGlassR3FRender, {
  Root: LiquidGlassR3FRoot,
  Scene: LiquidGlassR3FScene,
  Render: LiquidGlassR3FRender,
})
