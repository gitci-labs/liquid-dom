import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Background,
  Frame,
  Glass,
  GlassContainer,
  HStack,
  Html,
  LayoutScene,
  Overlay,
  Transform,
} from '../src/layout'
import {
  flattenContainerGlasses,
  flattenGlassHtml,
  flattenSceneLayers,
  Container as SceneContainer,
  Glass as SceneGlass,
  Html as SceneHtml,
} from '../src/scene'
import { DEFAULT_CORNER_SMOOTHING } from '../src/corner-smoothing'

function fixedHtml(width: number, height: number) {
  const frame = new Frame({ width, height })
  const html = frame.add(new Html({ sizing: 'fill' }))
  return { frame, html }
}

describe('layout UI tree', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('positions fixed-size HTML leaves from layout', () => {
    const scene = new LayoutScene()
    const { frame, html } = fixedHtml(80, 24)
    scene.add(frame)

    const stats = scene.layout({})

    expect(stats.nodes).toBe(2)
    expect(html.layoutNode.layout?.rect).toEqual({ x: 0, y: 0, width: 80, height: 24 })
    expect(html.sceneNode.x).toBe(0)
    expect(html.sceneNode.y).toBe(0)
    expect(html.sceneNode.width).toBe(80)
    expect(html.sceneNode.height).toBe(24)
  })

  it('positions frame-wrapped glass nodes under a glass container', () => {
    const scene = new LayoutScene()
    const container = scene.add(new GlassContainer())
    const row = container.add(new HStack({ spacing: 5, alignment: 'top' }))
    const frame = row.add(new Frame({ alignment: 'topLeading' }))
    const firstGlass = frame.add(new Glass())
    const secondGlass = row.add(new Glass())

    firstGlass.add(fixedHtml(20, 10).frame)
    secondGlass.add(fixedHtml(30, 10).frame)
    scene.layout({})

    const glassLayers = flattenContainerGlasses(container.sceneNode)

    expect(glassLayers).toHaveLength(2)
    expect(glassLayers[0]?.glass).toBe(firstGlass.sceneNode)
    expect(glassLayers[0]?.transform.e).toBe(0)
    expect(glassLayers[1]?.glass).toBe(secondGlass.sceneNode)
    expect(glassLayers[1]?.transform.e).toBe(25)
    expect(secondGlass.sceneNode.width).toBe(30)
    expect(secondGlass.sceneNode.height).toBe(10)
  })

  it('composes group-backed layout node transforms into flattened scene layers', () => {
    const scene = new LayoutScene()
    const row = scene.add(new HStack({ spacing: 4, alignment: 'top' }))
    const firstHtml = fixedHtml(10, 10)
    const first = firstHtml.html
    row.add(firstHtml.frame)
    const frame = row.add(new Frame({ width: 20, height: 20, alignment: 'bottomTrailing' }))
    const secondHtml = fixedHtml(5, 5)
    const second = secondHtml.html
    frame.add(secondHtml.frame)

    scene.layout({})

    const layers = flattenSceneLayers(scene.scene)

    expect(layers[0]?.child).toBe(first.sceneNode)
    expect(layers[0]?.transform.e).toBe(0)
    expect(layers[1]?.child).toBe(second.sceneNode)
    expect(layers[1]?.transform.e).toBe(29)
    expect(layers[1]?.transform.f).toBe(15)
  })

  it('rejects a second child for noop-backed single-child wrappers', () => {
    const frame = new Frame()

    frame.add(new Html())

    expect(() => frame.add(new Html())).toThrow(/exactly one child/)
  })

  it('keeps background and overlay layout slots while applying scene paint order', () => {
    const background = new Background()
    const backgroundContent = background.add(new Html())
    const backgroundDecoration = background.add(new Html())
    const overlay = new Overlay()
    const overlayContent = overlay.add(new Html())
    const overlayDecoration = overlay.add(new Html())

    expect(background.layoutNode.children).toEqual([
      backgroundContent.layoutNode,
      backgroundDecoration.layoutNode,
    ])
    expect(overlay.layoutNode.children).toEqual([
      overlayContent.layoutNode,
      overlayDecoration.layoutNode,
    ])

    const backgroundGlass = new SceneGlass()
    backgroundGlass.add(background.sceneNode)
    expect(flattenGlassHtml(backgroundGlass).map((layer) => layer.html)).toEqual([
      backgroundDecoration.sceneNode,
      backgroundContent.sceneNode,
    ])

    const overlayGlass = new SceneGlass()
    overlayGlass.add(overlay.sceneNode)
    expect(flattenGlassHtml(overlayGlass).map((layer) => layer.html)).toEqual([
      overlayContent.sceneNode,
      overlayDecoration.sceneNode,
    ])
  })

  it('combines transform node options with layout placement', () => {
    const scene = new LayoutScene()
    const row = scene.add(new HStack({ spacing: 5, alignment: 'top' }))
    row.add(fixedHtml(20, 10).frame)
    const transform = row.add(new Transform({
      x: 3,
      y: 4,
      scaleX: 2,
      scaleY: 0.5,
      rotation: 0.25,
      origin: { x: 0.1, y: 0.2 },
    }))
    transform.add(fixedHtml(10, 10).frame)

    scene.layout({})

    expect(transform.sceneNode.x).toBe(28)
    expect(transform.sceneNode.y).toBe(4)
    expect(transform.sceneNode.scaleX).toBe(2)
    expect(transform.sceneNode.scaleY).toBe(0.5)
    expect(transform.sceneNode.rotation).toBe(0.25)
    expect(transform.sceneNode.origin).toEqual({ x: 1, y: 2 })
  })

  it('resolves transform unit origins from measured layout dimensions', () => {
    const scene = new LayoutScene()
    const transform = scene.add(new Transform({
      origin: { x: 0.5, y: 0.5 },
    }))
    const frame = transform.add(fixedHtml(80, 40).frame)

    scene.layout({})

    expect(transform.origin).toEqual({ x: 0.5, y: 0.5 })
    expect(transform.sceneNode.origin).toEqual({ x: 40, y: 20 })

    frame.width = 120
    frame.height = 60
    scene.layout({})

    expect(transform.sceneNode.origin).toEqual({ x: 60, y: 30 })
  })

  it('emits layout and frame invalidations from node mutations', () => {
    const scene = new LayoutScene()
    const container = scene.add(new GlassContainer())
    const row = container.add(new HStack())
    const glass = row.add(new Glass())
    const events: string[] = []
    scene.addInvalidationListener((event) => events.push(event.kind))

    row.spacing = 12
    glass.cornerRadius = 18

    expect(events).toEqual(['layout', 'frame'])
  })

  it('stores normal-divergence blend mode on scene containers', () => {
    const defaultContainer = new SceneContainer()
    expect(defaultContainer.normalDivergenceBlendMode).toBe('half-chord')
    expect(defaultContainer.normalDivergenceBlendExponentialLambda).toBe(4)
    expect(defaultContainer.normalDivergenceBlendGaussianLambda).toBe(4)
    expect(defaultContainer.normalDivergenceBlendRationalSoftness).toBe(0.5)
    expect(defaultContainer.normalDivergenceBlendBetaAlpha).toBe(1.5)
    expect(defaultContainer.normalDivergenceBlendBetaBeta).toBe(2.2)
    expect(defaultContainer.normalDivergenceBlendLogisticCenter).toBe(0.5)
    expect(defaultContainer.normalDivergenceBlendLogisticK).toBe(12)
    expect(defaultContainer.exposureBlendEnabled).toBe(true)
    expect(defaultContainer.exposureBlendStrength).toBe(1)
    expect(defaultContainer.exposureBlendBandScale).toBe(0.35)
    expect(defaultContainer.exposureBlendMinBand).toBe(1)
    expect(defaultContainer.exposureBlendAngleRange).toBe(Math.PI / 2)
    expect(defaultContainer.exposureBlendAnglePlateau).toBe(Math.PI / 6)
    expect(defaultContainer.exposureBlendAngleCurve).toBe('plateau')
    expect(defaultContainer.exposureBlendCurve).toBe('smootherstep')

    const container = new SceneContainer({
      normalDivergenceBlendMode: 'smoothstep',
      normalDivergenceBlendExponentialLambda: 2.5,
      normalDivergenceBlendGaussianLambda: 3.5,
      normalDivergenceBlendRationalSoftness: 0.4,
      normalDivergenceBlendBetaAlpha: 1.8,
      normalDivergenceBlendBetaBeta: 2.6,
      normalDivergenceBlendLogisticCenter: 0.45,
      normalDivergenceBlendLogisticK: 14,
      exposureBlendEnabled: false,
      exposureBlendStrength: 0.6,
      exposureBlendBandScale: 0.75,
      exposureBlendMinBand: 2,
      exposureBlendAngleRange: Math.PI / 4,
      exposureBlendAnglePlateau: Math.PI / 12,
      exposureBlendAngleCurve: 'triangle',
      exposureBlendCurve: 'smoothstep',
    })
    expect(container.normalDivergenceBlendMode).toBe('smoothstep')
    expect(container.normalDivergenceBlendExponentialLambda).toBe(2.5)
    expect(container.normalDivergenceBlendGaussianLambda).toBe(3.5)
    expect(container.normalDivergenceBlendRationalSoftness).toBe(0.4)
    expect(container.normalDivergenceBlendBetaAlpha).toBe(1.8)
    expect(container.normalDivergenceBlendBetaBeta).toBe(2.6)
    expect(container.normalDivergenceBlendLogisticCenter).toBe(0.45)
    expect(container.normalDivergenceBlendLogisticK).toBe(14)
    expect(container.exposureBlendEnabled).toBe(false)
    expect(container.exposureBlendStrength).toBe(0.6)
    expect(container.exposureBlendBandScale).toBe(0.75)
    expect(container.exposureBlendMinBand).toBe(2)
    expect(container.exposureBlendAngleRange).toBe(Math.PI / 4)
    expect(container.exposureBlendAnglePlateau).toBe(Math.PI / 12)
    expect(container.exposureBlendAngleCurve).toBe('triangle')
    expect(container.exposureBlendCurve).toBe('smoothstep')

    container.normalDivergenceBlendMode = 'none'
    expect(container.normalDivergenceBlendMode).toBe('none')

    container.normalDivergenceBlendMode = 'smootherstep'
    container.normalDivergenceBlendBetaAlpha = 1.2
    container.normalDivergenceBlendBetaBeta = 3.4
    container.normalDivergenceBlendLogisticCenter = 0.6
    container.normalDivergenceBlendLogisticK = 8
    container.exposureBlendEnabled = true
    container.exposureBlendStrength = 0.25
    container.exposureBlendBandScale = 1.25
    container.exposureBlendMinBand = 3
    container.exposureBlendAngleRange = Math.PI / 3
    container.exposureBlendAnglePlateau = Math.PI / 8
    container.exposureBlendAngleCurve = 'none'
    container.exposureBlendCurve = 'smootherstep'
    expect(container.normalDivergenceBlendMode).toBe('smootherstep')
    expect(container.normalDivergenceBlendBetaAlpha).toBe(1.2)
    expect(container.normalDivergenceBlendBetaBeta).toBe(3.4)
    expect(container.normalDivergenceBlendLogisticCenter).toBe(0.6)
    expect(container.normalDivergenceBlendLogisticK).toBe(8)
    expect(container.exposureBlendEnabled).toBe(true)
    expect(container.exposureBlendStrength).toBe(0.25)
    expect(container.exposureBlendBandScale).toBe(1.25)
    expect(container.exposureBlendMinBand).toBe(3)
    expect(container.exposureBlendAngleRange).toBe(Math.PI / 3)
    expect(container.exposureBlendAnglePlateau).toBe(Math.PI / 8)
    expect(container.exposureBlendAngleCurve).toBe('none')
    expect(container.exposureBlendCurve).toBe('smootherstep')
  })

  it('propagates normal-divergence blend mode changes and invalidates frames', () => {
    const scene = new LayoutScene()
    const container = scene.add(new GlassContainer({
      normalDivergenceBlendMode: 'half-chord',
    }))
    const events: string[] = []
    scene.addInvalidationListener((event) => events.push(event.kind))

    container.normalDivergenceBlendMode = 'smootherstep'
    container.normalDivergenceBlendExponentialLambda = 7
    container.normalDivergenceBlendBetaAlpha = 1.7
    container.exposureBlendEnabled = false
    container.exposureBlendStrength = 0.5
    container.exposureBlendBandScale = 1.1
    container.exposureBlendMinBand = 2.5
    container.exposureBlendAngleRange = Math.PI / 6
    container.exposureBlendAnglePlateau = Math.PI / 18
    container.exposureBlendAngleCurve = 'cosine-peak'
    container.exposureBlendCurve = 'smoothstep'

    expect(container.sceneNode.normalDivergenceBlendMode).toBe('smootherstep')
    expect(container.sceneNode.normalDivergenceBlendExponentialLambda).toBe(7)
    expect(container.sceneNode.normalDivergenceBlendBetaAlpha).toBe(1.7)
    expect(container.sceneNode.exposureBlendEnabled).toBe(false)
    expect(container.sceneNode.exposureBlendStrength).toBe(0.5)
    expect(container.sceneNode.exposureBlendBandScale).toBe(1.1)
    expect(container.sceneNode.exposureBlendMinBand).toBe(2.5)
    expect(container.sceneNode.exposureBlendAngleRange).toBe(Math.PI / 6)
    expect(container.sceneNode.exposureBlendAnglePlateau).toBe(Math.PI / 18)
    expect(container.sceneNode.exposureBlendAngleCurve).toBe('cosine-peak')
    expect(container.sceneNode.exposureBlendCurve).toBe('smoothstep')
    expect(events).toEqual(['frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame'])
  })

  it('stores uniform glass corner radius and smoothing on scene nodes', () => {
    const defaultGlass = new SceneGlass()
    expect(defaultGlass.cornerRadius).toBe(0)
    expect(defaultGlass.cornerSmoothing).toBe(DEFAULT_CORNER_SMOOTHING)

    const glass = new SceneGlass({
      cornerRadius: 12,
      cornerSmoothing: 0.35,
    })

    expect(glass.cornerRadius).toBe(12)
    expect(glass.cornerSmoothing).toBe(0.35)

    glass.cornerRadius = 20
    glass.cornerSmoothing = 2
    expect(glass.cornerRadius).toBe(20)
    expect(glass.cornerSmoothing).toBe(1)

    glass.cornerRadius = -4
    glass.cornerSmoothing = -1
    expect(glass.cornerRadius).toBe(0)
    expect(glass.cornerSmoothing).toBe(0)
  })

  it('propagates glass corner geometry changes and invalidates frames', () => {
    const scene = new LayoutScene()
    const container = scene.add(new GlassContainer())
    const glass = container.add(new Glass({ cornerRadius: 10, cornerSmoothing: 0.2 }))
    const events: string[] = []
    scene.addInvalidationListener((event) => events.push(event.kind))

    glass.cornerRadius = 24
    glass.cornerSmoothing = 0.6

    expect(glass.sceneNode.cornerRadius).toBe(24)
    expect(glass.sceneNode.cornerSmoothing).toBe(0.6)
    expect(events).toEqual(['frame', 'frame'])
  })

  it('stores blur on scene HTML nodes', () => {
    const html = new SceneHtml()
    expect(html.blur).toBe(0)

    const initializedHtml = new SceneHtml({ blur: 12 })
    expect(initializedHtml.blur).toBe(12)

    initializedHtml.blur = 4
    expect(initializedHtml.blur).toBe(4)
  })

  it('propagates HTML blur to the scene node and invalidates frames', () => {
    const scene = new LayoutScene()
    const html = scene.add(new Html({ blur: 10 }))
    const events: string[] = []
    scene.addInvalidationListener((event) => events.push(event.kind))

    expect(html.blur).toBe(10)
    expect(html.sceneNode.blur).toBe(10)

    html.blur = 2

    expect(html.blur).toBe(2)
    expect(html.sceneNode.blur).toBe(2)
    expect(events).toEqual(['frame'])
  })

  it('emits layout invalidation when an HTML measured element is replaced', () => {
    const scene = new LayoutScene()
    const html = scene.add(new Html())
    const events: string[] = []
    scene.addInvalidationListener((event) => events.push(event.kind))

    html.setElement(document.createElement('div'))

    expect(events).toEqual(['layout'])
  })

  it('lets owned fill HTML portal roots fill their scene host', () => {
    const html = new Html({ sizing: 'fill' })

    expect(html.element?.style.display).toBe('block')
    expect(html.element?.style.width).toBe('100%')
    expect(html.element?.style.height).toBe('100%')
    expect(html.element?.style.boxSizing).toBe('border-box')

    html.sizing = 'intrinsic'

    expect(html.element?.style.display).toBe('')
    expect(html.element?.style.width).toBe('')
    expect(html.element?.style.height).toBe('')
    expect(html.element?.style.boxSizing).toBe('')
  })

  it('does not mutate externally provided fill HTML elements', () => {
    const element = document.createElement('div')
    element.style.width = '240px'

    new Html({ element, sizing: 'fill' })

    expect(element.style.width).toBe('240px')
    expect(element.style.height).toBe('')
    expect(element.style.display).toBe('')
  })

  it('forwards DOM measurement subscription invalidations through LayoutScene', () => {
    let resizeCallback: ((entries?: ResizeObserverEntry[]) => void) | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: (entries?: ResizeObserverEntry[]) => void) {
        resizeCallback = callback
      }

      observe() {
        return
      }

      disconnect() {
        return
      }
    })

    const scene = new LayoutScene()
    scene.add(new Html())
    const events: string[] = []
    scene.addInvalidationListener((event) => events.push(event.kind))

    scene.layout({})
    resizeCallback?.([{ contentRect: { width: 10, height: 10 } } as ResizeObserverEntry])

    expect(events).toEqual(['layout'])
  })
})
