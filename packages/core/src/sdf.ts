import type { Point } from './types'

export const SDF_EPSILON = 0.0001

export type NormalGatingOptions = {
  enabled?: boolean
}

export type NormalGating = false | NormalGatingOptions

export type ResolvedNormalGating = {
  enabled: boolean
}

export type SmoothUnionOptions = {
  acceleration?: number
}

export type ResolvedSmoothUnionOptions = {
  acceleration: number
}

export type BlendSupportGatingOptions = {
  enabled?: boolean
  cellSize?: number
}

export type BlendSupportGating = boolean | BlendSupportGatingOptions

export type ResolvedBlendSupportGating = {
  enabled: boolean
  cellSize: number
}

export type ShapeSubmersionCell = {
  bounds: TransformedShapeBounds
}

export type ShapeSubmersionGrid = {
  cells: ShapeSubmersionCell[]
  columns: number
  rows: number
}

export type ShapeSubmersionGridValues = {
  columns: number
  rows: number
  values: number[]
}

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
  submersionGrid?: ShapeSubmersionGrid
}

export type SdfSample = {
  distance: number
  normal: Point
  submergedArea: number
}

export const DEFAULT_NORMAL_GATING: ResolvedNormalGating = {
  enabled: true,
}

export const DEFAULT_SMOOTH_UNION: ResolvedSmoothUnionOptions = {
  acceleration: 0.35,
}

export const DEFAULT_BLEND_SUPPORT_GATING: ResolvedBlendSupportGating = {
  enabled: true,
  cellSize: 100,
}

const BLEND_SUPPORT_KERNEL_RADIUS = 2

export function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1)
}

function smoothstep01(value: number) {
  const x = clamp01(value)
  return x * x * (3 - 2 * x)
}

export function blendSupportScaleForSubmersion(submergedArea: number) {
  const clampedArea = clamp01(submergedArea)
  return 1 - smoothstep01(clampedArea)
}

function submersionGridGaussianWeight(offsetX: number, offsetY: number) {
  const kernelRadius = BLEND_SUPPORT_KERNEL_RADIUS
  const cutoff = (offset: number) => smoothstep01((kernelRadius + 0.5 - Math.abs(offset)) * 2)
  return Math.exp(-0.5 * (offsetX * offsetX + offsetY * offsetY)) * cutoff(offsetX) * cutoff(offsetY)
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
  }
}

export function sameNormalGating(left: ResolvedNormalGating, right: ResolvedNormalGating) {
  return left.enabled === right.enabled
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

export function resolveBlendSupportGating(gating: BlendSupportGating | undefined): ResolvedBlendSupportGating {
  if (gating === undefined) {
    return { ...DEFAULT_BLEND_SUPPORT_GATING }
  }

  if (typeof gating === 'boolean') {
    return {
      ...DEFAULT_BLEND_SUPPORT_GATING,
      enabled: gating,
    }
  }

  return {
    enabled: gating.enabled ?? true,
    cellSize: gating.cellSize ?? DEFAULT_BLEND_SUPPORT_GATING.cellSize,
  }
}

export function sameBlendSupportGating(
  left: ResolvedBlendSupportGating,
  right: ResolvedBlendSupportGating,
) {
  return left.enabled === right.enabled && Object.is(left.cellSize, right.cellSize)
}

export function normalAngleGate(value: number) {
  const x = clamp01(value)
  return clamp01(x + x * x - x * x * x)
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
  const gate = gating.enabled ? normalAngleGate(normalizedAngle) : 1

  return {
    angle,
    gate: clamp01(gate),
  }
}

export function smoothUnionWeight(leftDistance: number, rightDistance: number, blendDistance: number) {
  return clamp01(0.5 + 0.5 * (rightDistance - leftDistance) / Math.max(blendDistance, SDF_EPSILON))
}

function sampleSubmersionGridValue(grid: ShapeSubmersionGridValues, x: number, y: number) {
  const columns = Math.max(Math.round(grid.columns), 1)
  const rows = Math.max(Math.round(grid.rows), 1)
  const clampedX = Math.min(Math.max(x, 0), columns - 1)
  const clampedY = Math.min(Math.max(y, 0), rows - 1)
  return grid.values[clampedY * columns + clampedX] ?? 0
}

export function shapeSubmergedAreaAtGridLocal(
  localPos: Point,
  size: { height: number; width: number },
  grid: ShapeSubmersionGridValues,
) {
  const kernelRadius = BLEND_SUPPORT_KERNEL_RADIUS
  const columns = Math.max(Math.round(grid.columns), 1)
  const rows = Math.max(Math.round(grid.rows), 1)
  const uvX = clamp01(localPos.x / Math.max(size.width, SDF_EPSILON))
  const uvY = clamp01(localPos.y / Math.max(size.height, SDF_EPSILON))
  const gridX = uvX * columns - 0.5
  const gridY = uvY * rows - 0.5
  const centerX = Math.floor(gridX + 0.5)
  const centerY = Math.floor(gridY + 0.5)
  let weightedSum = 0
  let weightSum = 0

  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      if (Math.abs(offsetX) > kernelRadius || Math.abs(offsetY) > kernelRadius) {
        continue
      }
      const cellX = centerX + offsetX
      const cellY = centerY + offsetY
      const weight = submersionGridGaussianWeight(cellX - gridX, cellY - gridY)
      weightedSum += sampleSubmersionGridValue(grid, cellX, cellY) * weight
      weightSum += weight
    }
  }

  return weightSum > SDF_EPSILON ? weightedSum / weightSum : sampleSubmersionGridValue(grid, centerX, centerY)
}

export function shapeSubmergedAreaAtGridCenteredLocal(
  centeredLocalPos: Point,
  size: { height: number; width: number },
  grid: ShapeSubmersionGridValues,
) {
  return shapeSubmergedAreaAtGridLocal({
    x: centeredLocalPos.x + size.width * 0.5,
    y: centeredLocalPos.y + size.height * 0.5,
  }, size, grid)
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

export function estimateShapeGridSubmersions<T extends ShapeSubmersionEntry>(
  entries: T[],
  self: T,
): ShapeSubmersionGridValues {
  const grid = self.submersionGrid
  if (!grid) {
    return {
      columns: 1,
      rows: 1,
      values: [estimateCellSubmersion(entries, self, self.bounds)],
    }
  }

  return {
    columns: grid.columns,
    rows: grid.rows,
    values: grid.cells.map((cell) => estimateCellSubmersion(entries, self, cell.bounds)),
  }
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
  const clampedSubmergedArea = clamp01(submergedArea)
  const submergedAreaScale = blendSupportGating
    ? blendSupportScaleForSubmersion(clampedSubmergedArea)
    : 1

  return {
    angle: normalGate.angle,
    blendDistance: baseBlendDistance * submergedAreaScale,
    normalGate: normalGate.gate,
    submergedArea: clampedSubmergedArea,
  }
}
