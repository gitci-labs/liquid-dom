import { StrictMode, createRef, useEffect, type ReactNode, type Ref } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Background,
  Frame,
  Glass,
  GlassContainer,
  HStack,
  Html,
  LiquidCanvas,
  Overlay,
  VStack,
  ZStack,
  AnimationConfigProvider,
  AnimationManager,
  Easing,
  easing,
  spring,
  useAnimate,
  useFrame,
  useTimeline,
  type GlassRef,
  type FrameRef,
  type HStackRef,
  type HtmlRef,
  type LiquidCanvasRef,
  type BackgroundRef,
  type GlassContainerRef,
  type OverlayRef,
  type VStackRef,
} from '../src'
import { flattenGlassHtml } from '../../core/src/scene'

const rendererState = vi.hoisted(() => ({
  instances: [] as Array<{
    scene: unknown
    maxDpr: number
    canvas: HTMLCanvasElement
    render: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('@liquid-dom/core', () => {
  class Renderer {
    scene: unknown
    maxDpr: number
    canvas = document.createElement('canvas')
    render = vi.fn()
    destroy = vi.fn()

    constructor(options: { scene?: unknown; maxDpr?: number } = {}) {
      this.scene = options.scene
      this.maxDpr = options.maxDpr ?? 2
      rendererState.instances.push(this)
    }
  }

  return { Renderer }
})

vi.mock('@liquid-dom/core/layout', async () => (
  vi.importActual<typeof import('../../core/src/layout')>('../../core/src/layout')
))

let frameCallbacks: Map<number, FrameRequestCallback>
let frameId: number

class TestResizeObserver {
  observe() {
    return
  }

  disconnect() {
    return
  }
}

beforeEach(() => {
  rendererState.instances.length = 0
  frameCallbacks = new Map()
  frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameId += 1
    frameCallbacks.set(frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frameCallbacks.delete(id)
  })
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

async function renderReact(element: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
  })
  await act(async () => undefined)

  return {
    container,
    root,
    async rerender(next: ReactNode) {
      await act(async () => {
        root.render(next)
      })
      await act(async () => undefined)
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
    },
  }
}

function flushFrame(time = 16) {
  const callbacks = [...frameCallbacks.values()]
  frameCallbacks.clear()
  act(() => {
    for (const callback of callbacks) {
      callback(time)
    }
  })
}

function FixedHtml({
  htmlRef,
  width,
  height,
  children,
}: {
  htmlRef?: Ref<HtmlRef>
  width: number
  height: number
  children?: ReactNode
}) {
  return (
    <Frame width={width} height={height}>
      <Html ref={htmlRef} sizing="fill">
        {children}
      </Html>
    </Frame>
  )
}

describe('React layout components', () => {
  it('interprets spring velocity as speed toward the target', () => {
    const manager = new AnimationManager()
    const increasingTarget = { value: 0 }
    const decreasingTarget = { value: 100 }
    const transition = spring({
      stiffness: 0,
      damping: 0,
      velocity: 100,
      restDelta: 0,
      restSpeed: 0,
    })

    manager.animate(increasingTarget, { value: 100 }, transition)
    manager.animate(decreasingTarget, { value: 0 }, transition)
    manager.tick(100)

    expect(increasingTarget.value).toBeGreaterThan(0)
    expect(decreasingTarget.value).toBeLessThan(100)
  })

  it('treats negative spring velocity as speed magnitude toward the target', () => {
    const manager = new AnimationManager()
    const target = { value: 100 }

    manager.animate(target, { value: 0 }, spring({
      stiffness: 0,
      damping: 0,
      velocity: -100,
      restDelta: 0,
      restSpeed: 0,
    }))
    manager.tick(100)

    expect(target.value).toBeLessThan(100)
  })

  it('resolves spring velocity direction independently for object-valued leaves', () => {
    const manager = new AnimationManager()
    const target = {
      value: {
        x: 0,
        y: 100,
      },
    }

    manager.animate(target, {
      value: {
        x: 100,
        y: 0,
      },
    }, spring({
      stiffness: 0,
      damping: 0,
      velocity: 100,
      restDelta: 0,
      restSpeed: 0,
    }))
    manager.tick(100)

    expect(target.value.x).toBeGreaterThan(0)
    expect(target.value.y).toBeLessThan(100)
  })

  it('recomputes nonzero spring velocity direction when retargeting', () => {
    const manager = new AnimationManager()
    const target = { value: 0 }
    const transition = spring({
      stiffness: 0,
      damping: 0,
      velocity: 100,
      restDelta: 0,
      restSpeed: 0,
    })

    manager.animate(target, { value: 100 }, transition)
    manager.tick(100)
    const valueBeforeRetargetTick = target.value

    manager.animate(target, { value: -100 }, transition)
    manager.tick(16)

    expect(target.value).toBeLessThan(valueBeforeRetargetTick)
  })

  it('runs linear easing halfway at half duration', () => {
    const manager = new AnimationManager()
    const target = { value: 0 }

    manager.animate(target, { value: 100 }, easing({
      duration: 0.1,
      ease: Easing.linear,
    }))
    manager.tick(50)

    expect(target.value).toBeCloseTo(50)
  })

  it('applies easeInOut differently than linear progress', () => {
    const manager = new AnimationManager()
    const target = { value: 0 }

    manager.animate(target, { value: 100 }, easing({
      duration: 0.1,
      ease: Easing.easeInOut,
    }))
    manager.tick(25)

    expect(target.value).toBeCloseTo(12.5)
    expect(target.value).not.toBeCloseTo(25)
  })

  it('interpolates object-valued easing per numeric leaf', () => {
    const manager = new AnimationManager()
    const target = {
      value: {
        x: 0,
        y: 100,
      },
    }

    manager.animate(target, {
      value: {
        x: 100,
        y: 0,
      },
    }, easing({
      duration: 0.1,
      ease: Easing.linear,
    }))
    manager.tick(50)

    expect(target.value.x).toBeCloseTo(50)
    expect(target.value.y).toBeCloseTo(50)
  })

  it('retargets active easing from the current interpolated value', () => {
    const manager = new AnimationManager()
    const target = { value: 0 }
    const transition = easing({
      duration: 0.1,
      ease: Easing.linear,
    })

    manager.animate(target, { value: 100 }, transition)
    manager.tick(50)
    expect(target.value).toBeCloseTo(50)

    manager.animate(target, { value: 0 }, transition)
    manager.tick(25)

    expect(target.value).toBeCloseTo(37.5)
  })

  it('snaps easing animations with nonpositive duration to the target', () => {
    const manager = new AnimationManager()
    const target = { value: 0 }

    manager.animate(target, { value: 100 }, easing({
      duration: 0,
      ease: Easing.linear,
    }))

    expect(target.value).toBe(100)
    expect(manager.active).toBe(false)
  })

  it('allows easing output to overshoot the target', () => {
    const manager = new AnimationManager()
    const target = { value: 0 }

    manager.animate(target, { value: 100 }, easing({
      duration: 0.1,
      ease: () => 1.25,
    }))
    manager.tick(50)

    expect(target.value).toBeCloseTo(125)

    manager.tick(50)
    expect(target.value).toBeCloseTo(100)
  })

  it('provides linear cubic bezier easing for a linear curve', () => {
    const linearBezier = Easing.bezier(0, 0, 1, 1)

    expect(linearBezier(0)).toBeCloseTo(0)
    expect(linearBezier(0.25)).toBeCloseTo(0.25)
    expect(linearBezier(0.5)).toBeCloseTo(0.5)
    expect(linearBezier(0.75)).toBeCloseTo(0.75)
    expect(linearBezier(1)).toBeCloseTo(1)
  })

  it('scales declarative animations under AnimationConfigProvider', async () => {
    const frameRef = createRef<FrameRef>()
    const transition = { width: easing({ duration: 1, ease: Easing.linear }) }
    const renderFrame = (width: number, timeScale: number) => (
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <AnimationConfigProvider timeScale={timeScale}>
          <Frame
            ref={frameRef}
            width={width}
            height={20}
            transition={transition}
          >
            <Html sizing="fill" />
          </Frame>
        </AnimationConfigProvider>
      </LiquidCanvas>
    )

    const view = await renderReact(renderFrame(0, 1))
    flushFrame(16)

    await view.rerender(renderFrame(100, 1))
    flushFrame(266)
    expect(frameRef.current?.width).toBeCloseTo(25)

    await view.rerender(renderFrame(100, 2))
    flushFrame(516)
    expect(frameRef.current?.width).toBeCloseTo(75)
  })

  it('scales useAnimate animations under AnimationConfigProvider', async () => {
    const frameRef = createRef<FrameRef>()

    function AnimateTrigger() {
      const animate = useAnimate()

      useEffect(() => {
        animate(frameRef.current, { width: 100 }, easing({
          duration: 1,
          ease: Easing.linear,
        }))
      }, [animate])

      return null
    }

    await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <AnimationConfigProvider timeScale={2}>
          <ZStack>
            <AnimateTrigger />
            <Frame ref={frameRef} width={0} height={20}>
              <Html sizing="fill" />
            </Frame>
          </ZStack>
        </AnimationConfigProvider>
      </LiquidCanvas>,
    )

    flushFrame(16)
    flushFrame(266)

    expect(frameRef.current?.width).toBeCloseTo(50)
  })

  it('exposes refs and mirrors children in React order', async () => {
    const canvasRef = createRef<LiquidCanvasRef>()
    const containerRef = createRef<GlassContainerRef>()
    const rowRef = createRef<HStackRef>()
    const firstRef = createRef<GlassRef>()
    const secondRef = createRef<GlassRef>()

    await renderReact(
      <LiquidCanvas ref={canvasRef} frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer ref={containerRef}>
          <HStack ref={rowRef} spacing={6}>
            <Glass ref={firstRef}>
              <FixedHtml width={10} height={10} />
            </Glass>
            <Glass ref={secondRef}>
              <FixedHtml width={20} height={10} />
            </Glass>
          </HStack>
        </GlassContainer>
      </LiquidCanvas>,
    )

    expect(canvasRef.current?.layoutScene.root).toBe(containerRef.current)
    expect(rowRef.current?.children).toEqual([firstRef.current, secondRef.current])
    expect(rendererState.instances[0]?.scene).toBe(canvasRef.current?.scene)
  })

  it('passes GlassContainer gating props through the ref', async () => {
    const containerRef = createRef<GlassContainerRef>()

    const view = await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer
          ref={containerRef}
          normalGating={{
            enabled: true,
          }}
          blendSupportGating={false}
        >
          <Glass>
            <FixedHtml width={10} height={10} />
          </Glass>
        </GlassContainer>
      </LiquidCanvas>,
    )

    expect(containerRef.current?.normalGating).toEqual({
      enabled: true,
    })
    expect(containerRef.current?.blendSupportGating).toEqual({
      enabled: false,
      cellSize: 100,
    })

    await view.rerender(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer
          ref={containerRef}
          normalGating={false}
          blendSupportGating={true}
        >
          <Glass>
            <FixedHtml width={10} height={10} />
          </Glass>
        </GlassContainer>
      </LiquidCanvas>,
    )

    expect(containerRef.current?.normalGating).toEqual({
      enabled: false,
    })
    expect(containerRef.current?.blendSupportGating).toEqual({
      enabled: true,
      cellSize: 100,
    })

    await view.rerender(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer
          ref={containerRef}
          normalGating={{
            enabled: true,
          }}
          blendSupportGating={false}
        >
          <Glass>
            <FixedHtml width={10} height={10} />
          </Glass>
        </GlassContainer>
      </LiquidCanvas>,
    )

    expect(containerRef.current?.normalGating).toEqual({
      enabled: true,
    })
    expect(containerRef.current?.blendSupportGating).toEqual({
      enabled: false,
      cellSize: 100,
    })
  })

  it('keeps child order stable through StrictMode effect replay', async () => {
    const rowRef = createRef<HStackRef>()
    const firstRef = createRef<GlassRef>()
    const secondRef = createRef<GlassRef>()

    await renderReact(
      <StrictMode>
        <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
          <GlassContainer>
            <HStack ref={rowRef}>
              <Glass ref={firstRef}>
                <FixedHtml width={10} height={10} />
              </Glass>
              <Glass ref={secondRef}>
                <FixedHtml width={20} height={10} />
              </Glass>
            </HStack>
          </GlassContainer>
        </LiquidCanvas>
      </StrictMode>,
    )

    expect(rowRef.current?.children).toEqual([firstRef.current, secondRef.current])
  })

  it('updates layout node props from React props', async () => {
    const columnRef = createRef<VStackRef>()
    const renderColumn = (spacing: number) => (
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer>
          <VStack ref={columnRef} spacing={spacing}>
            <Glass>
              <FixedHtml width={10} height={10} />
            </Glass>
          </VStack>
        </GlassContainer>
      </LiquidCanvas>
    )

    const view = await renderReact(renderColumn(8))
    expect(columnRef.current?.spacing).toBe(8)

    await view.rerender(renderColumn(24))
    expect(columnRef.current?.spacing).toBe(24)
  })

  it('animates declarative prop changes on the shared frame loop', async () => {
    const frameRef = createRef<FrameRef>()
    const renderFrame = (width: number) => (
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <ZStack>
          <Frame
            ref={frameRef}
            width={width}
            height={20}
            transition={{ width: spring({ stiffness: 300, damping: 30 }) }}
          >
            <Html sizing="fill" />
          </Frame>
        </ZStack>
      </LiquidCanvas>
    )

    const view = await renderReact(renderFrame(100))
    flushFrame()
    expect(frameRef.current?.width).toBe(100)

    await view.rerender(renderFrame(200))
    expect(frameRef.current?.width).toBe(100)

    flushFrame(32)
    expect(frameRef.current!.width).toBeGreaterThan(100)
    expect(frameRef.current!.width).toBeLessThan(200)
    expect(frameCallbacks.size).toBeGreaterThan(0)
  })

  it('runs imperative animations and timelines through the layout canvas loop', async () => {
    const firstRef = createRef<FrameRef>()
    const secondRef = createRef<FrameRef>()
    const fastSpring = spring({
      stiffness: 1000,
      damping: 100,
      restDelta: 1000,
      restSpeed: 1000,
    })

    function TimelineTrigger() {
      const createTimeline = useTimeline(fastSpring)

      useEffect(() => {
        if (!firstRef.current || !secondRef.current) {
          return
        }

        createTimeline()
          .to(firstRef.current, { width: 160 })
          .to(secondRef.current, { height: 80 })
          .play()
      }, [createTimeline])

      return null
    }

    await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <VStack>
          <TimelineTrigger />
          <Frame ref={firstRef} width={80} height={20}>
            <Html sizing="fill" />
          </Frame>
          <Frame ref={secondRef} width={80} height={20}>
            <Html sizing="fill" />
          </Frame>
        </VStack>
      </LiquidCanvas>,
    )

    expect(firstRef.current?.width).toBe(80)
    expect(secondRef.current?.height).toBe(20)

    flushFrame(32)
    await act(async () => undefined)
    expect(firstRef.current?.width).toBe(160)
    expect(secondRef.current?.height).toBe(20)

    flushFrame(48)
    await act(async () => undefined)
    expect(secondRef.current?.height).toBe(80)
  })

  it('exposes useAnimate for direct node animations', async () => {
    const frameRef = createRef<FrameRef>()

    function AnimateTrigger() {
      const animate = useAnimate()

      useEffect(() => {
        animate(frameRef.current, { width: 180 }, spring({
          stiffness: 1000,
          damping: 100,
          restDelta: 1000,
          restSpeed: 1000,
        }))
      }, [animate])

      return null
    }

    await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <ZStack>
          <AnimateTrigger />
          <Frame ref={frameRef} width={90} height={20}>
            <Html sizing="fill" />
          </Frame>
        </ZStack>
      </LiquidCanvas>,
    )

    expect(frameRef.current?.width).toBe(90)
    flushFrame(32)
    expect(frameRef.current?.width).toBe(180)
  })

  it('mounts Html children into the layout Html element', async () => {
    const htmlRef = createRef<HtmlRef>()

    await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <ZStack>
          <FixedHtml htmlRef={htmlRef} width={40} height={20}>
            <span data-testid="inside-html">Hello</span>
          </FixedHtml>
        </ZStack>
      </LiquidCanvas>,
    )

    expect(htmlRef.current?.element).not.toBeNull()
    expect(htmlRef.current?.element).not.toBe(htmlRef.current?.sceneNode.host)
    expect(htmlRef.current?.element?.parentElement).toBe(htmlRef.current?.sceneNode.host)
    expect(htmlRef.current?.element?.style.width).toBe('100%')
    expect(htmlRef.current?.element?.style.height).toBe('100%')
    expect(htmlRef.current?.element?.style.display).toBe('block')
    expect(htmlRef.current?.element?.querySelector('[data-testid="inside-html"]')?.textContent).toBe('Hello')
  })

  it('passes Html blur props through the ref', async () => {
    const htmlRef = createRef<HtmlRef>()

    const view = await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <ZStack>
          <Frame width={40} height={20}>
            <Html ref={htmlRef} blur={12} sizing="fill" />
          </Frame>
        </ZStack>
      </LiquidCanvas>,
    )

    expect(htmlRef.current?.blur).toBe(12)

    await view.rerender(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <ZStack>
          <Frame width={40} height={20}>
            <Html ref={htmlRef} blur={3} sizing="fill" />
          </Frame>
        </ZStack>
      </LiquidCanvas>,
    )

    expect(htmlRef.current?.blur).toBe(3)
  })

  it('schedules layout when Html is mutated through its ref', async () => {
    const htmlRef = createRef<HtmlRef>()

    await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <ZStack>
          <FixedHtml htmlRef={htmlRef} width={40} height={20} />
        </ZStack>
      </LiquidCanvas>,
    )
    flushFrame()

    const renderer = rendererState.instances[0]!
    renderer.render.mockClear()
    const replacement = document.createElement('div')

    act(() => {
      htmlRef.current?.setElement(replacement)
    })
    flushFrame(32)

    expect(htmlRef.current?.element).toBe(replacement)
    expect(renderer.render).toHaveBeenCalledTimes(1)
  })

  it('uses dedicated Overlay and Background decoration props', async () => {
    const overlayRef = createRef<OverlayRef>()
    const overlayContentFrameRef = createRef<FrameRef>()
    const overlayDecorationFrameRef = createRef<FrameRef>()
    const overlayContentRef = createRef<HtmlRef>()
    const overlayDecorationRef = createRef<HtmlRef>()
    const backgroundRef = createRef<BackgroundRef>()
    const backgroundContentFrameRef = createRef<FrameRef>()
    const backgroundDecorationFrameRef = createRef<FrameRef>()
    const backgroundContentRef = createRef<HtmlRef>()
    const backgroundDecorationRef = createRef<HtmlRef>()
    const glassRef = createRef<GlassRef>()

    await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer>
          <Glass ref={glassRef}>
            <VStack>
              <Overlay
                ref={overlayRef}
                overlay={
                  <Frame ref={overlayDecorationFrameRef} width={20} height={20}>
                    <Html ref={overlayDecorationRef} sizing="fill" />
                  </Frame>
                }
              >
                <Frame ref={overlayContentFrameRef} width={10} height={10}>
                  <Html ref={overlayContentRef} sizing="fill" />
                </Frame>
              </Overlay>
              <Background
                ref={backgroundRef}
                background={
                  <Frame ref={backgroundDecorationFrameRef} width={20} height={20}>
                    <Html ref={backgroundDecorationRef} sizing="fill" />
                  </Frame>
                }
              >
                <Frame ref={backgroundContentFrameRef} width={10} height={10}>
                  <Html ref={backgroundContentRef} sizing="fill" />
                </Frame>
              </Background>
            </VStack>
          </Glass>
        </GlassContainer>
      </LiquidCanvas>,
    )

    expect(overlayRef.current?.layoutNode.children).toEqual([
      overlayContentFrameRef.current?.layoutNode,
      overlayDecorationFrameRef.current?.layoutNode,
    ])
    expect(backgroundRef.current?.layoutNode.children).toEqual([
      backgroundContentFrameRef.current?.layoutNode,
      backgroundDecorationFrameRef.current?.layoutNode,
    ])
    expect(flattenGlassHtml(glassRef.current!.sceneNode).map((layer) => layer.html)).toEqual([
      overlayContentRef.current?.sceneNode,
      overlayDecorationRef.current?.sceneNode,
      backgroundDecorationRef.current?.sceneNode,
      backgroundContentRef.current?.sceneNode,
    ])
  })

  it('wires Glass pointer props and pointerEvents defaults', async () => {
    const glassRef = createRef<GlassRef>()
    const onClick = vi.fn()

    await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer>
          <Glass ref={glassRef} onClick={onClick}>
            <FixedHtml width={10} height={10} />
          </Glass>
        </GlassContainer>
      </LiquidCanvas>,
    )

    expect(glassRef.current?.pointerEvents).toBe(true)
    act(() => {
      glassRef.current?.sceneNode.dispatchEvent(new Event('click'))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('passes Glass corner smoothing props through the ref', async () => {
    const glassRef = createRef<GlassRef>()

    const view = await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer>
          <Glass
            ref={glassRef}
            cornerRadius={10}
            cornerSmoothing={0.25}
          >
            <FixedHtml width={10} height={10} />
          </Glass>
        </GlassContainer>
      </LiquidCanvas>,
    )

    expect(glassRef.current?.cornerRadius).toBe(10)
    expect(glassRef.current?.cornerSmoothing).toBe(0.25)

    await view.rerender(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer>
          <Glass
            ref={glassRef}
            cornerRadius={12}
            cornerSmoothing={0.7}
          >
            <FixedHtml width={10} height={10} />
          </Glass>
        </GlassContainer>
      </LiquidCanvas>,
    )

    expect(glassRef.current?.cornerRadius).toBe(12)
    expect(glassRef.current?.cornerSmoothing).toBe(0.7)
  })

  it('reports Glass hover and press state callbacks', async () => {
    const glassRef = createRef<GlassRef>()
    const onHover = vi.fn()
    const onPress = vi.fn()

    await renderReact(
      <LiquidCanvas frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <GlassContainer>
          <Glass ref={glassRef} onHover={onHover} onPress={onPress}>
            <FixedHtml width={10} height={10} />
          </Glass>
        </GlassContainer>
      </LiquidCanvas>,
    )

    expect(glassRef.current?.pointerEvents).toBe(true)

    act(() => {
      glassRef.current?.sceneNode.dispatchEvent(new Event('pointerenter'))
    })
    expect(onHover).toHaveBeenLastCalledWith(true)

    act(() => {
      glassRef.current?.sceneNode.dispatchEvent(new Event('pointerdown'))
    })
    expect(onPress).toHaveBeenLastCalledWith(true)

    act(() => {
      glassRef.current?.sceneNode.dispatchEvent(new Event('pointerleave'))
    })
    expect(onHover).toHaveBeenLastCalledWith(false)
    expect(onPress).toHaveBeenLastCalledWith(false)

    expect(onHover).toHaveBeenCalledTimes(2)
    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it('runs useFrame callbacks in priority order and cleans them up', async () => {
    const calls: string[] = []
    const canvasRef = createRef<LiquidCanvasRef>()

    function Probe({ enabled }: { enabled: boolean }) {
      if (!enabled) {
        return null
      }

      return <FrameCallbacks calls={calls} />
    }

    function FrameCallbacks({ calls: target }: { calls: string[] }) {
      useFrame(() => target.push('late'), 10)
      useFrame(() => target.push('early'), -1)
      return null
    }

    const renderProbe = (enabled: boolean) => (
      <LiquidCanvas ref={canvasRef} frameloop="demand" proposal={{ width: 320, height: 200 }}>
        <ZStack>
          <Probe enabled={enabled} />
          <FixedHtml width={10} height={10} />
        </ZStack>
      </LiquidCanvas>
    )

    const view = await renderReact(renderProbe(true))
    flushFrame()
    expect(calls).toEqual(['early', 'late'])

    await view.rerender(renderProbe(false))
    canvasRef.current?.invalidateFrame()
    flushFrame(32)
    expect(calls).toEqual(['early', 'late'])
  })
})
