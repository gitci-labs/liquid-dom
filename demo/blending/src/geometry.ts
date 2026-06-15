import { sdfUtils } from '@liquid-dom/core'
import {
  MAX_BLEND_SUPPORT_GRID_CELLS,
  MIN_BLEND_SUPPORT_GRID_CELLS,
} from './constants'
import type { ShapeState, StagePoint } from './types'

export type ShapeBoundsEntry = sdfUtils.ShapeSubmersionEntry & {
  shape: ShapeState
  submersionGrid: sdfUtils.ShapeSubmersionGrid
}

export function shapeLocalPointToStagePoint(shape: ShapeState, localX: number, localY: number): StagePoint {
  const centeredX = localX - shape.width * 0.5
  const centeredY = localY - shape.height * 0.5
  const rotated = rotateLocalVector(centeredX, centeredY, shape.rotation)
  return {
    x: shape.x + rotated.x,
    y: shape.y + rotated.y,
  }
}

export function shapeBoundsFromState(shape: ShapeState): sdfUtils.TransformedShapeBounds {
  const polygon = [
    shapeLocalPointToStagePoint(shape, 0, 0),
    shapeLocalPointToStagePoint(shape, shape.width, 0),
    shapeLocalPointToStagePoint(shape, shape.width, shape.height),
    shapeLocalPointToStagePoint(shape, 0, shape.height),
  ]
  return {
    aabb: sdfUtils.aabbFromPoints(polygon),
    area: sdfUtils.polygonArea(polygon),
    polygon,
  }
}

function blendSupportGridAxisCellCount(length: number, cellSize: number) {
  return Math.min(
    Math.max(Math.ceil(length / Math.max(cellSize, 1)), MIN_BLEND_SUPPORT_GRID_CELLS),
    MAX_BLEND_SUPPORT_GRID_CELLS,
  )
}

export function shapeSubmersionGridFromState(shape: ShapeState, cellSize: number): sdfUtils.ShapeSubmersionGrid {
  const columns = blendSupportGridAxisCellCount(shape.width, cellSize)
  const rows = blendSupportGridAxisCellCount(shape.height, cellSize)
  const cellWidth = shape.width / columns
  const cellHeight = shape.height / rows
  const cells: sdfUtils.ShapeSubmersionCell[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const minX = column * cellWidth
      const minY = row * cellHeight
      const polygon = [
        shapeLocalPointToStagePoint(shape, minX, minY),
        shapeLocalPointToStagePoint(shape, minX + cellWidth, minY),
        shapeLocalPointToStagePoint(shape, minX + cellWidth, minY + cellHeight),
        shapeLocalPointToStagePoint(shape, minX, minY + cellHeight),
      ]
      cells.push({
        bounds: {
          aabb: sdfUtils.aabbFromPoints(polygon),
          area: sdfUtils.polygonArea(polygon),
          polygon,
        },
      })
    }
  }

  return {
    cells,
    columns,
    rows,
  }
}

export function rotateLocalVector(x: number, y: number, rotation: number): StagePoint {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  }
}

export function stagePointToShapeLocal(point: StagePoint, shape: ShapeState): StagePoint {
  const offsetX = point.x - shape.x
  const offsetY = point.y - shape.y
  const cos = Math.cos(-shape.rotation)
  const sin = Math.sin(-shape.rotation)

  return {
    x: offsetX * cos - offsetY * sin,
    y: offsetX * sin + offsetY * cos,
  }
}

export function angleFromShapeCenter(point: StagePoint, shape: ShapeState) {
  return Math.atan2(point.y - shape.y, point.x - shape.x)
}

export function angleDifference(next: number, previous: number) {
  let delta = next - previous
  while (delta > Math.PI) {
    delta -= Math.PI * 2
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2
  }
  return delta
}
