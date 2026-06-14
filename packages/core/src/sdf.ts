import type { Point } from './types'

export const SDF_EPSILON = 0.0001

export type NormalGatingOptions = {
  enabled?: boolean
  hermiteCap?: number
  hermiteKnee?: number
}

export type NormalGating = false | NormalGatingOptions

export type ResolvedNormalGating = {
  enabled: boolean
  hermiteCap: number
  hermiteKnee: number
}

export type SmoothUnionOptions = {
  acceleration?: number
}

export type ResolvedSmoothUnionOptions = {
  acceleration: number
}

export type ShapeSubmergedAreasOf<T> = {
  bottomLeft: T
  bottomRight: T
  topLeft: T
  topRight: T
}

export type ShapeSubmergedAreas = ShapeSubmergedAreasOf<number>

export type BoundsRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type TransformedShapeBounds = {
  aabb: BoundsRect
  area: number
  polygon: Point[]
}

export type ShapeSubmersionEntry = {
  bounds: TransformedShapeBounds
  cellBounds: ShapeSubmergedAreasOf<TransformedShapeBounds>
}

export type SdfSample = {
  distance: number
  normal: Point
  submergedArea: number
}

export const DEFAULT_NORMAL_GATING: ResolvedNormalGating = {
  enabled: true,
  hermiteCap: 0.84,
  hermiteKnee: 0.7,
}

export const DEFAULT_SMOOTH_UNION: ResolvedSmoothUnionOptions = {
  acceleration: 0.35,
}

export function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1)
}

export function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress
}

export function resolveNormalGating(gating: NormalGating | undefined): ResolvedNormalGating {
  if (gating === undefined) {
    return { ...DEFAULT_NORMAL_GATING }
  }

  if (gating === false) {
    return {
      ...DEFAULT_NORMAL_GATING,
      enabled: false,
    }
  }

  return {
    enabled: gating.enabled ?? true,
    hermiteCap: gating.hermiteCap ?? DEFAULT_NORMAL_GATING.hermiteCap,
    hermiteKnee: gating.hermiteKnee ?? DEFAULT_NORMAL_GATING.hermiteKnee,
  }
}

export function sameNormalGating(left: ResolvedNormalGating, right: ResolvedNormalGating) {
  return (
    left.enabled === right.enabled &&
    Object.is(left.hermiteCap, right.hermiteCap) &&
    Object.is(left.hermiteKnee, right.hermiteKnee)
  )
}

export function resolveSmoothUnionOptions(options: SmoothUnionOptions | undefined): ResolvedSmoothUnionOptions {
  return {
    acceleration: options?.acceleration ?? DEFAULT_SMOOTH_UNION.acceleration,
  }
}

export function sameSmoothUnionOptions(
  left: ResolvedSmoothUnionOptions,
  right: ResolvedSmoothUnionOptions,
) {
  return Object.is(left.acceleration, right.acceleration)
}

export function hermiteCapGate(value: number, kneeInput: number, capInput: number) {
  const x = clamp01(value)
  const cap = clamp01(capInput)
  const knee = Math.min(clamp01(kneeInput), cap)
  if (x <= knee) {
    return x
  }

  const span = Math.max(1 - knee, SDF_EPSILON)
  const u = clamp01((x - knee) / span)
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2
  return clamp01(h00 * knee + h10 * span + h01 * cap)
}

export function normalGateForNormals(
  leftNormal: Point,
  rightNormal: Point,
  gating: ResolvedNormalGating,
) {
  const alignment = Math.min(Math.max(
    leftNormal.x * rightNormal.x + leftNormal.y * rightNormal.y,
    -1,
  ), 1)
  const angle = Math.acos(alignment)
  const normalizedAngle = clamp01(angle / Math.PI)
  const gate = gating.enabled
    ? hermiteCapGate(normalizedAngle, gating.hermiteKnee, gating.hermiteCap)
    : 1

  return {
    angle,
    gate: clamp01(gate),
  }
}

export function smoothUnionWeight(leftDistance: number, rightDistance: number, blendDistance: number) {
  return clamp01(0.5 + 0.5 * (rightDistance - leftDistance) / Math.max(blendDistance, SDF_EPSILON))
}

export function createEmptySubmergedAreas(): ShapeSubmergedAreas {
  return {
    topLeft: 0,
    topRight: 0,
    bottomLeft: 0,
    bottomRight: 0,
  }
}

export function shapeSubmergedAreaAtLocal(
  localPos: Point,
  size: { height: number; width: number },
  submergedAreas: ShapeSubmergedAreas,
) {
  const uvX = clamp01(localPos.x / Math.max(size.width, SDF_EPSILON))
  const uvY = clamp01(localPos.y / Math.max(size.height, SDF_EPSILON))
  const top = lerp(submergedAreas.topLeft, submergedAreas.topRight, uvX)
  const bottom = lerp(submergedAreas.bottomLeft, submergedAreas.bottomRight, uvX)
  return lerp(top, bottom, uvY)
}

export function shapeSubmergedAreaAtCenteredLocal(
  centeredLocalPos: Point,
  size: { height: number; width: number },
  submergedAreas: ShapeSubmergedAreas,
) {
  return shapeSubmergedAreaAtLocal({
    x: centeredLocalPos.x + size.width * 0.5,
    y: centeredLocalPos.y + size.height * 0.5,
  }, size, submergedAreas)
}

export function aabbFromPoints(points: Point[]): BoundsRect {
  return points.reduce<BoundsRect>((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  })
}

export function aabbArea(bounds: BoundsRect) {
  return Math.max(bounds.maxX - bounds.minX, 0) * Math.max(bounds.maxY - bounds.minY, 0)
}

export function intersectBounds(left: BoundsRect, right: BoundsRect): BoundsRect | null {
  const intersection = {
    minX: Math.max(left.minX, right.minX),
    minY: Math.max(left.minY, right.minY),
    maxX: Math.min(left.maxX, right.maxX),
    maxY: Math.min(left.maxY, right.maxY),
  }
  return aabbArea(intersection) > SDF_EPSILON ? intersection : null
}

export function polygonSignedArea(points: Point[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return area * 0.5
}

export function polygonArea(points: Point[]) {
  return Math.abs(polygonSignedArea(points))
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx
}

function isInsideClipEdge(point: Point, edgeStart: Point, edgeEnd: Point, clipWinding: number) {
  const edgeCross = cross(
    edgeEnd.x - edgeStart.x,
    edgeEnd.y - edgeStart.y,
    point.x - edgeStart.x,
    point.y - edgeStart.y,
  )
  return clipWinding >= 0 ? edgeCross >= -SDF_EPSILON : edgeCross <= SDF_EPSILON
}

function intersectLines(
  lineStart: Point,
  lineEnd: Point,
  clipStart: Point,
  clipEnd: Point,
): Point {
  const lineX = lineEnd.x - lineStart.x
  const lineY = lineEnd.y - lineStart.y
  const clipX = clipEnd.x - clipStart.x
  const clipY = clipEnd.y - clipStart.y
  const denominator = cross(lineX, lineY, clipX, clipY)
  if (Math.abs(denominator) <= SDF_EPSILON) {
    return lineEnd
  }

  const t = cross(clipStart.x - lineStart.x, clipStart.y - lineStart.y, clipX, clipY) / denominator
  return {
    x: lineStart.x + lineX * t,
    y: lineStart.y + lineY * t,
  }
}

function clipPolygonToEdge(subject: Point[], clipStart: Point, clipEnd: Point, clipWinding: number) {
  const output: Point[] = []
  if (subject.length === 0) {
    return output
  }

  let previous = subject[subject.length - 1]
  let previousInside = isInsideClipEdge(previous, clipStart, clipEnd, clipWinding)
  for (const current of subject) {
    const currentInside = isInsideClipEdge(current, clipStart, clipEnd, clipWinding)
    if (currentInside !== previousInside) {
      output.push(intersectLines(previous, current, clipStart, clipEnd))
    }
    if (currentInside) {
      output.push(current)
    }
    previous = current
    previousInside = currentInside
  }
  return output
}

export function intersectConvexPolygons(subject: Point[], clip: Point[]) {
  let output = subject
  const clipWinding = polygonSignedArea(clip)
  for (let index = 0; index < clip.length && output.length >= 3; index += 1) {
    output = clipPolygonToEdge(output, clip[index], clip[(index + 1) % clip.length], clipWinding)
  }
  return output.length >= 3 ? output : []
}

export function polygonUnionArea(polygons: Point[][], maxArea: number) {
  if (polygons.length === 0) {
    return 0
  }
  if (polygons.length > 8) {
    return Math.min(polygons.reduce((area, polygon) => area + polygonArea(polygon), 0), maxArea)
  }

  let area = 0
  const accumulate = (startIndex: number, currentPolygon: Point[] | null, subsetSize: number) => {
    for (let index = startIndex; index < polygons.length; index += 1) {
      const nextPolygon = currentPolygon
        ? intersectConvexPolygons(currentPolygon, polygons[index])
        : polygons[index]
      const nextArea = polygonArea(nextPolygon)
      if (nextArea <= SDF_EPSILON) {
        continue
      }

      const nextSubsetSize = subsetSize + 1
      area += nextSubsetSize % 2 === 1 ? nextArea : -nextArea
      accumulate(index + 1, nextPolygon, nextSubsetSize)
    }
  }
  accumulate(0, null, 0)
  return Math.min(Math.max(area, 0), maxArea)
}

export function estimateCellSubmersion<T extends ShapeSubmersionEntry>(
  entries: T[],
  self: T,
  cellBounds: TransformedShapeBounds,
) {
  if (cellBounds.area <= SDF_EPSILON) {
    return 0
  }

  const overlaps = entries.flatMap((other) => {
    if (other === self) {
      return []
    }
    if (!intersectBounds(cellBounds.aabb, other.bounds.aabb)) {
      return []
    }

    const overlap = intersectConvexPolygons(cellBounds.polygon, other.bounds.polygon)
    return polygonArea(overlap) > SDF_EPSILON ? [overlap] : []
  })

  return clamp01(polygonUnionArea(overlaps, cellBounds.area) / cellBounds.area)
}

export function estimateShapeCellSubmersions<T extends ShapeSubmersionEntry>(
  entries: T[],
  self: T,
): ShapeSubmergedAreas {
  return {
    topLeft: estimateCellSubmersion(entries, self, self.cellBounds.topLeft),
    topRight: estimateCellSubmersion(entries, self, self.cellBounds.topRight),
    bottomLeft: estimateCellSubmersion(entries, self, self.cellBounds.bottomLeft),
    bottomRight: estimateCellSubmersion(entries, self, self.cellBounds.bottomRight),
  }
}

export function estimateSubmergedAreaPercentagesFromBounds<T extends ShapeSubmersionEntry>(entries: T[]) {
  return entries.map((entry) => estimateShapeCellSubmersions(entries, entry))
}

export function smoothUnionGatingInfo(
  left: SdfSample,
  right: SdfSample,
  blendDistance: number,
  normalGating: ResolvedNormalGating,
  blendSupportGating: boolean,
) {
  const normalGate = normalGateForNormals(left.normal, right.normal, normalGating)
  const baseBlendDistance = blendDistance * normalGate.gate
  const baseH = smoothUnionWeight(left.distance, right.distance, baseBlendDistance)
  const submergedArea = lerp(right.submergedArea, left.submergedArea, baseH)
  const submergedAreaScale = blendSupportGating ? 1 - clamp01(submergedArea) : 1

  return {
    angle: normalGate.angle,
    blendDistance: baseBlendDistance * submergedAreaScale,
    normalGate: normalGate.gate,
    submergedArea: clamp01(submergedArea),
  }
}
