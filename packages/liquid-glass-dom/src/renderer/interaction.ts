import { invertMatrix, multiplyMatrices, transformPoint, type Matrix2D } from '../matrix'
import { flattenContainerGlasses, type Container, type Glass } from '../scene'

/** Flattened container with the world transform used for hit testing. */
export type FlattenedContainer = {
  container: Container
  transform: Matrix2D
}

/** Cached geometry and transform data for pointer interaction with one glass. */
export type GlassInteractionEntry = {
  glass: Glass
  container: Container
  containerOrder: number
  glassOrder: number
  transform: Matrix2D
  inverseTransform: Matrix2D
  halfWidth: number
  halfHeight: number
  cornerRadius: number
  cornerTransitionSpeed: number
}

/** Canvas-relative pointer coordinates paired with the original DOM event. */
export type PointerSnapshot = {
  nativeEvent: PointerEvent
  canvasX: number
  canvasY: number
}

/** Mutable pointer interaction state tracked per native pointer id. */
export type PointerState = {
  hoveredGlass: Glass | null
  capturedGlass: Glass | null
  capturedWithNativePointerCapture: boolean
  pressedGlass: Glass | null
  lastSnapshot: PointerSnapshot | null
}

/** Restricts a number to an inclusive range. */
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** Computes a superellipse-style length used by the rounded glass SDF. */
function squircleLength(x: number, y: number) {
  return (x ** 4 + y ** 4) ** 0.25
}

/** Computes Euclidean length used by the circular corner fallback. */
function circularLength(x: number, y: number) {
  return Math.hypot(x, y)
}

/** Signed distance to a rounded rectangle with squircle-to-circle blending. */
function sdRoundRect(
  localX: number,
  localY: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
  cornerTransitionSpeed: number,
) {
  const cornerLimit = Math.min(halfWidth, halfHeight)
  const clampedRadius = Math.min(radius, cornerLimit)
  const blendDistance = Math.max(cornerTransitionSpeed, 0.0001)
  const circleBlend = clamp((radius - cornerLimit) / blendDistance, 0, 1)
  const qx = Math.abs(localX) - halfWidth + clampedRadius
  const qy = Math.abs(localY) - halfHeight + clampedRadius
  const cornerX = Math.max(qx, 0)
  const cornerY = Math.max(qy, 0)
  const cornerDistance =
    squircleLength(cornerX, cornerY) * (1 - circleBlend) +
    circularLength(cornerX, cornerY) * circleBlend
  return cornerDistance + Math.min(Math.max(qx, qy), 0) - clampedRadius
}

/** Converts a 2D matrix into the CSS matrix() transform syntax. */
export function matrixToCssTransform(matrix: Matrix2D) {
  return `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${matrix.e}, ${matrix.f})`
}

/** Builds the ordered hit-test cache for every pointer-enabled glass. */
export function createGlassInteractionEntries(containers: FlattenedContainer[]) {
  const entriesByGlass = new Map<Glass, GlassInteractionEntry>()
  const orderedEntries: GlassInteractionEntry[] = []

  for (let containerOrder = 0; containerOrder < containers.length; containerOrder += 1) {
    const entry = containers[containerOrder]

    for (const glassLayer of flattenContainerGlasses(entry.container)) {
      const glass = glassLayer.glass
      if (!glass.pointerEvents || glass.width <= 0 || glass.height <= 0) {
        continue
      }

      const transform = multiplyMatrices(entry.transform, glassLayer.transform)
      const inverseTransform = invertMatrix(transform)
      if (!inverseTransform) {
        continue
      }

      const interactionEntry = {
        glass,
        container: entry.container,
        containerOrder,
        glassOrder: glassLayer.traversalIndex,
        transform,
        inverseTransform,
        halfWidth: glass.width * 0.5,
        halfHeight: glass.height * 0.5,
        cornerRadius: glass.cornerRadius,
        cornerTransitionSpeed: glass.cornerTransitionSpeed,
      } satisfies GlassInteractionEntry

      entriesByGlass.set(glass, interactionEntry)
      orderedEntries.push(interactionEntry)
    }
  }

  orderedEntries.sort(
    (left, right) =>
      left.containerOrder - right.containerOrder ||
      left.glassOrder - right.glassOrder,
  )

  return {
    entriesByGlass,
    orderedEntries,
  }
}

/** Measures a canvas point in a glass interaction entry's local space. */
export function measureGlassInteractionEntry(entry: GlassInteractionEntry, canvasX: number, canvasY: number) {
  const localPoint = transformPoint(entry.inverseTransform, canvasX, canvasY)
  const centeredX = localPoint.x - entry.halfWidth
  const centeredY = localPoint.y - entry.halfHeight
  return {
    localX: localPoint.x,
    localY: localPoint.y,
    inside:
      sdRoundRect(
        centeredX,
        centeredY,
        entry.halfWidth,
        entry.halfHeight,
        entry.cornerRadius,
        entry.cornerTransitionSpeed,
      ) <= 0,
  }
}

/** Returns the topmost glass interaction entry containing a canvas point. */
export function hitTestGlassInteractionEntries(
  entries: GlassInteractionEntry[],
  canvasX: number,
  canvasY: number,
) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (measureGlassInteractionEntry(entry, canvasX, canvasY).inside) {
      return entry
    }
  }

  return null
}
