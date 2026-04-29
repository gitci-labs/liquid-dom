import { describe, expect, it } from 'vitest'
import {
  Container,
  flattenContainerGlasses,
  flattenGlassHtml,
  flattenSceneLayers,
  Glass,
  Group,
  Html,
  Scene,
  StackingContext,
} from '../src/scene'

describe('StackingContext', () => {
  it('isolates scene descendant z-index from the parent scene context', () => {
    const scene = new Scene()
    const lowerContext = scene.add(new StackingContext({ zIndex: 0 }))
    const upperContext = scene.add(new StackingContext({ zIndex: 1 }))
    const lowerHtml = lowerContext.add(new Html({ zIndex: 100 }))
    const upperHtml = upperContext.add(new Html({ zIndex: 0 }))

    expect(flattenSceneLayers(scene).map((layer) => layer.child)).toEqual([
      lowerHtml,
      upperHtml,
    ])
  })

  it('keeps transform-only groups in the parent stacking context', () => {
    const scene = new Scene()
    const group = scene.add(new Group())
    const highHtml = group.add(new Html({ zIndex: 100 }))
    const lowHtml = scene.add(new Html({ zIndex: 0 }))

    expect(flattenSceneLayers(scene).map((layer) => layer.child)).toEqual([
      lowHtml,
      highHtml,
    ])
  })

  it('isolates glass z-index inside container stacking contexts', () => {
    const container = new Container()
    const lowerContext = container.add(new StackingContext({ zIndex: 0 }))
    const upperContext = container.add(new StackingContext({ zIndex: 1 }))
    const lowerGlass = lowerContext.add(new Glass({ zIndex: 100 }))
    const upperGlass = upperContext.add(new Glass({ zIndex: 0 }))

    expect(flattenContainerGlasses(container).map((layer) => layer.glass)).toEqual([
      lowerGlass,
      upperGlass,
    ])
  })

  it('isolates glass HTML z-index inside glass stacking contexts', () => {
    const glass = new Glass()
    const lowerContext = glass.add(new StackingContext({ zIndex: 0 }))
    const upperContext = glass.add(new StackingContext({ zIndex: 1 }))
    const lowerHtml = lowerContext.add(new Html({ zIndex: 100 }))
    const upperHtml = upperContext.add(new Html({ zIndex: 0 }))

    expect(flattenGlassHtml(glass).map((layer) => layer.html)).toEqual([
      lowerHtml,
      upperHtml,
    ])
  })
})
