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
import { LayoutScene } from '../layout'
import { Renderer } from '../renderer'
import type {
  FrameCallback,
  FrameLoopEntry,
  FrameState,
  LayoutCanvasProps,
} from './types'
import {
  RootContext,
  renderNodeChildren,
  syncOrderedChildren,
  useOrderedChildRegistrar,
  useRequiredRoot,
  useStableNode,
} from './tree'
import type { ProposedSize } from 'laymeout'

function createRequiredRendererGetter(rendererRef: MutableRefObject<Renderer | null>) {
  return () => {
    const renderer = rendererRef.current
    if (!renderer) {
      throw new Error('LayoutCanvas renderer is not available until the component is mounted.')
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

/** Root component that owns a layout scene, renderer, canvas, and frame loop. */
export function LayoutCanvas({
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
}: LayoutCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const layoutScene = useStableNode(() => new LayoutScene())
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
      for (const entry of entries) {
        entry.callbackRef.current(frameState)
      }

      const shouldLayout = layoutDirtyRef.current
      if (shouldLayout) {
        layoutScene.layout(proposalRef.current)
        layoutDirtyRef.current = false
      }

      if (frameLoopModeRef.current === 'always' || frameDirtyRef.current || shouldLayout) {
        renderer.render()
        frameDirtyRef.current = false
      }
    } catch (error) {
      onErrorRef.current?.(error)
      if (!onErrorRef.current) {
        throw error
      }
    }

    if (frameLoopModeRef.current === 'always' || frameDirtyRef.current || layoutDirtyRef.current) {
      scheduleFrame()
    }
  }

  const rootParent = useOrderedChildRegistrar(
    useCallback((children) => syncOrderedChildren(layoutScene, children), [layoutScene]),
  )
  const rootContextValue = useMemo(() => ({
    layoutScene,
    getRenderer,
    invalidateLayout,
    invalidateFrame,
    registerFrame,
  }), [layoutScene, getRenderer, invalidateLayout, invalidateFrame, registerFrame])

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

/** Registers a callback in the nearest {@link LayoutCanvas} frame loop. */
export function useFrame(callback: FrameCallback, priority = 0) {
  const root = useRequiredRoot()
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => root.registerFrame(callbackRef, priority), [root, priority])
}

/** Returns the nearest retained layout scene. */
export function useLayoutScene() {
  return useRequiredRoot().layoutScene
}

/** Returns the nearest renderer. */
export function useRenderer() {
  const renderer = useRequiredRoot().getRenderer()
  if (!renderer) {
    throw new Error('Renderer is not available until LayoutCanvas is mounted.')
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
