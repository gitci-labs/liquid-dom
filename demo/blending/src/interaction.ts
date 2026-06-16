import {
  useRef,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import {
  CORNER_HIT_RADIUS,
  EDGE_HIT_SIZE,
  MIN_GLASS_HEIGHT,
  MIN_GLASS_WIDTH,
} from './constants'
import {
  angleDifference,
  angleFromShapeCenter,
  rotateLocalVector,
  stagePointToShapeLocal,
} from './geometry'
import type {
  InteractionState,
  ResizeEdge,
  ShapeState,
  StagePoint,
} from './types'

type StageInteractionOptions = {
  boundsVisible: boolean
  setInteractionActive: Dispatch<SetStateAction<boolean>>
  setHoverPoint: Dispatch<SetStateAction<StagePoint | null>>
  setShapes: Dispatch<SetStateAction<ShapeState[]>>
  stageRef: RefObject<HTMLElement | null>
}

export function useStageInteraction({
  boundsVisible,
  setInteractionActive,
  setHoverPoint,
  setShapes,
  stageRef,
}: StageInteractionOptions) {
  const interactionRef = useRef<InteractionState | null>(null)

  function getStagePoint(event: ReactPointerEvent<HTMLElement>): StagePoint {
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) {
      return { x: 0, y: 0 }
    }

    return {
      x: event.clientX - bounds.left - bounds.width * 0.5,
      y: event.clientY - bounds.top - bounds.height * 0.5,
    }
  }

  function updateHoverPoint(event: ReactPointerEvent<HTMLElement>) {
    if (!boundsVisible) {
      return
    }

    setHoverPoint(getStagePoint(event))
  }

  function clearHoverPoint() {
    setHoverPoint(null)
  }

  function updateShape(shapeId: ShapeState['id'], patch: Partial<ShapeState>) {
    setShapes((current) => current.map((shape) => (
      shape.id === shapeId ? { ...shape, ...patch } : shape
    )))
  }

  function startInteraction(event: ReactPointerEvent<HTMLDivElement>, shape: ShapeState) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    const point = getStagePoint(event)
    setInteractionActive(true)
    if (boundsVisible) {
      setHoverPoint(point)
    }
    if (isNearShapeCorner(point, shape)) {
      interactionRef.current = {
        mode: 'rotate',
        pointerId: event.pointerId,
        shapeId: shape.id,
        startAngle: angleFromShapeCenter(point, shape),
        startShape: shape,
      }
      return
    }

    const resizeEdge = getResizeEdge(point, shape)
    if (resizeEdge) {
      interactionRef.current = {
        mode: 'resize',
        pointerId: event.pointerId,
        shapeId: shape.id,
        edge: resizeEdge,
        startPoint: point,
        startShape: shape,
      }
      return
    }

    interactionRef.current = {
      mode: 'drag',
      pointerId: event.pointerId,
      shapeId: shape.id,
      startPoint: point,
      startShape: shape,
    }
  }

  function updateInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    const point = getStagePoint(event)
    if (boundsVisible) {
      setHoverPoint(point)
    }
    if (interaction.mode === 'drag') {
      updateShape(interaction.shapeId, {
        x: interaction.startShape.x + point.x - interaction.startPoint.x,
        y: interaction.startShape.y + point.y - interaction.startPoint.y,
      })
      return
    }

    if (interaction.mode === 'resize') {
      updateShape(interaction.shapeId, resizeShapeFromEdge(interaction, point))
      return
    }

    updateShape(interaction.shapeId, {
      rotation: interaction.startShape.rotation +
        angleDifference(angleFromShapeCenter(point, interaction.startShape), interaction.startAngle),
    })
  }

  function endInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return
    }

    interactionRef.current = null
    setInteractionActive(false)
  }

  return {
    clearHoverPoint,
    endInteraction,
    startInteraction,
    updateHoverPoint,
    updateInteraction,
  }
}

export function isNearShapeCorner(point: StagePoint, shape: ShapeState) {
  const local = stagePointToShapeLocal(point, shape)
  const halfWidth = shape.width * 0.5
  const halfHeight = shape.height * 0.5
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]

  return corners.some((corner) => Math.hypot(local.x - corner.x, local.y - corner.y) <= CORNER_HIT_RADIUS)
}

export function getResizeEdge(point: StagePoint, shape: ShapeState): ResizeEdge | null {
  const local = stagePointToShapeLocal(point, shape)
  const halfWidth = shape.width * 0.5
  const halfHeight = shape.height * 0.5
  const insideHorizontalRange = local.x >= -halfWidth - EDGE_HIT_SIZE && local.x <= halfWidth + EDGE_HIT_SIZE
  const insideVerticalRange = local.y >= -halfHeight - EDGE_HIT_SIZE && local.y <= halfHeight + EDGE_HIT_SIZE
  const distances: Array<{ edge: ResizeEdge; distance: number }> = []

  if (insideHorizontalRange) {
    distances.push({ edge: 'top', distance: Math.abs(local.y + halfHeight) })
    distances.push({ edge: 'bottom', distance: Math.abs(local.y - halfHeight) })
  }
  if (insideVerticalRange) {
    distances.push({ edge: 'left', distance: Math.abs(local.x + halfWidth) })
    distances.push({ edge: 'right', distance: Math.abs(local.x - halfWidth) })
  }

  const nearest = distances
    .filter((entry) => entry.distance <= EDGE_HIT_SIZE)
    .sort((left, right) => left.distance - right.distance)[0]
  return nearest?.edge ?? null
}

function resizeShapeFromEdge(
  interaction: Extract<InteractionState, { mode: 'resize' }>,
  point: StagePoint,
): Partial<ShapeState> {
  const startShape = interaction.startShape
  const startLocal = stagePointToShapeLocal(interaction.startPoint, startShape)
  const currentLocal = stagePointToShapeLocal(point, startShape)

  if (interaction.edge === 'left' || interaction.edge === 'right') {
    const delta = currentLocal.x - startLocal.x
    const signedDelta = interaction.edge === 'right' ? delta : -delta
    const width = Math.max(MIN_GLASS_WIDTH, startShape.width + signedDelta)
    const actualSizeDelta = width - startShape.width
    const localShiftX = (interaction.edge === 'right' ? 1 : -1) * actualSizeDelta * 0.5
    const shift = rotateLocalVector(localShiftX, 0, startShape.rotation)
    return {
      width,
      x: startShape.x + shift.x,
      y: startShape.y + shift.y,
    }
  }

  const delta = currentLocal.y - startLocal.y
  const signedDelta = interaction.edge === 'bottom' ? delta : -delta
  const height = Math.max(MIN_GLASS_HEIGHT, startShape.height + signedDelta)
  const actualSizeDelta = height - startShape.height
  const localShiftY = (interaction.edge === 'bottom' ? 1 : -1) * actualSizeDelta * 0.5
  const shift = rotateLocalVector(0, localShiftY, startShape.rotation)
  return {
    height,
    x: startShape.x + shift.x,
    y: startShape.y + shift.y,
  }
}
