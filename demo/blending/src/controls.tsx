import { useEffect } from 'react'
import { useControls } from 'leva'
import { createPlugin, useInputContext } from 'leva/plugin'
import {
  BLEND_SUPPORT_CELL_SIZE,
  BLEND_SUPPORT_GATING_ENABLED,
  CONTAINER_SPACING,
  DEBUG_OVERLAY_STORAGE_KEY,
  GLASS_CORNER_RADIUS,
  MAX_BLEND_SUPPORT_CELL_SIZE,
  MAX_CONTAINER_SPACING,
  MAX_GLASS_CORNER_RADIUS,
  MAX_NORMAL_GATING_HERMITE_PARAMETER,
  MAX_SMOOTH_UNION_PARAMETER,
  MIN_BLEND_SUPPORT_CELL_SIZE,
  MIN_CONTAINER_SPACING,
  MIN_GLASS_CORNER_RADIUS,
  MIN_NORMAL_GATING_HERMITE_PARAMETER,
  MIN_SMOOTH_UNION_PARAMETER,
  NORMAL_GATING_HERMITE_CAP,
  NORMAL_GATING_HERMITE_KNEE,
  NORMAL_GATING_HERMITE_PARAMETER_STEP,
  SMOOTH_UNION_ACCELERATION,
  SMOOTH_UNION_PARAMETER_STEP,
} from './constants'
import { GatingPlot } from './GatingPlot'
import type { BlendingPanelValues, GatingPlotValue } from './types'

const normalGatePlotControl = createPlugin<
  { value: GatingPlotValue },
  GatingPlotValue,
  Record<string, never>
>({
  normalize: (input) => ({ value: input.value }),
  component: GatingPlotControl,
})

export function useBlendingControls() {
  const [controls, setControls] = useControls(() => ({
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
    blendSupportCellSize: {
      value: BLEND_SUPPORT_CELL_SIZE,
      min: MIN_BLEND_SUPPORT_CELL_SIZE,
      max: MAX_BLEND_SUPPORT_CELL_SIZE,
      step: 1,
      label: 'Blend support cell size',
    },
    smoothUnionAcceleration: {
      value: SMOOTH_UNION_ACCELERATION,
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

  useEffect(() => {
    storeDebugOverlayVisible(controls.boundsVisible)
  }, [controls.boundsVisible])

  useEffect(() => {
    setControls({
      normalGatePlot: {
        hermiteCap: controls.normalGatingHermiteCap,
        hermiteKnee: controls.normalGatingHermiteKnee,
      },
    })
  }, [controls.normalGatingHermiteCap, controls.normalGatingHermiteKnee, setControls])

  return controls
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
