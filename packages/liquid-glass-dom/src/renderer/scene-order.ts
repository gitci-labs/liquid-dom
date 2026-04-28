import { Container, flattenSceneLayers, Glass, Html, Scene, type TraversedSceneLayer } from '../scene'
import type { FlattenedContainer } from './interaction'

/** Returns top-level render layers sorted by z-index and traversal order. */
export function getSortedSceneLayers(scene: Scene) {
  return flattenSceneLayers(scene).sort((left, right) => {
    const leftZIndex = left.child.zIndex
    const rightZIndex = right.child.zIndex
    return leftZIndex - rightZIndex || left.traversalIndex - right.traversalIndex
  })
}

/** Returns a container's glass children sorted by z-index and child order. */
export function getSortedGlasses(container: Container) {
  return container._children
    .map((glass, index) => ({ glass, index }))
    .sort((left, right) => left.glass.zIndex - right.glass.zIndex || left.index - right.index)
    .map((entry) => entry.glass)
}

/** Returns a glass node's HTML children sorted by z-index and child order. */
export function getSortedGlassHtml(glass: Glass) {
  return glass._children
    .map((html, index) => ({ html, index }))
    .sort((left, right) => left.html.zIndex - right.html.zIndex || left.index - right.index)
    .map((entry) => entry.html)
}

/** Extracts flattened container layers for interaction and content sync. */
export function getLayerContainers(layers: TraversedSceneLayer[]): FlattenedContainer[] {
  return layers
    .filter((entry): entry is TraversedSceneLayer & { child: Container } => entry.child instanceof Container)
    .map((entry) => ({
      container: entry.child,
      transform: entry.transform,
    }))
}

/** Computes stable DOM/z-index order for all live HTML hosts in render order. */
export function getHtmlHostOrder(layers: TraversedSceneLayer[]) {
  const order = new Map<Html, number>()
  let nextOrder = 1

  for (const layer of layers) {
    if (layer.child instanceof Html) {
      if (layer.child.width > 0 && layer.child.height > 0) {
        order.set(layer.child, nextOrder)
        nextOrder += 1
      }
      continue
    }

    for (const glass of getSortedGlasses(layer.child)) {
      for (const html of getSortedGlassHtml(glass)) {
        if (html.width > 0 && html.height > 0) {
          order.set(html, nextOrder)
          nextOrder += 1
        }
      }
    }
  }

  return order
}
