import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from 'react'
import { Renderer } from '@liquid-dom/core'
import { LayoutScene } from '@liquid-dom/core/layout'
import { AnimationManager, AnimationTimeline, type AnimationConfig } from './animation'
import { useAnimationTimeScaleRef } from './animationConfig'
import type {
  AnimateFunction,
  FrameCallback,
  FrameLoopEntry,
  FrameState,
  LiquidCanvasProps,
  LiquidSceneProps,
} from './types'
import {
  RootContext,
  renderNodeChildren,
  syncOrderedChildren,
  useOrderedChildRegistrar,
  useRequiredRoot,
  useStableNode,
} from './tree'
import type { ProposedSize } from '@liquid-dom/layout'

function createRequiredRendererGetter(rendererRef: MutableRefObject<Renderer | null>) {
  return () => {
    const renderer = rendererRef.current
    if (!renderer) {
      throw new Error('LiquidCanvas renderer is not available until the component is mounted.')
    }
    return renderer
  }
}

function useStyleObject(style: CSSProperties | undefined) {
  const styleRef = useRef(style)
  styleRef.current = style
  return styleRef
}

function applyStyle(element: HTMLElement, style: CSSProperties | undefined) {
  if (!style) {
    return
  }

  Object.assign(element.style, style)
}

/** Headless React root that builds a retained liquid scene without owning a renderer. */
export function LiquidScene({
  ref,
  children,
  onInvalidateFrame,
  onInvalidateLayout,
}: LiquidSceneProps) {
  const layoutScene = useStableNode(() => new LayoutScene())
  const animationManager = useStableNode(() => new AnimationManager())
  const layoutDirtyRef = useRef(true)
  const frameDirtyRef = useRef(true)
  const proposalRef = useRef<ProposedSize | null>(null)
  const onInvalidateFrameRef = useRef(onInvalidateFrame)
  const onInvalidateLayoutRef = useRef(onInvalidateLayout)
  onInvalidateFrameRef.current = onInvalidateFrame
  onInvalidateLayoutRef.current = onInvalidateLayout

  const invalidateFrame = useCallback(() => {
    frameDirtyRef.current = true
    onInvalidateFrameRef.current?.()
  }, [])

  const invalidateLayout = useCallback(() => {
    layoutDirtyRef.current = true
    frameDirtyRef.current = true
    onInvalidateLayoutRef.current?.()
  }, [])

  const rootParent = useOrderedChildRegistrar(
    useCallback((children) => syncOrderedChildren(layoutScene, children), [layoutScene]),
  )
  const rootContextValue = useMemo(() => ({
    layoutScene,
    animationManager,
    getRenderer: () => null,
    invalidateLayout,
    invalidateFrame,
    registerFrame: () => () => undefined,
  }), [layoutScene, animationManager, invalidateLayout, invalidateFrame])

  useImperativeHandle(ref, () => ({
    layoutScene,
    scene: layoutScene.scene,
    update(proposal, delta = 0) {
      animationManager.tick(delta)
      const proposalChanged =
        !proposalRef.current ||
        proposalRef.current.width !== proposal.width ||
        proposalRef.current.height !== proposal.height
      if (layoutDirtyRef.current || proposalChanged) {
        layoutScene.layout(proposal)
        proposalRef.current = proposal
        layoutDirtyRef.current = false
      }
      frameDirtyRef.current = false
      if (animationManager.active) {
        onInvalidateFrameRef.current?.()
      }
    },
    invalidateLayout,
    invalidateFrame,
  }), [layoutScene, animationManager, invalidateLayout, invalidateFrame])

  useLayoutEffect(() => layoutScene.addInvalidationListener((invalidation) => {
    if (invalidation.kind === 'layout') {
      invalidateLayout()
    } else {
      invalidateFrame()
    }
  }), [layoutScene, invalidateLayout, invalidateFrame])

  return (
    <RootContext.Provider value={rootContextValue}>
      {renderNodeChildren(rootParent, children)}
    </RootContext.Provider>
  )
}

/** Root component that owns a retained liquid scene, renderer, canvas, and frame loop. */
export function LiquidCanvas({
  ref,
  children,
  className,
  style,
  canvasClassName,
  canvasStyle,
  maxDpr = 2,
  proposal,
  frameloop = 'always',
  onError,
}: LiquidCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const layoutScene = useStableNode(() => new LayoutScene())
  const animationManager = useStableNode(() => new AnimationManager())
  const [ready, setReady] = useState(false)
  const proposalRef = useRef<ProposedSize>({ width: 0, height: 0 })
  const layoutDirtyRef = useRef(true)
  const frameDirtyRef = useRef(true)
  const frameLoopEntriesRef = useRef(new Set<FrameLoopEntry>())
  const frameEntryOrderRef = useRef(0)
  const frameLoopModeRef = useRef(frameloop)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const onErrorRef = useRef(onError)
  const canvasStyleRef = useStyleObject(canvasStyle)
  onErrorRef.current = onError
  frameLoopModeRef.current = frameloop

  const getRenderer = useCallback(() => rendererRef.current, [])
  const requireRenderer = useMemo(() => createRequiredRendererGetter(rendererRef), [])

  const runFrameRef = useRef<(time: number) => void>(() => undefined)
  const scheduleFrame = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return
    }

    animationFrameRef.current = requestAnimationFrame((time) => runFrameRef.current(time))
  }, [])

  const invalidateFrame = useCallback(() => {
    frameDirtyRef.current = true
    scheduleFrame()
  }, [scheduleFrame])

  const invalidateLayout = useCallback(() => {
    layoutDirtyRef.current = true
    frameDirtyRef.current = true
    scheduleFrame()
  }, [scheduleFrame])

  const registerFrame = useCallback((callbackRef: MutableRefObject<FrameCallback>, priority: number) => {
    const entry = {
      callbackRef,
      priority,
      order: frameEntryOrderRef.current,
    }
    frameEntryOrderRef.current += 1
    frameLoopEntriesRef.current.add(entry)
    invalidateFrame()

    return () => {
      frameLoopEntriesRef.current.delete(entry)
    }
  }, [invalidateFrame])

  runFrameRef.current = (time) => {
    animationFrameRef.current = null
    const renderer = rendererRef.current
    if (!renderer) {
      return
    }

    const previousTime = lastFrameTimeRef.current ?? time
    lastFrameTimeRef.current = time
    const frameState: FrameState = {
      layoutScene,
      renderer,
      scene: layoutScene.scene,
      canvas: renderer.canvas,
      time,
      delta: time - previousTime,
      invalidateLayout,
      invalidateFrame,
    }

    const entries = [...frameLoopEntriesRef.current]
      .sort((left, right) => left.priority - right.priority || left.order - right.order)
    try {
      const animationUpdated = animationManager.tick(time - previousTime)
      for (const entry of entries) {
        entry.callbackRef.current(frameState)
      }

      const shouldLayout = layoutDirtyRef.current
      if (shouldLayout) {
        layoutScene.layout(proposalRef.current)
        layoutDirtyRef.current = false
      }

      if (frameLoopModeRef.current === 'always' || frameDirtyRef.current || shouldLayout || animationUpdated) {
        renderer.render()
        frameDirtyRef.current = false
      }
    } catch (error) {
      onErrorRef.current?.(error)
      if (!onErrorRef.current) {
        throw error
      }
    }

    if (
      frameLoopModeRef.current === 'always' ||
      frameDirtyRef.current ||
      layoutDirtyRef.current ||
      animationManager.active
    ) {
      scheduleFrame()
    }
  }

  const rootParent = useOrderedChildRegistrar(
    useCallback((children) => syncOrderedChildren(layoutScene, children), [layoutScene]),
  )
  const rootContextValue = useMemo(() => ({
    layoutScene,
    animationManager,
    getRenderer,
    invalidateLayout,
    invalidateFrame,
    registerFrame,
  }), [layoutScene, animationManager, getRenderer, invalidateLayout, invalidateFrame, registerFrame])

  useImperativeHandle(ref, () => ({
    layoutScene,
    scene: layoutScene.scene,
    get renderer() {
      return requireRenderer()
    },
    get canvas() {
      return requireRenderer().canvas
    },
    invalidateLayout,
    invalidateFrame,
  }), [layoutScene, requireRenderer, invalidateLayout, invalidateFrame])

  useLayoutEffect(() => layoutScene.addInvalidationListener((invalidation) => {
    if (invalidation.kind === 'layout') {
      invalidateLayout()
    } else {
      invalidateFrame()
    }
  }), [layoutScene, invalidateLayout, invalidateFrame])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const renderer = new Renderer({ scene: layoutScene.scene, maxDpr })
    rendererRef.current = renderer
    renderer.canvas.className = canvasClassName ?? ''
    applyStyle(renderer.canvas, canvasStyleRef.current)
    host.append(renderer.canvas)
    setReady(true)
    invalidateLayout()

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      renderer.destroy()
      renderer.canvas.remove()
      rendererRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) {
      return
    }

    renderer.maxDpr = maxDpr
    renderer.canvas.className = canvasClassName ?? ''
    applyStyle(renderer.canvas, canvasStyle)
    invalidateFrame()
  }, [maxDpr, canvasClassName, canvasStyle, invalidateFrame])

  useLayoutEffect(() => {
    if (proposal) {
      proposalRef.current = proposal
      invalidateLayout()
      return
    }

    const host = hostRef.current
    if (!host) {
      return
    }

    const syncProposal = () => {
      const bounds = host.getBoundingClientRect()
      proposalRef.current = {
        width: bounds.width,
        height: bounds.height,
      }
      invalidateLayout()
    }

    syncProposal()
    const observer = new ResizeObserver(syncProposal)
    observer.observe(host)
    return () => observer.disconnect()
  }, [proposal?.width, proposal?.height, invalidateLayout])

  useEffect(() => {
    if (frameloop === 'always') {
      scheduleFrame()
    }
  }, [frameloop, ready, scheduleFrame])

  return (
    <div ref={hostRef} className={className} style={style}>
      {ready ? (
        <RootContext.Provider value={rootContextValue}>
          {renderNodeChildren(rootParent, children)}
        </RootContext.Provider>
      ) : null}
    </div>
  )
}

/** Registers a callback in the nearest {@link LiquidCanvas} frame loop. */
export function useFrame(callback: FrameCallback, priority = 0) {
  const root = useRequiredRoot()
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => root.registerFrame(callbackRef, priority), [root, priority])
}

/** Returns the nearest retained liquid scene. */
export function useLiquidScene() {
  return useRequiredRoot().layoutScene
}

/** Returns the nearest renderer. */
export function useRenderer() {
  const renderer = useRequiredRoot().getRenderer()
  if (!renderer) {
    throw new Error('Renderer is not available until LiquidCanvas is mounted.')
  }
  return renderer
}

/** Returns a function that schedules a layout pass and frame. */
export function useInvalidateLayout() {
  return useRequiredRoot().invalidateLayout
}

/** Returns a function that schedules a frame without marking layout dirty. */
export function useInvalidateFrame() {
  return useRequiredRoot().invalidateFrame
}

/** Returns an imperative retained-node animation function. */
export function useAnimate(): AnimateFunction {
  const root = useRequiredRoot()
  const timeScaleRef = useAnimationTimeScaleRef()
  return useCallback((target, values, transition) => {
    const controls = root.animationManager.animate(target, values, transition, { timeScaleRef })
    root.invalidateFrame()
    return controls
  }, [root, timeScaleRef])
}

/** Returns a factory for imperative animation timelines. */
export function useTimeline(defaultTransition?: AnimationConfig) {
  const root = useRequiredRoot()
  const timeScaleRef = useAnimationTimeScaleRef()
  return useCallback(() => new AnimationTimeline(
    root.animationManager,
    root.invalidateFrame,
    defaultTransition,
    timeScaleRef,
  ), [root, defaultTransition, timeScaleRef])
}
