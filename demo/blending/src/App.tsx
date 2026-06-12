import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidCanvas,
  Transform,
  ZStack,
  type NormalDivergenceBlendMode,
} from '@liquid-dom/react'

const GLASS_WIDTH = 220
const GLASS_HEIGHT = 132
const GLASS_CORNER_RADIUS = 50
const GLASS_ORIGIN = { x: 0.5, y: 0.5 }
const CONTAINER_SPACING = 160
const MIN_CONTAINER_SPACING = 0
const MAX_CONTAINER_SPACING = 160
const BLEND_INFLUENCE_GATING_ENABLED = true
const BLEND_INFLUENCE_MIN_K = 0.1
const BLEND_INFLUENCE_PERIOD = 0.5
const BLEND_INFLUENCE_DELAY = 0
const MIN_BLEND_INFLUENCE_MIN_K = 0
const MAX_BLEND_INFLUENCE_MIN_K = 1
const BLEND_INFLUENCE_MIN_K_STEP = 0.01
const MIN_BLEND_INFLUENCE_PERIOD = 0.01
const MAX_BLEND_INFLUENCE_PERIOD = 1
const BLEND_INFLUENCE_PERIOD_STEP = 0.01
const MIN_BLEND_INFLUENCE_DELAY = 0
const MAX_BLEND_INFLUENCE_DELAY = 0.95
const BLEND_INFLUENCE_DELAY_STEP = 0.01
const SAMPLE_VISUALIZATION_OPACITY = 0.5
const CORNER_HIT_RADIUS = 20
const EDGE_HIT_SIZE = 16
const MIN_GLASS_WIDTH = 88
const MIN_GLASS_HEIGHT = 64
const INITIAL_DISTANCE = 34
const BACKGROUND_BRIGHTNESS = 0.7
const PLOT_WIDTH = 800
const PLOT_HEIGHT = 240
const PLOT_MARGIN = { top: 18, right: 18, bottom: 38, left: 48 }
const PLOT_STEPS = 96
const SDF_EPSILON = 0.0001
const NORMAL_GATING_OPTIONS = [
  { value: 'half-chord', label: 'Half-chord' },
  { value: 'angle', label: 'Angle' },
] satisfies Array<{ value: NormalDivergenceBlendMode; label: string }>

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

type StageSize = {
  width: number
  height: number
}

type BoundsRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type TransformedShapeBounds = {
  aabb: BoundsRect
  area: number
  polygon: StagePoint[]
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

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const interactionRef = useRef<InteractionState | null>(null)
  const [shapes, setShapes] = useState(INITIAL_SHAPES)
  const [normalGatingEnabled, setNormalGatingEnabled] = useState(true)
  const [normalGatingMode, setNormalGatingMode] = useState<NormalDivergenceBlendMode>('half-chord')
  const [blendInfluenceGatingEnabled, setBlendInfluenceGatingEnabled] = useState(BLEND_INFLUENCE_GATING_ENABLED)
  const [blendInfluenceMinK, setBlendInfluenceMinK] = useState(BLEND_INFLUENCE_MIN_K)
  const [blendInfluencePeriod, setBlendInfluencePeriod] = useState(BLEND_INFLUENCE_PERIOD)
  const [blendInfluenceDelay, setBlendInfluenceDelay] = useState(BLEND_INFLUENCE_DELAY)
  const [boundsVisible, setBoundsVisible] = useState(false)
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 })
  const [blendingDistance, setBlendingDistance] = useState(CONTAINER_SPACING)
  const [hoveredGatingCurve, setHoveredGatingCurve] = useState<NormalDivergenceBlendMode | null>(null)

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

  function getStagePoint(event: ReactPointerEvent<HTMLDivElement>): StagePoint {
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) {
      return { x: 0, y: 0 }
    }

    return {
      x: event.clientX - bounds.left - bounds.width * 0.5,
      y: event.clientY - bounds.top - bounds.height * 0.5,
    }
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
      <div className="blending-demo">
        <section ref={stageRef} className="blending-stage">
          <LiquidCanvas className="blending-canvas-shell" canvasClassName="blending-canvas">
            <ZStack alignment="center">
              <Html zIndex={-1} sizing="fill">
                <img
                  alt=""
                  className="blending-background-image"
                  src="/assets/background.jpg"
                  style={{ filter: `brightness(${BACKGROUND_BRIGHTNESS})` }}
                />
              </Html>
              <Frame maxWidth={Infinity} maxHeight={Infinity}>
                <GlassContainer
                  blur={7}
                  spacing={blendingDistance}
                  normalDivergenceBlendEnabled={normalGatingEnabled}
                  normalDivergenceBlendMode={normalGatingMode}
                  exposureBlendSubmergedAreaModulationEnabled={blendInfluenceGatingEnabled}
                  exposureBlendSubmergedAreaMinStrength={blendInfluenceMinK}
                  exposureBlendSubmergedAreaPeriod={blendInfluencePeriod}
                  exposureBlendSubmergedAreaDelay={blendInfluenceDelay}
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
                        <Glass cornerRadius={GLASS_CORNER_RADIUS}>
                          <Frame width={shape.width} height={shape.height} />
                        </Glass>
                      </Transform>
                    ))}
                  </ZStack>
                </GlassContainer>
              </Frame>
            </ZStack>
          </LiquidCanvas>
          {boundsVisible && stageSize.width > 0 && stageSize.height > 0 && (
            <BoundsOverlay
              opacity={SAMPLE_VISUALIZATION_OPACITY}
              shapes={shapes}
              stageSize={stageSize}
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

          <div className="blending-controls">
            <button
              aria-pressed={normalGatingEnabled}
              className={`blending-toggle ${normalGatingEnabled ? 'active' : ''}`}
              type="button"
              onClick={() => setNormalGatingEnabled((enabled) => !enabled)}
            >
              <span className="blending-toggle-checkbox" aria-hidden="true" />
              Normal gating
            </button>
            <button
              aria-pressed={blendInfluenceGatingEnabled}
              className={`blending-toggle ${blendInfluenceGatingEnabled ? 'active' : ''}`}
              type="button"
              onClick={() => setBlendInfluenceGatingEnabled((enabled) => !enabled)}
            >
              <span className="blending-toggle-checkbox" aria-hidden="true" />
              Blend influence
            </button>
            <button
              aria-pressed={boundsVisible}
              className={`blending-toggle ${boundsVisible ? 'active' : ''}`}
              type="button"
              onClick={() => setBoundsVisible((visible) => !visible)}
            >
              <span className="blending-toggle-checkbox" aria-hidden="true" />
              Bounds
            </button>
            <label className="blending-distance-control">
              <span>Blending distance</span>
              <input
                aria-label="Blending distance"
                max={MAX_CONTAINER_SPACING}
                min={MIN_CONTAINER_SPACING}
                type="range"
                value={blendingDistance}
                onChange={(event) => setBlendingDistance(event.currentTarget.valueAsNumber)}
              />
              <output>{blendingDistance}</output>
            </label>
            <label className="blending-mode-control">
              <span>Gating mode</span>
              <select
                aria-label="Gating mode"
                value={normalGatingMode}
                onChange={(event) => setNormalGatingMode(event.currentTarget.value as NormalDivergenceBlendMode)}
              >
                {NORMAL_GATING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <GatingPlot
          hoveredCurve={hoveredGatingCurve}
          onHoveredCurveChange={setHoveredGatingCurve}
        />
        <BlendInfluenceKPlot
          delay={blendInfluenceDelay}
          minK={blendInfluenceMinK}
          period={blendInfluencePeriod}
        />
        <div className="blending-parameter-controls">
          <ScalarSlider
            label="Min k"
            max={MAX_BLEND_INFLUENCE_MIN_K}
            min={MIN_BLEND_INFLUENCE_MIN_K}
            step={BLEND_INFLUENCE_MIN_K_STEP}
            value={blendInfluenceMinK}
            onChange={setBlendInfluenceMinK}
          />
          <ScalarSlider
            label="Period"
            max={MAX_BLEND_INFLUENCE_PERIOD}
            min={MIN_BLEND_INFLUENCE_PERIOD}
            step={BLEND_INFLUENCE_PERIOD_STEP}
            value={blendInfluencePeriod}
            onChange={setBlendInfluencePeriod}
          />
          <ScalarSlider
            label="Delay"
            max={MAX_BLEND_INFLUENCE_DELAY}
            min={MIN_BLEND_INFLUENCE_DELAY}
            step={BLEND_INFLUENCE_DELAY_STEP}
            value={blendInfluenceDelay}
            onChange={setBlendInfluenceDelay}
          />
        </div>
      </div>
    </main>
  )
}

type GatingPlotProps = {
  hoveredCurve: NormalDivergenceBlendMode | null
  onHoveredCurveChange: (curve: NormalDivergenceBlendMode | null) => void
}

type BoundsOverlayProps = {
  opacity: number
  shapes: ShapeState[]
  stageSize: StageSize
}

function BoundsOverlay({ opacity, shapes, stageSize }: BoundsOverlayProps) {
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

    const shapeBounds = shapes.map((shape) => ({
      bounds: shapeBoundsFromState(shape),
      shape,
    }))

    for (const { bounds } of shapeBounds) {
      for (const other of shapeBounds) {
        if (other.bounds === bounds) {
          continue
        }
        if (!intersectBounds(bounds.aabb, other.bounds.aabb)) {
          continue
        }
        const overlap = intersectConvexPolygons(bounds.polygon, other.bounds.polygon)
        if (polygonArea(overlap) <= SDF_EPSILON) {
          continue
        }
        drawPolygon(context, overlap, {
          fill: colorWithAlpha('#ffe45c', 0.28),
          stroke: colorWithAlpha('#ffe45c', 0.72),
          width: 1,
        })
      }
    }

    for (const { bounds, shape } of shapeBounds) {
      const submergedArea = estimateBoundsSubmersion(shapeBounds, shape.id)
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
      const label = `${Math.round(submergedArea * 100)}%`
      const labelX = -shape.width * 0.5 + 8
      const labelY = -shape.height * 0.5 + 8
      context.save()
      context.translate(shape.x, shape.y)
      context.rotate(shape.rotation)
      context.strokeText(label, labelX, labelY)
      context.fillText(label, labelX, labelY)
      context.restore()
    }

    context.restore()
  }, [shapes, stageSize])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="blending-bounds-overlay"
      style={{ opacity }}
    />
  )
}

type GatingCurve = {
  id: NormalDivergenceBlendMode
  label: string
  path: string
}

function GatingPlot({
  hoveredCurve,
  onHoveredCurveChange,
}: GatingPlotProps) {
  const curves: GatingCurve[] = [
    {
      id: 'half-chord',
      label: 'Half-chord',
      path: createGatingPath((angle) => Math.sin(angle * 0.5)),
    },
    {
      id: 'angle',
      label: 'Angle',
      path: createGatingPath((angle) => angle / Math.PI),
    },
  ]
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
        {curves.map((curve) => (
          <path
            key={curve.id}
            className={`blending-plot-line ${curve.id} ${hoveredCurve && hoveredCurve !== curve.id ? 'dimmed' : ''}`}
            d={curve.path}
          />
        ))}
        <g className="blending-plot-labels">
          {xTicks.map((tick) => (
            <text key={`x-label-${tick}`} x={plotX((tick / 180) * Math.PI)} y={PLOT_HEIGHT - 12} textAnchor="middle">
              {tick}
            </text>
          ))}
          {yTicks.map((tick) => (
            <text key={`y-label-${tick}`} x={PLOT_MARGIN.left - 10} y={plotY(tick) + 4} textAnchor="end">
              {tick.toFixed(tick === 0 || tick === 1 ? 0 : 2)}
            </text>
          ))}
          <text x={(PLOT_WIDTH + PLOT_MARGIN.left - PLOT_MARGIN.right) * 0.5} y={PLOT_HEIGHT - 3} textAnchor="middle">
            angle
          </text>
          <text x={16} y={(PLOT_HEIGHT + PLOT_MARGIN.top - PLOT_MARGIN.bottom) * 0.5} textAnchor="middle" transform={`rotate(-90 16 ${(PLOT_HEIGHT + PLOT_MARGIN.top - PLOT_MARGIN.bottom) * 0.5})`}>
            g
          </text>
        </g>
      </svg>
      <div className="blending-plot-legend">
        {curves.map((curve) => (
          <span
            key={curve.id}
            className={curve.id}
            onMouseEnter={() => onHoveredCurveChange(curve.id)}
            onMouseLeave={() => onHoveredCurveChange(null)}
            onPointerEnter={() => onHoveredCurveChange(curve.id)}
            onPointerLeave={() => onHoveredCurveChange(null)}
          >
            {curve.label}
          </span>
        ))}
      </div>
    </section>
  )
}

type BlendInfluenceKPlotProps = {
  delay: number
  minK: number
  period: number
}

function BlendInfluenceKPlot({ delay, minK, period }: BlendInfluenceKPlotProps) {
  const lowK = clamp01(minK)
  const yMax = 1
  const path = createBlendInfluenceKPath((influence) => (
    blendInfluenceKScale(influence, lowK, period, delay)
  ), yMax)
  const xTicks = [0, 0.25, 0.5, 0.75, 1]
  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax]
  const yLabelStep = 0.01

  return (
    <section className="blending-plot submerged-k-plot" aria-label="Blend influence k curve plot">
      <svg className="blending-plot-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img">
        <title>Blend influence k curve</title>
        <desc>Plot of smooth-min k scale against normalized blend-influence area.</desc>
        <g className="blending-plot-grid">
          {yTicks.map((tick) => (
            <line
              key={`y-${tick}`}
              x1={PLOT_MARGIN.left}
              x2={PLOT_WIDTH - PLOT_MARGIN.right}
              y1={plotYForRange(tick, yMax)}
              y2={plotYForRange(tick, yMax)}
            />
          ))}
          {xTicks.map((tick) => (
            <line
              key={`x-${tick}`}
              x1={plotXForUnit(tick)}
              x2={plotXForUnit(tick)}
              y1={PLOT_MARGIN.top}
              y2={PLOT_HEIGHT - PLOT_MARGIN.bottom}
            />
          ))}
        </g>
        <path className="blending-plot-axis" d={`M${PLOT_MARGIN.left} ${PLOT_MARGIN.top}V${PLOT_HEIGHT - PLOT_MARGIN.bottom}H${PLOT_WIDTH - PLOT_MARGIN.right}`} />
        <path className="blending-plot-line submerged-k" d={path} />
        <g className="blending-plot-labels">
          {xTicks.map((tick) => (
            <text key={`x-label-${tick}`} x={plotXForUnit(tick)} y={PLOT_HEIGHT - 12} textAnchor="middle">
              {tick.toFixed(tick === 0 || tick === 1 ? 0 : 2)}
            </text>
          ))}
          {yTicks.map((tick) => (
            <text key={`y-label-${tick}`} x={PLOT_MARGIN.left - 10} y={plotYForRange(tick, yMax) + 4} textAnchor="end">
              {formatParameterValue(tick, yLabelStep)}
            </text>
          ))}
          <text x={(PLOT_WIDTH + PLOT_MARGIN.left - PLOT_MARGIN.right) * 0.5} y={PLOT_HEIGHT - 3} textAnchor="middle">
            blend influence
          </text>
          <text x={16} y={(PLOT_HEIGHT + PLOT_MARGIN.top - PLOT_MARGIN.bottom) * 0.5} textAnchor="middle" transform={`rotate(-90 16 ${(PLOT_HEIGHT + PLOT_MARGIN.top - PLOT_MARGIN.bottom) * 0.5})`}>
            k
          </text>
        </g>
      </svg>
    </section>
  )
}

type ScalarSliderProps = {
  label: string
  max: number
  min: number
  step: number
  value: number
  onChange: (value: number) => void
}

function ScalarSlider({
  label,
  max,
  min,
  step,
  value,
  onChange,
}: ScalarSliderProps) {
  return (
    <label className="blending-parameter-control">
      <span>{label}</span>
      <input
        aria-label={label}
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <output>{formatParameterValue(value, step)}</output>
    </label>
  )
}

function createGatingPath(resolveGate: (angle: number) => number) {
  return Array.from({ length: PLOT_STEPS + 1 }, (_, index) => {
    const angle = (index / PLOT_STEPS) * Math.PI
    const command = index === 0 ? 'M' : 'L'
    return `${command}${plotX(angle).toFixed(2)} ${plotY(resolveGate(angle)).toFixed(2)}`
  }).join(' ')
}

function createBlendInfluenceKPath(resolveK: (influence: number) => number, yMax: number) {
  return Array.from({ length: PLOT_STEPS + 1 }, (_, index) => {
    const influence = index / PLOT_STEPS
    const command = index === 0 ? 'M' : 'L'
    return `${command}${plotXForUnit(influence).toFixed(2)} ${plotYForRange(resolveK(influence), yMax).toFixed(2)}`
  }).join(' ')
}

function blendInfluenceKScale(influence: number, lowK: number, period: number, delay: number) {
  const delayedInfluence = Math.max(influence - delay, 0) / Math.max(1 - delay, SDF_EPSILON)
  const curve = shapedCosine01(delayedInfluence * Math.max(period, SDF_EPSILON))
  return lowK + (1 - lowK) * curve
}

function shapedCosine01(value: number) {
  return 0.5 + 0.5 * Math.cos(value * Math.PI * 2)
}

function plotX(angle: number) {
  const width = PLOT_WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right
  return PLOT_MARGIN.left + (angle / Math.PI) * width
}

function plotY(gate: number) {
  const height = PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom
  return PLOT_MARGIN.top + (1 - clamp01(gate)) * height
}

function plotXForUnit(value: number) {
  const width = PLOT_WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right
  return PLOT_MARGIN.left + clamp01(value) * width
}

function plotYForRange(value: number, maxValue: number) {
  const height = PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom
  const normalizedValue = maxValue <= 0.0001 ? 0 : value / maxValue
  return PLOT_MARGIN.top + (1 - clamp01(normalizedValue)) * height
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1)
}

function formatParameterValue(value: number, step: number) {
  return step >= 0.1 ? value.toFixed(1) : value.toFixed(2)
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

type ShapeBoundsEntry = {
  bounds: TransformedShapeBounds
  shape: ShapeState
}

function shapeBoundsFromState(shape: ShapeState): TransformedShapeBounds {
  const polygon = [
    shapeLocalPointToStagePoint(shape, 0, 0),
    shapeLocalPointToStagePoint(shape, shape.width, 0),
    shapeLocalPointToStagePoint(shape, shape.width, shape.height),
    shapeLocalPointToStagePoint(shape, 0, shape.height),
  ]
  return {
    aabb: aabbFromPoints(polygon),
    area: polygonArea(polygon),
    polygon,
  }
}

function aabbFromPoints(points: StagePoint[]): BoundsRect {
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

function aabbArea(bounds: BoundsRect) {
  return Math.max(bounds.maxX - bounds.minX, 0) * Math.max(bounds.maxY - bounds.minY, 0)
}

function intersectBounds(left: BoundsRect, right: BoundsRect): BoundsRect | null {
  const intersection = {
    minX: Math.max(left.minX, right.minX),
    minY: Math.max(left.minY, right.minY),
    maxX: Math.min(left.maxX, right.maxX),
    maxY: Math.min(left.maxY, right.maxY),
  }
  return aabbArea(intersection) > SDF_EPSILON ? intersection : null
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx
}

function polygonSignedArea(points: StagePoint[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return area * 0.5
}

function polygonArea(points: StagePoint[]) {
  return Math.abs(polygonSignedArea(points))
}

function isInsideClipEdge(point: StagePoint, edgeStart: StagePoint, edgeEnd: StagePoint, clipWinding: number) {
  const edgeCross = cross(
    edgeEnd.x - edgeStart.x,
    edgeEnd.y - edgeStart.y,
    point.x - edgeStart.x,
    point.y - edgeStart.y,
  )
  return clipWinding >= 0 ? edgeCross >= -SDF_EPSILON : edgeCross <= SDF_EPSILON
}

function intersectLines(
  lineStart: StagePoint,
  lineEnd: StagePoint,
  clipStart: StagePoint,
  clipEnd: StagePoint,
): StagePoint {
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

function clipPolygonToEdge(subject: StagePoint[], clipStart: StagePoint, clipEnd: StagePoint, clipWinding: number) {
  const output: StagePoint[] = []
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

function intersectConvexPolygons(subject: StagePoint[], clip: StagePoint[]) {
  let output = subject
  const clipWinding = polygonSignedArea(clip)
  for (let index = 0; index < clip.length && output.length >= 3; index += 1) {
    output = clipPolygonToEdge(output, clip[index], clip[(index + 1) % clip.length], clipWinding)
  }
  return output.length >= 3 ? output : []
}

function polygonUnionArea(polygons: StagePoint[][], maxArea: number) {
  if (polygons.length === 0) {
    return 0
  }
  if (polygons.length > 8) {
    return Math.min(polygons.reduce((area, polygon) => area + polygonArea(polygon), 0), maxArea)
  }

  let area = 0
  const accumulate = (startIndex: number, currentPolygon: StagePoint[] | null, subsetSize: number) => {
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

function estimateBoundsSubmersion(entries: ShapeBoundsEntry[], shapeId: ShapeId) {
  const entry = entries.find((candidate) => candidate.shape.id === shapeId)
  if (!entry) {
    return 0
  }

  const shapeArea = entry.bounds.area
  if (shapeArea <= SDF_EPSILON) {
    return 0
  }

  const overlaps = entries.flatMap((other) => {
    if (other.shape.id === shapeId) {
      return []
    }
    if (!intersectBounds(entry.bounds.aabb, other.bounds.aabb)) {
      return []
    }

    const overlap = intersectConvexPolygons(entry.bounds.polygon, other.bounds.polygon)
    return polygonArea(overlap) > SDF_EPSILON ? [overlap] : []
  })

  return clamp01(polygonUnionArea(overlaps, shapeArea) / shapeArea)
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
  if (polygon.length < 3 || polygonArea(polygon) <= SDF_EPSILON) {
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
