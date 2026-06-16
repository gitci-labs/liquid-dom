import { useEffect, useRef } from 'react'
import { sdfUtils } from '@liquid-dom/core'
import { BLEND_SUPPORT_KERNEL_RADIUS } from './constants'
import {
  shapeBoundsFromState,
  shapeSubmersionGridFromState,
  rotateLocalVector,
  stagePointToShapeLocal,
  type ShapeBoundsEntry,
} from './geometry'
import type { StageSize } from './BlendingWebGpuCanvas'
import type { ShapeId, ShapeState, StagePoint } from './types'

type ShapeSdfSample = {
  shape: ShapeState
  distance: number
  normal: StagePoint
  submergedArea: number
}

type GaussianSubmersionInfluence = {
  bounds: sdfUtils.TransformedShapeBounds
  normalizedWeight: number
  weight: number
}

type BoundsOverlayProps = {
  blendingDistance: number
  blendSupportCellSize: number
  cornerRadius: number
  hoverPoint: StagePoint | null
  normalGateDetailsVisible: boolean
  normalGatingEnabled: boolean
  opacity: number
  shapes: ShapeState[]
  stageSize: StageSize
  blendSupportGatingEnabled: boolean
}

export function BoundsOverlay({
  blendingDistance,
  blendSupportCellSize,
  cornerRadius,
  hoverPoint,
  normalGateDetailsVisible,
  normalGatingEnabled,
  opacity,
  shapes,
  stageSize,
  blendSupportGatingEnabled,
}: BoundsOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const dpr = getDevicePixelRatio()
    const width = Math.max(1, Math.round(stageSize.width * dpr))
    const height = Math.max(1, Math.round(stageSize.height * dpr))
    if (canvas.width !== width) {
      canvas.width = width
    }
    if (canvas.height !== height) {
      canvas.height = height
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.clearRect(0, 0, width, height)
    context.save()
    context.scale(dpr, dpr)
    context.translate(stageSize.width * 0.5, stageSize.height * 0.5)

    const shapeBounds: ShapeBoundsEntry[] = shapes.map((shape) => ({
      bounds: shapeBoundsFromState(shape),
      submersionGrid: shapeSubmersionGridFromState(shape, blendSupportCellSize),
      shape,
    }))
    const submersionEntriesByShape = new Map(shapeBounds.map((entry) => [entry.shape.id, entry]))
    const submersionGridsByShape = new Map<ShapeId, sdfUtils.ShapeSubmersionGridValues>()

    for (let leftIndex = 0; leftIndex < shapeBounds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < shapeBounds.length; rightIndex += 1) {
        const { bounds } = shapeBounds[leftIndex]
        const other = shapeBounds[rightIndex]
        if (!sdfUtils.intersectBounds(bounds.aabb, other.bounds.aabb)) {
          continue
        }
        const overlap = sdfUtils.intersectConvexPolygons(bounds.polygon, other.bounds.polygon)
        if (sdfUtils.polygonArea(overlap) <= sdfUtils.SDF_EPSILON) {
          continue
        }
        drawStripedPolygon(context, overlap, {
          color: colorWithAlpha('#ffe45c', 0.58),
          spacing: 8,
          stroke: colorWithAlpha('#ffe45c', 0.72),
          width: 1,
        })
      }
    }

    for (const entry of shapeBounds) {
      const { bounds, shape, submersionGrid } = entry
      const cellSubmersions = sdfUtils.estimateShapeGridSubmersions(shapeBounds, entry)
      submersionGridsByShape.set(shape.id, cellSubmersions)
      const cellWidth = shape.width / submersionGrid.columns
      const cellHeight = shape.height / submersionGrid.rows
      const cellEntries = submersionGrid.cells.map((cell: sdfUtils.ShapeSubmersionCell, index: number) => {
        const column = index % submersionGrid.columns
        const row = Math.floor(index / submersionGrid.columns)
        return {
          bounds: cell.bounds,
          localX: (column + 0.5) * cellWidth,
          localY: (row + 0.5) * cellHeight,
          value: cellSubmersions.values[index] ?? 0,
        }
      })

      for (const cell of cellEntries) {
        drawPolygon(context, cell.bounds.polygon, {
          fill: colorWithAlpha(shapeColor(shape.id), 0.08 + cell.value * 0.22),
          stroke: colorWithAlpha(shapeColor(shape.id), 0.34),
          width: 1,
        })
      }

      drawPolygon(context, bounds.polygon, {
        stroke: colorWithAlpha(shapeColor(shape.id), 0.94),
        width: 2,
      })

      context.fillStyle = colorWithAlpha('#ffffff', 0.9)
      context.strokeStyle = colorWithAlpha('#000000', 0.5)
      context.lineWidth = 3
      context.font = '600 12px Inter, ui-sans-serif, system-ui, sans-serif'
      context.textAlign = 'left'
      context.textBaseline = 'top'
      context.save()
      context.translate(shape.x, shape.y)
      context.rotate(shape.rotation)
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      for (const cell of cellEntries) {
        const label = `${Math.round(cell.value * 100)}%`
        const labelX = cell.localX - shape.width * 0.5
        const labelY = cell.localY - shape.height * 0.5
        context.strokeText(label, labelX, labelY)
        context.fillText(label, labelX, labelY)
      }
      context.restore()
    }

    if (hoverPoint) {
      drawNormalGateVisualization(context, hoverPoint, shapes, stageSize, {
        blendingDistance,
        cornerRadius,
        enabled: normalGatingEnabled,
        normalGateDetailsVisible,
        submersionEntriesByShape,
        submersionGridsByShape,
        blendSupportGatingEnabled,
      })
    }

    context.restore()
  }, [
    blendingDistance,
    blendSupportCellSize,
    cornerRadius,
    hoverPoint,
    normalGateDetailsVisible,
    normalGatingEnabled,
    shapes,
    stageSize,
    blendSupportGatingEnabled,
  ])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="blending-bounds-overlay"
      style={{ opacity }}
    />
  )
}

function getDevicePixelRatio() {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

function drawPolygon(
  context: CanvasRenderingContext2D,
  polygon: StagePoint[],
  options: {
    fill?: string
    stroke?: string
    width?: number
  },
) {
  if (polygon.length < 3 || sdfUtils.polygonArea(polygon) <= sdfUtils.SDF_EPSILON) {
    return
  }

  context.save()
  context.beginPath()
  context.moveTo(polygon[0].x, polygon[0].y)
  for (let index = 1; index < polygon.length; index += 1) {
    context.lineTo(polygon[index].x, polygon[index].y)
  }
  context.closePath()
  if (options.fill) {
    context.fillStyle = options.fill
    context.fill()
  }
  if (options.stroke) {
    context.strokeStyle = options.stroke
    context.lineWidth = options.width ?? 1
    context.stroke()
  }
  context.restore()
}

function drawStripedPolygon(
  context: CanvasRenderingContext2D,
  polygon: StagePoint[],
  options: {
    color: string
    spacing: number
    stroke?: string
    width?: number
  },
) {
  if (polygon.length < 3 || sdfUtils.polygonArea(polygon) <= sdfUtils.SDF_EPSILON) {
    return
  }

  const bounds = sdfUtils.aabbFromPoints(polygon)
  const diagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  const stripeSpacing = Math.max(options.spacing, 1)

  context.save()
  context.beginPath()
  context.moveTo(polygon[0].x, polygon[0].y)
  for (let index = 1; index < polygon.length; index += 1) {
    context.lineTo(polygon[index].x, polygon[index].y)
  }
  context.closePath()
  context.clip()

  context.strokeStyle = options.color
  context.lineWidth = 1.25
  context.lineCap = 'round'
  context.beginPath()
  for (let x = bounds.minX - diagonal; x <= bounds.maxX + diagonal; x += stripeSpacing) {
    context.moveTo(x, bounds.minY - diagonal)
    context.lineTo(x + diagonal, bounds.maxY + diagonal)
  }
  context.stroke()
  context.restore()

  if (options.stroke) {
    drawPolygon(context, polygon, {
      stroke: options.stroke,
      width: options.width,
    })
  }
}

type NormalGateVisualizationOptions = {
  blendingDistance: number
  cornerRadius: number
  enabled: boolean
  normalGateDetailsVisible: boolean
  submersionEntriesByShape: Map<ShapeId, ShapeBoundsEntry>
  submersionGridsByShape: Map<ShapeId, sdfUtils.ShapeSubmersionGridValues>
  blendSupportGatingEnabled: boolean
}

function drawNormalGateVisualization(
  context: CanvasRenderingContext2D,
  point: StagePoint,
  shapes: ShapeState[],
  stageSize: StageSize,
  options: NormalGateVisualizationOptions,
) {
  const emptySubmersionGrid = { columns: 1, rows: 1, values: [0] }
  const samples = shapes
    .map((shape) => shapeSdfSampleAtPoint(
      shape,
      point,
      options.cornerRadius,
      options.submersionGridsByShape.get(shape.id) ?? emptySubmersionGrid,
    ))
    .sort((left, right) => left.distance - right.distance)

  if (samples.length === 0) {
    return
  }

  const primary = samples[0]
  const secondary = samples[1]
  if (!options.normalGateDetailsVisible) {
    return
  }

  drawGaussianSubmersionInfluences(context, point, samples.slice(0, 2), options)
  drawHoverMarker(context, point)
  drawNormalVector(context, point, primary.normal, colorWithAlpha(shapeColor(primary.shape.id), 0.98), secondary ? -4 : 0)

  if (!secondary) {
    return
  }

  drawNormalVector(context, point, secondary.normal, colorWithAlpha(shapeColor(secondary.shape.id), 0.98), 4)
  const gateInfo = normalGateForSamples(primary, secondary, options)
  drawNormalGateReadout(context, point, stageSize, gateInfo, options)
}

function shapeSdfSampleAtPoint(
  shape: ShapeState,
  point: StagePoint,
  cornerRadius: number,
  submersionGrid: sdfUtils.ShapeSubmersionGridValues,
): ShapeSdfSample {
  const local = stagePointToShapeLocal(point, shape)
  const halfWidth = shape.width * 0.5
  const halfHeight = shape.height * 0.5
  const radius = Math.min(Math.max(cornerRadius, 0), halfWidth, halfHeight)
  const q = {
    x: Math.abs(local.x) - halfWidth + radius,
    y: Math.abs(local.y) - halfHeight + radius,
  }
  const outside = {
    x: Math.max(q.x, 0),
    y: Math.max(q.y, 0),
  }
  const distance = Math.hypot(outside.x, outside.y) + Math.min(Math.max(q.x, q.y), 0) - radius
  const localNormal = roundedRectLocalNormal(local, q, outside)

  return {
    distance,
    normal: normalizeVector(rotateLocalVector(localNormal.x, localNormal.y, shape.rotation)),
    shape,
    submergedArea: sdfUtils.shapeSubmergedAreaAtGridCenteredLocal(
      local,
      shape,
      submersionGrid,
    ),
  }
}

function drawGaussianSubmersionInfluences(
  context: CanvasRenderingContext2D,
  point: StagePoint,
  samples: ShapeSdfSample[],
  options: NormalGateVisualizationOptions,
) {
  for (const sample of samples) {
    const entry = options.submersionEntriesByShape.get(sample.shape.id)
    const gridValues = options.submersionGridsByShape.get(sample.shape.id)
    if (!entry || !gridValues) {
      continue
    }

    const influences = gaussianSubmersionInfluencesAtPoint(sample.shape, point, entry, gridValues)
    drawGaussianSubmersionInfluenceCells(context, sample.shape, influences)
  }
}

function gaussianSubmersionInfluencesAtPoint(
  shape: ShapeState,
  point: StagePoint,
  entry: ShapeBoundsEntry,
  gridValues: sdfUtils.ShapeSubmersionGridValues,
): GaussianSubmersionInfluence[] {
  const local = stagePointToShapeLocal(point, shape)
  const localX = local.x + shape.width * 0.5
  const localY = local.y + shape.height * 0.5
  const columns = Math.max(Math.round(gridValues.columns), 1)
  const rows = Math.max(Math.round(gridValues.rows), 1)
  const uvX = sdfUtils.clamp01(localX / Math.max(shape.width, sdfUtils.SDF_EPSILON))
  const uvY = sdfUtils.clamp01(localY / Math.max(shape.height, sdfUtils.SDF_EPSILON))
  const gridX = uvX * columns - 0.5
  const gridY = uvY * rows - 0.5
  const centerX = Math.floor(gridX + 0.5)
  const centerY = Math.floor(gridY + 0.5)
  const influencesByCell = new Map<number, GaussianSubmersionInfluence>()
  let weightSum = 0

  for (let offsetY = -BLEND_SUPPORT_KERNEL_RADIUS; offsetY <= BLEND_SUPPORT_KERNEL_RADIUS; offsetY += 1) {
    for (let offsetX = -BLEND_SUPPORT_KERNEL_RADIUS; offsetX <= BLEND_SUPPORT_KERNEL_RADIUS; offsetX += 1) {
      const cellX = centerX + offsetX
      const cellY = centerY + offsetY
      const clampedX = Math.min(Math.max(cellX, 0), columns - 1)
      const clampedY = Math.min(Math.max(cellY, 0), rows - 1)
      const cellIndex = clampedY * columns + clampedX
      const weight = gaussianSubmersionWeight(cellX - gridX, cellY - gridY)
      const existing = influencesByCell.get(cellIndex)

      weightSum += weight
      if (existing) {
        existing.weight += weight
      } else {
        const cell = entry.submersionGrid.cells[cellIndex]
        if (cell) {
          influencesByCell.set(cellIndex, {
            bounds: cell.bounds,
            normalizedWeight: 0,
            weight,
          })
        }
      }
    }
  }

  return Array.from(influencesByCell.values())
    .map((influence) => ({
      ...influence,
      normalizedWeight: weightSum > sdfUtils.SDF_EPSILON ? influence.weight / weightSum : 0,
    }))
    .sort((left, right) => left.normalizedWeight - right.normalizedWeight)
}

function gaussianSubmersionWeight(offsetX: number, offsetY: number) {
  return Math.exp(-0.5 * (offsetX * offsetX + offsetY * offsetY)) *
    gaussianSubmersionCutoffWeight(offsetX) *
    gaussianSubmersionCutoffWeight(offsetY)
}

function gaussianSubmersionCutoffWeight(offset: number) {
  const radius = BLEND_SUPPORT_KERNEL_RADIUS + 0.5
  const t = sdfUtils.clamp01((radius - Math.abs(offset)) * 2)
  return t * t * (3 - 2 * t)
}

function drawGaussianSubmersionInfluenceCells(
  context: CanvasRenderingContext2D,
  shape: ShapeState,
  influences: GaussianSubmersionInfluence[],
) {
  const color = shapeColor(shape.id)

  context.save()
  context.globalCompositeOperation = 'destination-over'
  for (const influence of influences) {
    const alpha = Math.min(0.78, 0.05 + influence.normalizedWeight * 3.6)
    const strokeAlpha = Math.min(0.92, 0.24 + influence.normalizedWeight * 3)
    drawPolygon(context, influence.bounds.polygon, {
      fill: colorWithAlpha(color, alpha),
      stroke: colorWithAlpha('#ffffff', strokeAlpha),
      width: 1.5,
    })
  }
  context.restore()
}

function roundedRectLocalNormal(
  local: StagePoint,
  q: StagePoint,
  outside: StagePoint,
): StagePoint {
  const signX = local.x < 0 ? -1 : 1
  const signY = local.y < 0 ? -1 : 1

  if (outside.x > sdfUtils.SDF_EPSILON || outside.y > sdfUtils.SDF_EPSILON) {
    return normalizeVector({
      x: outside.x * signX,
      y: outside.y * signY,
    })
  }

  if (q.x > q.y) {
    return { x: signX, y: 0 }
  }
  if (q.y > q.x) {
    return { x: 0, y: signY }
  }

  return normalizeVector({ x: signX, y: signY })
}

function normalizeVector(vector: StagePoint): StagePoint {
  const length = Math.hypot(vector.x, vector.y)
  if (length <= sdfUtils.SDF_EPSILON) {
    return { x: 0, y: -1 }
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  }
}

function normalGateForSamples(
  left: ShapeSdfSample,
  right: ShapeSdfSample,
  options: NormalGateVisualizationOptions,
) {
  const normalGate = sdfUtils.normalGateForNormals(
    left.normal,
    right.normal,
    {
      enabled: options.enabled,
    },
  )
  const baseBlendDistance = options.blendingDistance * normalGate.gate
  const baseH = sdfUtils.smoothUnionWeight(left.distance, right.distance, baseBlendDistance)
  const submergedArea = sdfUtils.lerp(right.submergedArea, left.submergedArea, baseH)
  const clampedSubmergedArea = sdfUtils.clamp01(submergedArea)
  const submergedAreaScale = options.blendSupportGatingEnabled
    ? sdfUtils.blendSupportScaleForSubmersion(clampedSubmergedArea)
    : 1

  return {
    angle: normalGate.angle,
    blendDistance: baseBlendDistance * submergedAreaScale,
    normalGate: normalGate.gate,
    submergedArea: clampedSubmergedArea,
    supportScale: submergedAreaScale,
  }
}

function drawHoverMarker(context: CanvasRenderingContext2D, point: StagePoint) {
  context.save()
  context.fillStyle = 'rgba(0, 0, 0, 0.45)'
  context.strokeStyle = 'rgba(255, 255, 255, 0.95)'
  context.lineWidth = 1.5
  context.beginPath()
  context.arc(point.x, point.y, 4, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  context.restore()
}

function drawNormalVector(
  context: CanvasRenderingContext2D,
  point: StagePoint,
  normal: StagePoint,
  color: string,
  offset: number,
) {
  const perpendicular = { x: -normal.y, y: normal.x }
  const start = {
    x: point.x + perpendicular.x * offset,
    y: point.y + perpendicular.y * offset,
  }
  const end = {
    x: start.x + normal.x * 52,
    y: start.y + normal.y * 52,
  }

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = 'rgba(0, 0, 0, 0.42)'
  context.lineWidth = 5
  traceArrow(context, start, end, normal)
  context.strokeStyle = color
  context.lineWidth = 2.25
  traceArrow(context, start, end, normal)
  context.restore()
}

function traceArrow(
  context: CanvasRenderingContext2D,
  start: StagePoint,
  end: StagePoint,
  normal: StagePoint,
) {
  const arrowSize = 7
  const angle = Math.atan2(normal.y, normal.x)
  const left = angle + Math.PI * 0.82
  const right = angle - Math.PI * 0.82

  context.beginPath()
  context.moveTo(start.x, start.y)
  context.lineTo(end.x, end.y)
  context.moveTo(end.x, end.y)
  context.lineTo(end.x + Math.cos(left) * arrowSize, end.y + Math.sin(left) * arrowSize)
  context.moveTo(end.x, end.y)
  context.lineTo(end.x + Math.cos(right) * arrowSize, end.y + Math.sin(right) * arrowSize)
  context.stroke()
}

function drawNormalGateReadout(
  context: CanvasRenderingContext2D,
  point: StagePoint,
  stageSize: StageSize,
  gateInfo: {
    angle: number
    blendDistance: number
    normalGate: number
    submergedArea: number
    supportScale: number
  },
  options: NormalGateVisualizationOptions,
) {
  const padding = 9
  const width = 166
  const lineHeight = 15
  const barWidth = width - padding * 2
  const barHeight = 5
  const lines = [
    `angle ${Math.round((gateInfo.angle / Math.PI) * 180)} deg`,
    `normal gate ${Math.round(gateInfo.normalGate * 100)}%`,
    options.blendSupportGatingEnabled
      ? `support ${Math.round(gateInfo.supportScale * 100)}%`
      : 'support off',
    `blend ${gateInfo.blendDistance.toFixed(0)} px`,
  ]
  const height = padding * 2 + lineHeight * lines.length + barHeight + 8
  const halfWidth = stageSize.width * 0.5
  const halfHeight = stageSize.height * 0.5
  let x = point.x + 16
  let y = point.y + 16

  if (x + width > halfWidth - 8) {
    x = point.x - width - 16
  }
  if (y + height > halfHeight - 8) {
    y = point.y - height - 16
  }
  x = Math.min(Math.max(x, -halfWidth + 8), halfWidth - width - 8)
  y = Math.min(Math.max(y, -halfHeight + 8), halfHeight - height - 8)

  context.save()
  context.fillStyle = 'rgba(0, 0, 0, 0.68)'
  context.fillRect(x, y, width, height)
  context.fillStyle = 'rgba(255, 255, 255, 0.94)'
  context.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif'
  context.textAlign = 'left'
  context.textBaseline = 'top'

  lines.forEach((line, index) => {
    context.fillText(line, x + padding, y + padding + index * lineHeight)
  })

  const barX = x + padding
  const barY = y + padding + lineHeight * lines.length + 3
  context.fillStyle = 'rgba(255, 255, 255, 0.22)'
  context.fillRect(barX, barY, barWidth, barHeight)
  context.fillStyle = 'rgba(255, 255, 255, 0.9)'
  context.fillRect(barX, barY, barWidth * gateInfo.normalGate, barHeight)
  context.restore()
}

function shapeColor(shapeId: ShapeId) {
  return shapeId === 'left' ? '#75d9ff' : '#ff8cc8'
}

function colorWithAlpha(hexColor: string, alpha: number) {
  const red = Number.parseInt(hexColor.slice(1, 3), 16)
  const green = Number.parseInt(hexColor.slice(3, 5), 16)
  const blue = Number.parseInt(hexColor.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
