import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Leva, useControls } from 'leva'
import { createPlugin, useInputContext } from 'leva/plugin'
import {
  DEFAULT_SMOOTH_UNION,
  resolveNormalGating,
  sdfUtils,
} from '@liquid-dom/core'
import {
  Frame,
  Glass,
  GlassContainer,
  LiquidScene,
  Transform,
  ZStack,
  type LiquidSceneRef,
} from '@liquid-dom/react'
import { BlendingWebGpuCanvas, type StageSize } from './BlendingWebGpuCanvas'

const GLASS_WIDTH = 220
const GLASS_HEIGHT = 132
const GLASS_CORNER_RADIUS = 60
const MIN_GLASS_CORNER_RADIUS = 0
const MAX_GLASS_CORNER_RADIUS = 120
const GLASS_ORIGIN = { x: 0.5, y: 0.5 }
const CONTAINER_SPACING = 160
const MIN_CONTAINER_SPACING = 0
const MAX_CONTAINER_SPACING = 160
const BLEND_SUPPORT_GATING_ENABLED = true
const MIN_SMOOTH_UNION_PARAMETER = 0
const MAX_SMOOTH_UNION_PARAMETER = 1
const SMOOTH_UNION_PARAMETER_STEP = 0.01
const NORMAL_GATING_HERMITE_KNEE = 0.7
const NORMAL_GATING_HERMITE_CAP = 0.84
const MIN_NORMAL_GATING_HERMITE_PARAMETER = 0
const MAX_NORMAL_GATING_HERMITE_PARAMETER = 1
const NORMAL_GATING_HERMITE_PARAMETER_STEP = 0.01
const SAMPLE_VISUALIZATION_OPACITY = 0.5
const CORNER_HIT_RADIUS = 20
const EDGE_HIT_SIZE = 16
const MIN_GLASS_WIDTH = 88
const MIN_GLASS_HEIGHT = 64
const INITIAL_DISTANCE = 34
const PLOT_WIDTH = 800
const PLOT_HEIGHT = 240
const PLOT_MARGIN = { top: 18, right: 18, bottom: 18, left: 18 }
const PLOT_STEPS = 96
const DEBUG_OVERLAY_STORAGE_KEY = 'liquid-glass-blending-debug-overlay-visible'

type ShapeId = 'left' | 'right'
type ResizeEdge = 'left' | 'right' | 'top' | 'bottom'

type ShapeState = {
  id: ShapeId
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

type StagePoint = {
  x: number
  y: number
}

type BlendingControls = {
  blendingDistance: number
  boundsVisible: boolean
  cornerRadius: number
  normalGatingEnabled: boolean
  normalGatingHermiteCap: number
  normalGatingHermiteKnee: number
  blendSupportGatingEnabled: boolean
  smoothUnionAcceleration: number
}

type GatingPlotValue = {
  hermiteCap: number
  hermiteKnee: number
}

type BlendingPanelValues = BlendingControls & {
  normalGatePlot: GatingPlotValue
}

type ShapeSdfSample = {
  shape: ShapeState
  distance: number
  normal: StagePoint
  submergedArea: number
}

type InteractionState =
  | {
      mode: 'drag'
      pointerId: number
      shapeId: ShapeId
      startPoint: StagePoint
      startShape: ShapeState
    }
  | {
      mode: 'rotate'
      pointerId: number
      shapeId: ShapeId
      startAngle: number
      startShape: ShapeState
    }
  | {
      mode: 'resize'
      pointerId: number
      shapeId: ShapeId
      edge: ResizeEdge
      startPoint: StagePoint
      startShape: ShapeState
    }

const INITIAL_SHAPES: ShapeState[] = [
  {
    id: 'left',
    x: -(GLASS_WIDTH + INITIAL_DISTANCE) / 2,
    y: 0,
    width: GLASS_WIDTH,
    height: GLASS_HEIGHT,
    rotation: 0,
  },
  {
    id: 'right',
    x: (GLASS_WIDTH + INITIAL_DISTANCE) / 2,
    y: 0,
    width: GLASS_WIDTH,
    height: GLASS_HEIGHT,
    rotation: 0,
  },
]

const normalGatePlotControl = createPlugin<
  { value: GatingPlotValue },
  GatingPlotValue,
  Record<string, never>
>({
  normalize: (input) => ({ value: input.value }),
  component: GatingPlotControl,
})

function getInitialDebugOverlayVisible() {
  try {
    const storedValue = window.localStorage.getItem(DEBUG_OVERLAY_STORAGE_KEY)
    if (storedValue === 'true') {
      return true
    }
    if (storedValue === 'false') {
      return false
    }
  } catch {
    return true
  }

  return true
}

function storeDebugOverlayVisible(visible: boolean) {
  try {
    window.localStorage.setItem(DEBUG_OVERLAY_STORAGE_KEY, String(visible))
  } catch {
    // Ignore storage failures; the control should still work for the session.
  }
}

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<LiquidSceneRef | null>(null)
  const requestRenderRef = useRef<() => void>(() => undefined)
  const interactionRef = useRef<InteractionState | null>(null)
  const [shapes, setShapes] = useState(INITIAL_SHAPES)
  const [{
    blendingDistance,
    boundsVisible,
    cornerRadius,
    normalGatingEnabled,
    normalGatingHermiteCap,
    normalGatingHermiteKnee,
    blendSupportGatingEnabled,
    smoothUnionAcceleration,
  }, setControls] = useControls(() => ({
    blendingDistance: {
      value: CONTAINER_SPACING,
      min: MIN_CONTAINER_SPACING,
      max: MAX_CONTAINER_SPACING,
      step: 1,
      label: 'Glass blend distance',
    },
    cornerRadius: {
      value: GLASS_CORNER_RADIUS,
      min: MIN_GLASS_CORNER_RADIUS,
      max: MAX_GLASS_CORNER_RADIUS,
      step: 1,
      label: 'Glass corner radius',
    },
    normalGatingEnabled: {
      value: true,
      label: 'Enable normal gating',
    },
    normalGatingHermiteKnee: {
      value: NORMAL_GATING_HERMITE_KNEE,
      min: MIN_NORMAL_GATING_HERMITE_PARAMETER,
      max: MAX_NORMAL_GATING_HERMITE_PARAMETER,
      step: NORMAL_GATING_HERMITE_PARAMETER_STEP,
      label: 'Hermite cap knee',
    },
    normalGatingHermiteCap: {
      value: NORMAL_GATING_HERMITE_CAP,
      min: MIN_NORMAL_GATING_HERMITE_PARAMETER,
      max: MAX_NORMAL_GATING_HERMITE_PARAMETER,
      step: NORMAL_GATING_HERMITE_PARAMETER_STEP,
      label: 'Hermite cap value',
    },
    normalGatePlot: normalGatePlotControl({
      value: {
        hermiteCap: NORMAL_GATING_HERMITE_CAP,
        hermiteKnee: NORMAL_GATING_HERMITE_KNEE,
      },
      label: 'Normal gating graph',
    }),
    blendSupportGatingEnabled: {
      value: BLEND_SUPPORT_GATING_ENABLED,
      label: 'Enable blend support gating',
    },
    smoothUnionAcceleration: {
      value: DEFAULT_SMOOTH_UNION.acceleration,
      min: MIN_SMOOTH_UNION_PARAMETER,
      max: MAX_SMOOTH_UNION_PARAMETER,
      step: SMOOTH_UNION_PARAMETER_STEP,
      label: 'Smooth min acceleration',
    },
    boundsVisible: {
      value: getInitialDebugOverlayVisible(),
      label: 'Show debug overlay',
    },
  }), []) as unknown as [BlendingPanelValues, (values: Partial<BlendingPanelValues>) => void]
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 })
  const [hoverPoint, setHoverPoint] = useState<StagePoint | null>(null)
  const requestSceneRender = useCallback(() => {
    requestRenderRef.current()
  }, [])

  useEffect(() => {
    const element = stageRef.current
    if (!element) {
      return
    }

    const updateStageSize = () => {
      const bounds = element.getBoundingClientRect()
      setStageSize({ width: bounds.width, height: bounds.height })
    }

    updateStageSize()
    const resizeObserver = new ResizeObserver(updateStageSize)
    resizeObserver.observe(element)

    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    storeDebugOverlayVisible(boundsVisible)

    if (!boundsVisible) {
      setHoverPoint(null)
    }
  }, [boundsVisible])

  useEffect(() => {
    setControls({
      normalGatePlot: {
        hermiteCap: normalGatingHermiteCap,
        hermiteKnee: normalGatingHermiteKnee,
      },
    })
  }, [normalGatingHermiteCap, normalGatingHermiteKnee, setControls])

  useEffect(() => {
    requestSceneRender()
  }, [
    blendSupportGatingEnabled,
    blendingDistance,
    cornerRadius,
    normalGatingEnabled,
    normalGatingHermiteCap,
    normalGatingHermiteKnee,
    requestSceneRender,
    shapes,
    smoothUnionAcceleration,
  ])

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

  function updateShape(shapeId: ShapeId, patch: Partial<ShapeState>) {
    setShapes((current) => current.map((shape) => (
      shape.id === shapeId ? { ...shape, ...patch } : shape
    )))
  }

  function startInteraction(event: ReactPointerEvent<HTMLDivElement>, shape: ShapeState) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    const point = getStagePoint(event)
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
  }

  return (
    <main className="blending-app">
      <Leva
        collapsed={false}
        oneLineLabels
        theme={{ sizes: { controlWidth: '190px', rootWidth: '360px' } }}
      />
      <div className="blending-demo">
        <section
          ref={stageRef}
          className={`blending-stage ${boundsVisible ? 'visualizing' : ''}`}
          onPointerMove={updateHoverPoint}
          onPointerLeave={clearHoverPoint}
        >
          <BlendingWebGpuCanvas
            requestRenderRef={requestRenderRef}
            sceneRef={sceneRef}
            stageSize={stageSize}
          />
          <LiquidScene
            ref={sceneRef}
            onInvalidateFrame={requestSceneRender}
            onInvalidateLayout={requestSceneRender}
          >
            <ZStack alignment="center">
              <Frame maxWidth={Infinity} maxHeight={Infinity}>
                <GlassContainer
                  blur={7}
                  spacing={blendingDistance}
                  normalGating={{
                    enabled: normalGatingEnabled,
                    hermiteCap: normalGatingHermiteCap,
                    hermiteKnee: normalGatingHermiteKnee,
                  }}
                  blendSupportGating={blendSupportGatingEnabled}
                  smoothUnion={{
                    acceleration: smoothUnionAcceleration,
                  }}
                  bezelWidth={18}
                  displacementBlur={8}
                  thickness={86}
                  contentDepth={18}
                  tint={{ r: 0.73, g: 0.73, b: 0.73, a: 0.45 }}
                  shadowColor={{ r: 0, g: 0, b: 0, a: 0.2 }}
                  shadowOffsetX={0}
                  shadowOffsetY={4}
                  shadowBlur={34}
                  specularOpacity={0.7}
                >
                  <ZStack alignment="center">
                    {shapes.map((shape) => (
                      <Transform
                        key={shape.id}
                        x={shape.x}
                        y={shape.y}
                        rotation={shape.rotation}
                        origin={GLASS_ORIGIN}
                      >
                        <Glass cornerRadius={cornerRadius}>
                          <Frame width={shape.width} height={shape.height} />
                        </Glass>
                      </Transform>
                    ))}
                  </ZStack>
                </GlassContainer>
              </Frame>
            </ZStack>
          </LiquidScene>
          {boundsVisible && stageSize.width > 0 && stageSize.height > 0 && (
            <BoundsOverlay
              blendingDistance={blendingDistance}
              cornerRadius={cornerRadius}
              hermiteCap={normalGatingHermiteCap}
              hermiteKnee={normalGatingHermiteKnee}
              hoverPoint={hoverPoint}
              normalGatingEnabled={normalGatingEnabled}
              opacity={SAMPLE_VISUALIZATION_OPACITY}
              shapes={shapes}
              stageSize={stageSize}
              blendSupportGatingEnabled={blendSupportGatingEnabled}
            />
          )}

          <div className="blending-interaction-layer" aria-hidden="true">
            {shapes.map((shape) => (
              <div
                key={shape.id}
                className="blending-shape-hitbox"
                style={{
                  width: shape.width + CORNER_HIT_RADIUS * 2,
                  height: shape.height + CORNER_HIT_RADIUS * 2,
                  transform: `translate(-50%, -50%) translate(${shape.x}px, ${shape.y}px) rotate(${shape.rotation}rad)`,
                }}
                onPointerDown={(event) => startInteraction(event, shape)}
                onPointerMove={updateInteraction}
                onPointerUp={endInteraction}
                onPointerCancel={endInteraction}
              >
                <span className="blending-edge-hit top" />
                <span className="blending-edge-hit right" />
                <span className="blending-edge-hit bottom" />
                <span className="blending-edge-hit left" />
                <span className="blending-corner-hit top-left" />
                <span className="blending-corner-hit top-right" />
                <span className="blending-corner-hit bottom-right" />
                <span className="blending-corner-hit bottom-left" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function GatingPlotControl() {
  const { value } = useInputContext<{ value: GatingPlotValue }>()

  return (
    <div className="leva-gating-plot-control">
      <GatingPlot
        hermiteCap={value.hermiteCap}
        hermiteKnee={value.hermiteKnee}
      />
    </div>
  )
}

type GatingPlotProps = {
  hermiteCap: number
  hermiteKnee: number
}

type BoundsOverlayProps = {
  blendingDistance: number
  cornerRadius: number
  hermiteCap: number
  hermiteKnee: number
  hoverPoint: StagePoint | null
  normalGatingEnabled: boolean
  opacity: number
  shapes: ShapeState[]
  stageSize: StageSize
  blendSupportGatingEnabled: boolean
}

function BoundsOverlay({
  blendingDistance,
  cornerRadius,
  hermiteCap,
  hermiteKnee,
  hoverPoint,
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
      cellBounds: shapeCellBoundsFromState(shape),
      shape,
    }))
    const submergedAreasByShape = new Map<ShapeId, sdfUtils.ShapeSubmergedAreas>()

    for (const { bounds } of shapeBounds) {
      for (const other of shapeBounds) {
        if (other.bounds === bounds) {
          continue
        }
        if (!sdfUtils.intersectBounds(bounds.aabb, other.bounds.aabb)) {
          continue
        }
        const overlap = sdfUtils.intersectConvexPolygons(bounds.polygon, other.bounds.polygon)
        if (sdfUtils.polygonArea(overlap) <= sdfUtils.SDF_EPSILON) {
          continue
        }
        drawPolygon(context, overlap, {
          fill: colorWithAlpha('#ffe45c', 0.28),
          stroke: colorWithAlpha('#ffe45c', 0.72),
          width: 1,
        })
      }
    }

    for (const entry of shapeBounds) {
      const { bounds, cellBounds, shape } = entry
      const cellSubmersions = sdfUtils.estimateShapeCellSubmersions(shapeBounds, entry)
      submergedAreasByShape.set(shape.id, cellSubmersions)
      const cellEntries = [
        { bounds: cellBounds.topLeft, localX: shape.width * 0.25, localY: shape.height * 0.25, value: cellSubmersions.topLeft },
        { bounds: cellBounds.topRight, localX: shape.width * 0.75, localY: shape.height * 0.25, value: cellSubmersions.topRight },
        { bounds: cellBounds.bottomLeft, localX: shape.width * 0.25, localY: shape.height * 0.75, value: cellSubmersions.bottomLeft },
        { bounds: cellBounds.bottomRight, localX: shape.width * 0.75, localY: shape.height * 0.75, value: cellSubmersions.bottomRight },
      ]

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
        hermiteCap,
        hermiteKnee,
        submergedAreasByShape,
        blendSupportGatingEnabled,
      })
    }

    context.restore()
  }, [
    blendingDistance,
    cornerRadius,
    hermiteCap,
    hermiteKnee,
    hoverPoint,
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

function GatingPlot({
  hermiteCap,
  hermiteKnee,
}: GatingPlotProps) {
  const path = createGatingPath((angle) => sdfUtils.hermiteCapGate(angle / Math.PI, hermiteKnee, hermiteCap))
  const xTicks = [0, 45, 90, 135, 180]
  const yTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <section className="blending-plot" aria-label="Normal gating function plot">
      <svg className="blending-plot-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img">
        <title>Normal gating functions</title>
        <desc>Plot of gating value against the angle between SDF normals.</desc>
        <g className="blending-plot-grid">
          {yTicks.map((tick) => (
            <line
              key={`y-${tick}`}
              x1={PLOT_MARGIN.left}
              x2={PLOT_WIDTH - PLOT_MARGIN.right}
              y1={plotY(tick)}
              y2={plotY(tick)}
            />
          ))}
          {xTicks.map((tick) => (
            <line
              key={`x-${tick}`}
              x1={plotX((tick / 180) * Math.PI)}
              x2={plotX((tick / 180) * Math.PI)}
              y1={PLOT_MARGIN.top}
              y2={PLOT_HEIGHT - PLOT_MARGIN.bottom}
            />
          ))}
        </g>
        <path className="blending-plot-axis" d={`M${PLOT_MARGIN.left} ${PLOT_MARGIN.top}V${PLOT_HEIGHT - PLOT_MARGIN.bottom}H${PLOT_WIDTH - PLOT_MARGIN.right}`} />
        <path className="blending-plot-line hermite-cap" d={path} />
      </svg>
    </section>
  )
}

function createGatingPath(resolveGate: (angle: number) => number) {
  return Array.from({ length: PLOT_STEPS + 1 }, (_, index) => {
    const angle = (index / PLOT_STEPS) * Math.PI
    const command = index === 0 ? 'M' : 'L'
    return `${command}${plotX(angle).toFixed(2)} ${plotY(resolveGate(angle)).toFixed(2)}`
  }).join(' ')
}

function plotX(angle: number) {
  const width = PLOT_WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right
  return PLOT_MARGIN.left + (angle / Math.PI) * width
}

function plotY(gate: number) {
  const height = PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom
  return PLOT_MARGIN.top + (1 - sdfUtils.clamp01(gate)) * height
}

function shapeLocalPointToStagePoint(shape: ShapeState, localX: number, localY: number): StagePoint {
  const centeredX = localX - shape.width * 0.5
  const centeredY = localY - shape.height * 0.5
  const rotated = rotateLocalVector(centeredX, centeredY, shape.rotation)
  return {
    x: shape.x + rotated.x,
    y: shape.y + rotated.y,
  }
}

function getDevicePixelRatio() {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

type ShapeBoundsEntry = sdfUtils.ShapeSubmersionEntry & {
  shape: ShapeState
}

type ShapeCellBounds = {
  bottomLeft: sdfUtils.TransformedShapeBounds
  bottomRight: sdfUtils.TransformedShapeBounds
  topLeft: sdfUtils.TransformedShapeBounds
  topRight: sdfUtils.TransformedShapeBounds
}

function shapeBoundsFromState(shape: ShapeState): sdfUtils.TransformedShapeBounds {
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

function shapeCellBoundsFromState(shape: ShapeState): ShapeCellBounds {
  const halfWidth = shape.width * 0.5
  const halfHeight = shape.height * 0.5
  const cellBounds = (minX: number, minY: number, maxX: number, maxY: number) => {
    const polygon = [
      shapeLocalPointToStagePoint(shape, minX, minY),
      shapeLocalPointToStagePoint(shape, maxX, minY),
      shapeLocalPointToStagePoint(shape, maxX, maxY),
      shapeLocalPointToStagePoint(shape, minX, maxY),
    ]

    return {
      aabb: sdfUtils.aabbFromPoints(polygon),
      area: sdfUtils.polygonArea(polygon),
      polygon,
    }
  }

  return {
    topLeft: cellBounds(0, 0, halfWidth, halfHeight),
    topRight: cellBounds(halfWidth, 0, shape.width, halfHeight),
    bottomLeft: cellBounds(0, halfHeight, halfWidth, shape.height),
    bottomRight: cellBounds(halfWidth, halfHeight, shape.width, shape.height),
  }
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

type NormalGateVisualizationOptions = {
  blendingDistance: number
  cornerRadius: number
  enabled: boolean
  hermiteCap: number
  hermiteKnee: number
  submergedAreasByShape: Map<ShapeId, sdfUtils.ShapeSubmergedAreas>
  blendSupportGatingEnabled: boolean
}

function drawNormalGateVisualization(
  context: CanvasRenderingContext2D,
  point: StagePoint,
  shapes: ShapeState[],
  stageSize: StageSize,
  options: NormalGateVisualizationOptions,
) {
  const emptySubmergedAreas = sdfUtils.createEmptySubmergedAreas()
  const samples = shapes
    .map((shape) => shapeSdfSampleAtPoint(
      shape,
      point,
      options.cornerRadius,
      options.submergedAreasByShape.get(shape.id) ?? emptySubmergedAreas,
    ))
    .sort((left, right) => left.distance - right.distance)

  if (samples.length === 0) {
    return
  }

  drawHoverMarker(context, point)

  const primary = samples[0]
  const secondary = samples[1]
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
  submergedAreas: sdfUtils.ShapeSubmergedAreas,
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
    submergedArea: sdfUtils.shapeSubmergedAreaAtCenteredLocal(local, shape, submergedAreas),
  }
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
  return sdfUtils.smoothUnionGatingInfo(
    left,
    right,
    options.blendingDistance,
    resolveNormalGating({
      enabled: options.enabled,
      hermiteCap: options.hermiteCap,
      hermiteKnee: options.hermiteKnee,
    }),
    options.blendSupportGatingEnabled,
  )
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
      ? `support ${Math.round((1 - gateInfo.submergedArea) * 100)}%`
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

function isNearShapeCorner(point: StagePoint, shape: ShapeState) {
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

function getResizeEdge(point: StagePoint, shape: ShapeState): ResizeEdge | null {
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

function rotateLocalVector(x: number, y: number, rotation: number): StagePoint {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  }
}

function stagePointToShapeLocal(point: StagePoint, shape: ShapeState): StagePoint {
  const offsetX = point.x - shape.x
  const offsetY = point.y - shape.y
  const cos = Math.cos(-shape.rotation)
  const sin = Math.sin(-shape.rotation)

  return {
    x: offsetX * cos - offsetY * sin,
    y: offsetX * sin + offsetY * cos,
  }
}

function angleFromShapeCenter(point: StagePoint, shape: ShapeState) {
  return Math.atan2(point.y - shape.y, point.x - shape.x)
}

function angleDifference(next: number, previous: number) {
  let delta = next - previous
  while (delta > Math.PI) {
    delta -= Math.PI * 2
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2
  }
  return delta
}
