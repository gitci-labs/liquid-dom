import { describe, expect, it } from 'vitest'
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
  Glass as SceneGlass,
} from '../src/scene'

describe('layout UI tree', () => {
  it('positions fixed-size HTML leaves from layout', () => {
    const scene = new LayoutScene()
    const html = scene.add(new Html({ width: 80, height: 24 }))

    const stats = scene.layout({})

    expect(stats.nodes).toBe(1)
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

    firstGlass.add(new Html({ width: 20, height: 10 }))
    secondGlass.add(new Html({ width: 30, height: 10 }))
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
    const first = row.add(new Html({ width: 10, height: 10 }))
    const frame = row.add(new Frame({ width: 20, height: 20, alignment: 'bottomTrailing' }))
    const second = frame.add(new Html({ width: 5, height: 5 }))

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

    frame.add(new Html({ width: 1, height: 1 }))

    expect(() => frame.add(new Html({ width: 1, height: 1 }))).toThrow(/exactly one child/)
  })

  it('keeps background and overlay layout slots while applying scene paint order', () => {
    const background = new Background()
    const backgroundContent = background.add(new Html({ width: 10, height: 10 }))
    const backgroundDecoration = background.add(new Html({ width: 20, height: 20 }))
    const overlay = new Overlay()
    const overlayContent = overlay.add(new Html({ width: 10, height: 10 }))
    const overlayDecoration = overlay.add(new Html({ width: 20, height: 20 }))

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
    row.add(new Html({ width: 20, height: 10 }))
    const transform = row.add(new Transform({
      x: 3,
      y: 4,
      scaleX: 2,
      scaleY: 0.5,
      rotation: 0.25,
      origin: { x: 1, y: 2 },
    }))
    transform.add(new Html({ width: 10, height: 10 }))

    scene.layout({})

    expect(transform.sceneNode.x).toBe(28)
    expect(transform.sceneNode.y).toBe(4)
    expect(transform.sceneNode.scaleX).toBe(2)
    expect(transform.sceneNode.scaleY).toBe(0.5)
    expect(transform.sceneNode.rotation).toBe(0.25)
    expect(transform.sceneNode.origin).toEqual({ x: 1, y: 2 })
  })
})
