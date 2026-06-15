import { sdfUtils } from '@liquid-dom/core'
import {
  PLOT_HEIGHT,
  PLOT_MARGIN,
  PLOT_STEPS,
  PLOT_WIDTH,
} from './constants'
import type { GatingPlotValue } from './types'

type GatingPlotProps = GatingPlotValue

export function GatingPlot({
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
