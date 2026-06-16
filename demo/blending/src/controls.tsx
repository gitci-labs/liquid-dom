import { useEffect } from 'react'
import { useControls } from 'leva'
import {
  BLEND_SUPPORT_CELL_SIZE,
  BLEND_SUPPORT_GATING_ENABLED,
  CONTAINER_SPACING,
  DEBUG_OVERLAY_STORAGE_KEY,
  GLASS_CORNER_RADIUS,
  MAX_BLEND_SUPPORT_CELL_SIZE,
  MAX_CONTAINER_SPACING,
  MAX_GLASS_CORNER_RADIUS,
  MAX_SMOOTH_UNION_PARAMETER,
  MIN_BLEND_SUPPORT_CELL_SIZE,
  MIN_CONTAINER_SPACING,
  MIN_GLASS_CORNER_RADIUS,
  MIN_SMOOTH_UNION_PARAMETER,
  SMOOTH_UNION_ACCELERATION,
  SMOOTH_UNION_PARAMETER_STEP,
} from './constants'
import type { BlendingPanelValues } from './types'

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

  return { controls, setControls }
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
