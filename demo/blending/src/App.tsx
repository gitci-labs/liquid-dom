import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidCanvas,
  Transform,
  ZStack,
  type ExposureBlendAngleCurve,
  type ExposureBlendCurve,
  type NormalDivergenceBlendMode,
} from '@liquid-dom/react'

const GLASS_WIDTH = 220
const GLASS_HEIGHT = 132
const GLASS_CORNER_RADIUS = 60
const GLASS_ORIGIN = { x: 0.5, y: 0.5 }
const CONTAINER_SPACING = 160
const MIN_CONTAINER_SPACING = 0
const MAX_CONTAINER_SPACING = 160
const NORMAL_GATING_EXPONENTIAL_LAMBDA = 4
const NORMAL_GATING_GAUSSIAN_LAMBDA = 4
const MIN_NORMAL_GATING_LAMBDA = 0
const MAX_NORMAL_GATING_LAMBDA = 12
const NORMAL_GATING_LAMBDA_STEP = 0.1
const NORMAL_GATING_RATIONAL_SOFTNESS = 0.5
const NORMAL_GATING_BETA_ALPHA = 1.5
const NORMAL_GATING_BETA_BETA = 2.2
const MIN_NORMAL_GATING_BETA_PARAMETER = 0.2
const MAX_NORMAL_GATING_BETA_PARAMETER = 5
const NORMAL_GATING_BETA_PARAMETER_STEP = 0.05
const MIN_NORMAL_GATING_SOFTNESS = 0
const MAX_NORMAL_GATING_SOFTNESS = 1
const NORMAL_GATING_SOFTNESS_STEP = 0.01
const NORMAL_GATING_LOGISTIC_CENTER = 0.5
const NORMAL_GATING_LOGISTIC_K = 12
const MIN_NORMAL_GATING_LOGISTIC_K = 0
const MAX_NORMAL_GATING_LOGISTIC_K = 30
const NORMAL_GATING_LOGISTIC_K_STEP = 0.1
const EXPOSURE_GATING_STRENGTH = 1
const MIN_EXPOSURE_GATING_STRENGTH = 0
const MAX_EXPOSURE_GATING_STRENGTH = 1
const EXPOSURE_GATING_STRENGTH_STEP = 0.01
const EXPOSURE_GATING_BAND_SCALE = 0.4
const MIN_EXPOSURE_GATING_BAND_SCALE = 0
const MAX_EXPOSURE_GATING_BAND_SCALE = 1.5
const EXPOSURE_GATING_BAND_SCALE_STEP = 0.01
const EXPOSURE_GATING_MIN_BAND = 1
const MIN_EXPOSURE_GATING_MIN_BAND = 0
const MAX_EXPOSURE_GATING_MIN_BAND = 6
const EXPOSURE_GATING_MIN_BAND_STEP = 0.1
const EXPOSURE_GATING_ANGLE_RANGE = 90
const MIN_EXPOSURE_GATING_ANGLE_RANGE = 0
const MAX_EXPOSURE_GATING_ANGLE_RANGE = 90
const EXPOSURE_GATING_ANGLE_RANGE_STEP = 1
const EXPOSURE_GATING_ANGLE_PLATEAU = 30
const MIN_EXPOSURE_GATING_ANGLE_PLATEAU = 0
const MAX_EXPOSURE_GATING_ANGLE_PLATEAU = 90
const EXPOSURE_GATING_ANGLE_PLATEAU_STEP = 1
const EXPOSURE_GATING_ANGLE_CURVE: ExposureBlendAngleCurve = 'plateau'
const EXPOSURE_GATING_ANGLE_CURVE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'plateau', label: 'Plateau' },
  { value: 'sine', label: 'Sine' },
  { value: 'cosine-peak', label: 'Cosine peak' },
] satisfies Array<{ value: ExposureBlendAngleCurve; label: string }>
const EXPOSURE_GATING_CURVE: ExposureBlendCurve = 'smootherstep'
const EXPOSURE_GATING_CURVE_OPTIONS = [
  { value: 'smootherstep', label: 'Smootherstep' },
  { value: 'smoothstep', label: 'Smoothstep' },
  { value: 'smoothstep-in', label: 'Ramp up' },
  { value: 'smoothstep-out', label: 'Ramp out' },
] satisfies Array<{ value: ExposureBlendCurve; label: string }>
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
const NORMAL_GATING_OPTIONS = [
  { value: 'half-chord', label: 'Half-chord' },
  { value: 'angle', label: 'Angle' },
  { value: 'none', label: 'None' },
  { value: 'smoothstep', label: 'Smoothstep' },
  { value: 'smootherstep', label: 'Smootherstep' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'gaussian', label: 'Gaussian' },
  { value: 'rational', label: 'Rational' },
  { value: 'beta-cdf', label: 'Beta-CDF' },
  { value: 'logistic-window', label: 'Logistic Window' },
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
  const [normalGatingExponentialLambda, setNormalGatingExponentialLambda] = useState(NORMAL_GATING_EXPONENTIAL_LAMBDA)
  const [normalGatingGaussianLambda, setNormalGatingGaussianLambda] = useState(NORMAL_GATING_GAUSSIAN_LAMBDA)
  const [normalGatingRationalSoftness, setNormalGatingRationalSoftness] = useState(NORMAL_GATING_RATIONAL_SOFTNESS)
  const [normalGatingBetaAlpha, setNormalGatingBetaAlpha] = useState(NORMAL_GATING_BETA_ALPHA)
  const [normalGatingBetaBeta, setNormalGatingBetaBeta] = useState(NORMAL_GATING_BETA_BETA)
  const [normalGatingLogisticCenter, setNormalGatingLogisticCenter] = useState(NORMAL_GATING_LOGISTIC_CENTER)
  const [normalGatingLogisticK, setNormalGatingLogisticK] = useState(NORMAL_GATING_LOGISTIC_K)
  const [exposureGatingEnabled, setExposureGatingEnabled] = useState(true)
  const [exposureGatingStrength, setExposureGatingStrength] = useState(EXPOSURE_GATING_STRENGTH)
  const [exposureGatingBandScale, setExposureGatingBandScale] = useState(EXPOSURE_GATING_BAND_SCALE)
  const [exposureGatingMinBand, setExposureGatingMinBand] = useState(EXPOSURE_GATING_MIN_BAND)
  const [exposureGatingAngleRange, setExposureGatingAngleRange] = useState(EXPOSURE_GATING_ANGLE_RANGE)
  const [exposureGatingAnglePlateau, setExposureGatingAnglePlateau] = useState(EXPOSURE_GATING_ANGLE_PLATEAU)
  const [exposureGatingAngleCurve, setExposureGatingAngleCurve] = useState<ExposureBlendAngleCurve>(EXPOSURE_GATING_ANGLE_CURVE)
  const [exposureGatingCurve, setExposureGatingCurve] = useState<ExposureBlendCurve>(EXPOSURE_GATING_CURVE)
  const [blendingDistance, setBlendingDistance] = useState(CONTAINER_SPACING)
  const [hoveredGatingCurve, setHoveredGatingCurve] = useState<NormalDivergenceBlendMode | null>(null)

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
                  normalDivergenceBlendExponentialLambda={normalGatingExponentialLambda}
                  normalDivergenceBlendGaussianLambda={normalGatingGaussianLambda}
                  normalDivergenceBlendRationalSoftness={normalGatingRationalSoftness}
                  normalDivergenceBlendBetaAlpha={normalGatingBetaAlpha}
                  normalDivergenceBlendBetaBeta={normalGatingBetaBeta}
                  normalDivergenceBlendLogisticCenter={normalGatingLogisticCenter}
                  normalDivergenceBlendLogisticK={normalGatingLogisticK}
                  exposureBlendEnabled={exposureGatingEnabled}
                  exposureBlendStrength={exposureGatingStrength}
                  exposureBlendBandScale={exposureGatingBandScale}
                  exposureBlendMinBand={exposureGatingMinBand}
                  exposureBlendAngleRange={degreesToRadians(exposureGatingAngleRange)}
                  exposureBlendAnglePlateau={degreesToRadians(exposureGatingAnglePlateau)}
                  exposureBlendAngleCurve={exposureGatingAngleCurve}
                  exposureBlendCurve={exposureGatingCurve}
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
              aria-pressed={exposureGatingEnabled}
              className={`blending-toggle ${exposureGatingEnabled ? 'active' : ''}`}
              type="button"
              onClick={() => setExposureGatingEnabled((enabled) => !enabled)}
            >
              <span className="blending-toggle-checkbox" aria-hidden="true" />
              Exposure gating
            </button>
            <label className="blending-mode-control">
              <span>Exposure curve</span>
              <select
                aria-label="Exposure curve"
                value={exposureGatingCurve}
                onChange={(event) => setExposureGatingCurve(event.currentTarget.value as ExposureBlendCurve)}
              >
                {EXPOSURE_GATING_CURVE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="blending-mode-control">
              <span>Exposure angle</span>
              <select
                aria-label="Exposure angle curve"
                value={exposureGatingAngleCurve}
                onChange={(event) => setExposureGatingAngleCurve(event.currentTarget.value as ExposureBlendAngleCurve)}
              >
                {EXPOSURE_GATING_ANGLE_CURVE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
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
          exponentialLambda={normalGatingExponentialLambda}
          gaussianLambda={normalGatingGaussianLambda}
          rationalSoftness={normalGatingRationalSoftness}
          betaAlpha={normalGatingBetaAlpha}
          betaBeta={normalGatingBetaBeta}
          logisticCenter={normalGatingLogisticCenter}
          logisticK={normalGatingLogisticK}
        />
        <ExposureAnglePlot
          angleCurve={exposureGatingAngleCurve}
          anglePlateau={exposureGatingAnglePlateau}
          angleRange={exposureGatingAngleRange}
        />
        <div className="blending-parameter-controls">
          <ParameterSlider
            label="Exponential lambda"
            gatingCurve="exponential"
            max={MAX_NORMAL_GATING_LAMBDA}
            min={MIN_NORMAL_GATING_LAMBDA}
            step={NORMAL_GATING_LAMBDA_STEP}
            value={normalGatingExponentialLambda}
            onGatingCurveHover={setHoveredGatingCurve}
            onChange={setNormalGatingExponentialLambda}
          />
          <ParameterSlider
            label="Gaussian lambda"
            gatingCurve="gaussian"
            max={MAX_NORMAL_GATING_LAMBDA}
            min={MIN_NORMAL_GATING_LAMBDA}
            step={NORMAL_GATING_LAMBDA_STEP}
            value={normalGatingGaussianLambda}
            onGatingCurveHover={setHoveredGatingCurve}
            onChange={setNormalGatingGaussianLambda}
          />
          <ParameterSlider
            label="Rational softness"
            gatingCurve="rational"
            max={MAX_NORMAL_GATING_SOFTNESS}
            min={MIN_NORMAL_GATING_SOFTNESS}
            step={NORMAL_GATING_SOFTNESS_STEP}
            value={normalGatingRationalSoftness}
            onGatingCurveHover={setHoveredGatingCurve}
            onChange={setNormalGatingRationalSoftness}
          />
          <ParameterSlider
            label="Beta alpha"
            gatingCurve="beta-cdf"
            max={MAX_NORMAL_GATING_BETA_PARAMETER}
            min={MIN_NORMAL_GATING_BETA_PARAMETER}
            step={NORMAL_GATING_BETA_PARAMETER_STEP}
            value={normalGatingBetaAlpha}
            onGatingCurveHover={setHoveredGatingCurve}
            onChange={setNormalGatingBetaAlpha}
          />
          <ParameterSlider
            label="Beta beta"
            gatingCurve="beta-cdf"
            max={MAX_NORMAL_GATING_BETA_PARAMETER}
            min={MIN_NORMAL_GATING_BETA_PARAMETER}
            step={NORMAL_GATING_BETA_PARAMETER_STEP}
            value={normalGatingBetaBeta}
            onGatingCurveHover={setHoveredGatingCurve}
            onChange={setNormalGatingBetaBeta}
          />
          <ParameterSlider
            label="Logistic center"
            gatingCurve="logistic-window"
            max={MAX_NORMAL_GATING_SOFTNESS}
            min={MIN_NORMAL_GATING_SOFTNESS}
            step={NORMAL_GATING_SOFTNESS_STEP}
            value={normalGatingLogisticCenter}
            onGatingCurveHover={setHoveredGatingCurve}
            onChange={setNormalGatingLogisticCenter}
          />
          <ParameterSlider
            label="Logistic k"
            gatingCurve="logistic-window"
            max={MAX_NORMAL_GATING_LOGISTIC_K}
            min={MIN_NORMAL_GATING_LOGISTIC_K}
            step={NORMAL_GATING_LOGISTIC_K_STEP}
            value={normalGatingLogisticK}
            onGatingCurveHover={setHoveredGatingCurve}
            onChange={setNormalGatingLogisticK}
          />
          <ScalarSlider
            label="Exposure strength"
            max={MAX_EXPOSURE_GATING_STRENGTH}
            min={MIN_EXPOSURE_GATING_STRENGTH}
            step={EXPOSURE_GATING_STRENGTH_STEP}
            value={exposureGatingStrength}
            onChange={setExposureGatingStrength}
          />
          <ScalarSlider
            label="Exposure band"
            max={MAX_EXPOSURE_GATING_BAND_SCALE}
            min={MIN_EXPOSURE_GATING_BAND_SCALE}
            step={EXPOSURE_GATING_BAND_SCALE_STEP}
            value={exposureGatingBandScale}
            onChange={setExposureGatingBandScale}
          />
          <ScalarSlider
            label="Min exposure px"
            max={MAX_EXPOSURE_GATING_MIN_BAND}
            min={MIN_EXPOSURE_GATING_MIN_BAND}
            step={EXPOSURE_GATING_MIN_BAND_STEP}
            value={exposureGatingMinBand}
            onChange={setExposureGatingMinBand}
          />
          <ScalarSlider
            label="Exposure angle range"
            max={MAX_EXPOSURE_GATING_ANGLE_RANGE}
            min={MIN_EXPOSURE_GATING_ANGLE_RANGE}
            step={EXPOSURE_GATING_ANGLE_RANGE_STEP}
            value={exposureGatingAngleRange}
            onChange={setExposureGatingAngleRange}
          />
          <ScalarSlider
            label="Exposure angle plateau"
            max={MAX_EXPOSURE_GATING_ANGLE_PLATEAU}
            min={MIN_EXPOSURE_GATING_ANGLE_PLATEAU}
            step={EXPOSURE_GATING_ANGLE_PLATEAU_STEP}
            value={exposureGatingAnglePlateau}
            onChange={setExposureGatingAnglePlateau}
          />
        </div>
      </div>
    </main>
  )
}

type GatingPlotProps = {
  hoveredCurve: NormalDivergenceBlendMode | null
  onHoveredCurveChange: (curve: NormalDivergenceBlendMode | null) => void
  exponentialLambda: number
  gaussianLambda: number
  rationalSoftness: number
  betaAlpha: number
  betaBeta: number
  logisticCenter: number
  logisticK: number
}

type GatingCurve = {
  id: NormalDivergenceBlendMode
  label: string
  path: string
}

function GatingPlot({
  hoveredCurve,
  onHoveredCurveChange,
  exponentialLambda,
  gaussianLambda,
  rationalSoftness,
  betaAlpha,
  betaBeta,
  logisticCenter,
  logisticK,
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
    {
      id: 'none',
      label: 'None',
      path: createGatingPath(() => 1),
    },
    {
      id: 'smoothstep',
      label: 'Smoothstep',
      path: createGatingPath((angle) => smoothstepGate(angle / Math.PI)),
    },
    {
      id: 'smootherstep',
      label: 'Smootherstep',
      path: createGatingPath((angle) => smootherstepGate(angle / Math.PI)),
    },
    {
      id: 'exponential',
      label: 'Exponential',
      path: createGatingPath((angle) => normalizedExponentialGate(angle / Math.PI, exponentialLambda)),
    },
    {
      id: 'gaussian',
      label: 'Gaussian',
      path: createGatingPath((angle) => normalizedGaussianGate(angle / Math.PI, gaussianLambda)),
    },
    {
      id: 'rational',
      label: 'Rational',
      path: createGatingPath((angle) => rationalGate(angle / Math.PI, rationalSoftness)),
    },
    {
      id: 'beta-cdf',
      label: 'Beta-CDF',
      path: createGatingPath((angle) => betaCdfGate(angle / Math.PI, betaAlpha, betaBeta)),
    },
    {
      id: 'logistic-window',
      label: 'Logistic Window',
      path: createGatingPath((angle) => logisticWindowGate(angle / Math.PI, logisticCenter, logisticK)),
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

type ExposureAnglePlotProps = {
  angleCurve: ExposureBlendAngleCurve
  anglePlateau: number
  angleRange: number
}

function ExposureAnglePlot({ angleCurve, anglePlateau, angleRange }: ExposureAnglePlotProps) {
  const xTicks = [0, 45, 90, 135, 180]
  const yTicks = [0, 0.25, 0.5, 0.75, 1]
  const path = createGatingPath((angle) => exposureAngleWindow(angle, angleCurve, angleRange, anglePlateau))

  return (
    <section className="blending-plot" aria-label="Exposure angle window plot">
      <svg className="blending-plot-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img">
        <title>Exposure angle window</title>
        <desc>Plot of exposure gating weight against the angle between SDF normals.</desc>
        <g className="blending-plot-grid">
          {yTicks.map((tick) => (
            <line
              key={`exposure-y-${tick}`}
              x1={PLOT_MARGIN.left}
              x2={PLOT_WIDTH - PLOT_MARGIN.right}
              y1={plotY(tick)}
              y2={plotY(tick)}
            />
          ))}
          {xTicks.map((tick) => (
            <line
              key={`exposure-x-${tick}`}
              x1={plotX((tick / 180) * Math.PI)}
              x2={plotX((tick / 180) * Math.PI)}
              y1={PLOT_MARGIN.top}
              y2={PLOT_HEIGHT - PLOT_MARGIN.bottom}
            />
          ))}
        </g>
        <path className="blending-plot-axis" d={`M${PLOT_MARGIN.left} ${PLOT_MARGIN.top}V${PLOT_HEIGHT - PLOT_MARGIN.bottom}H${PLOT_WIDTH - PLOT_MARGIN.right}`} />
        <path className="blending-plot-line exposure-window" d={path} />
        <g className="blending-plot-labels">
          {xTicks.map((tick) => (
            <text key={`exposure-x-label-${tick}`} x={plotX((tick / 180) * Math.PI)} y={PLOT_HEIGHT - 12} textAnchor="middle">
              {tick}
            </text>
          ))}
          {yTicks.map((tick) => (
            <text key={`exposure-y-label-${tick}`} x={PLOT_MARGIN.left - 10} y={plotY(tick) + 4} textAnchor="end">
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
        <span className="exposure-window">Exposure angle window</span>
      </div>
    </section>
  )
}

type ParameterSliderProps = {
  label: string
  gatingCurve: NormalDivergenceBlendMode
  max: number
  min: number
  step: number
  value: number
  onGatingCurveHover: (curve: NormalDivergenceBlendMode | null) => void
  onChange: (value: number) => void
}

function ParameterSlider({
  label,
  gatingCurve,
  max,
  min,
  step,
  value,
  onGatingCurveHover,
  onChange,
}: ParameterSliderProps) {
  return (
    <label
      className="blending-parameter-control"
      onFocus={() => onGatingCurveHover(gatingCurve)}
      onBlur={() => onGatingCurveHover(null)}
      onMouseEnter={() => onGatingCurveHover(gatingCurve)}
      onMouseLeave={() => onGatingCurveHover(null)}
      onPointerEnter={() => onGatingCurveHover(gatingCurve)}
      onPointerLeave={() => onGatingCurveHover(null)}
    >
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

function exposureAngleWindow(
  angle: number,
  angleCurve: ExposureBlendAngleCurve,
  angleRangeDegrees: number,
  anglePlateauDegrees: number,
) {
  const normalizedAngle = angle / Math.PI
  if (angleCurve === 'none') {
    return 1
  }
  if (angleCurve === 'triangle') {
    return 1 - Math.abs(normalizedAngle * 2 - 1)
  }
  if (angleCurve === 'sine') {
    return Math.sin(normalizedAngle * Math.PI)
  }
  if (angleCurve === 'cosine-peak') {
    return 1 - Math.abs(Math.cos(normalizedAngle * Math.PI))
  }

  const range = Math.max(angleRangeDegrees / 180, 0.0001)
  const plateau = Math.min(clamp01(anglePlateauDegrees / 180), range)
  const angleDistance = Math.abs(normalizedAngle - 0.5)
  const rampProgress = (angleDistance - plateau) / Math.max(range - plateau, 0.0001)
  return 1 - smootherstepGate(rampProgress)
}

function normalizedExponentialGate(value: number, lambdaInput: number) {
  const lambda = Math.max(lambdaInput, 0.0001)
  return (1 - Math.exp(-lambda * value)) / (1 - Math.exp(-lambda))
}

function normalizedGaussianGate(value: number, lambdaInput: number) {
  const lambda = Math.max(lambdaInput, 0.0001)
  return (1 - Math.exp(-lambda * value * value)) / (1 - Math.exp(-lambda))
}

function rationalGate(value: number, softnessInput: number) {
  const softness = clamp01(softnessInput)
  const denominator = value + softness * (1 - value)
  return denominator <= 0.0001 ? 0 : value / denominator
}

function smoothstepGate(value: number) {
  const x = clamp01(value)
  return x * x * (3 - 2 * x)
}

function smootherstepGate(value: number) {
  const x = clamp01(value)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

function betaPdf(value: number, alphaInput: number, betaInput: number) {
  const alpha = Math.max(alphaInput, 0.05)
  const beta = Math.max(betaInput, 0.05)
  const x = Math.min(Math.max(value, 0.0001), 0.9999)
  return (x ** (alpha - 1)) * ((1 - x) ** (beta - 1))
}

function integrateBetaPdf(upper: number, alpha: number, beta: number) {
  const clampedUpper = clamp01(upper)
  const steps = 16
  const step = clampedUpper / steps
  let sum = betaPdf(0, alpha, beta) + betaPdf(clampedUpper, alpha, beta)
  for (let index = 1; index < steps; index += 1) {
    sum += (index % 2 === 1 ? 4 : 2) * betaPdf(step * index, alpha, beta)
  }
  return (sum * step) / 3
}

function betaCdfGate(value: number, alphaInput: number, betaInput: number) {
  const upper = clamp01(value)
  if (upper <= 0.0001) {
    return 0
  }
  if (upper >= 0.9999) {
    return 1
  }

  const alpha = Math.max(alphaInput, 0.05)
  const beta = Math.max(betaInput, 0.05)
  const numerator = integrateBetaPdf(upper, alpha, beta)
  const denominator = Math.max(integrateBetaPdf(1, alpha, beta), 0.0001)
  return clamp01(numerator / denominator)
}

function logisticWindowGate(value: number, centerInput: number, steepnessInput: number) {
  const center = clamp01(centerInput)
  const steepness = Math.max(steepnessInput, 0.0001)
  const start = sigmoid(-steepness * center)
  const end = sigmoid(steepness * (1 - center))
  const denominator = end - start
  if (Math.abs(denominator) <= 0.0001) {
    return value
  }
  return clamp01((sigmoid(steepness * (value - center)) - start) / denominator)
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value))
}

function plotX(angle: number) {
  const width = PLOT_WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right
  return PLOT_MARGIN.left + (angle / Math.PI) * width
}

function plotY(gate: number) {
  const height = PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom
  return PLOT_MARGIN.top + (1 - clamp01(gate)) * height
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1)
}

function degreesToRadians(degrees: number) {
  return degrees * Math.PI / 180
}

function formatParameterValue(value: number, step: number) {
  return step >= 0.1 ? value.toFixed(1) : value.toFixed(2)
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
