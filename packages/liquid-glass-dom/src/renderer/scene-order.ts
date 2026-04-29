import {
  Container,
  flattenContainerGlasses,
  flattenGlassHtml,
  flattenSceneLayers,
  Glass,
  Html,
  Scene,
  type TraversedSceneLayer,
} from '../scene'
import type { FlattenedContainer } from './interaction'

/** Returns top-level render layers in final scene paint order. */
export function getSortedSceneLayers(scene: Scene) {
  return flattenSceneLayers(scene)
}

/** Returns a container's flattened glass children in final local paint order. */
export function getSortedGlassLayers(container: Container) {
  return flattenContainerGlasses(container)
}

/** Returns a glass node's flattened HTML children in final local paint order. */
export function getSortedGlassHtmlLayers(glass: Glass) {
  return flattenGlassHtml(glass)
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

    for (const glassLayer of getSortedGlassLayers(layer.child)) {
      for (const htmlLayer of getSortedGlassHtmlLayers(glassLayer.glass)) {
        const html = htmlLayer.html
        if (html.width > 0 && html.height > 0) {
          order.set(html, nextOrder)
          nextOrder += 1
        }
      }
    }
  }

  return order
}
