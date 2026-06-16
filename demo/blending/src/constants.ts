import type { ShapeState } from './types'

export const TOP_GLASS_WIDTH = 150
export const BOTTOM_GLASS_WIDTH = 220
export const GLASS_HEIGHT = 132
export const GLASS_CORNER_RADIUS = 60
export const MIN_GLASS_CORNER_RADIUS = 0
export const MAX_GLASS_CORNER_RADIUS = 120
export const GLASS_ORIGIN = { x: 0.5, y: 0.5 }
export const CONTAINER_SPACING = 160
export const MIN_CONTAINER_SPACING = 0
export const MAX_CONTAINER_SPACING = 160
export const BLEND_SUPPORT_GATING_ENABLED = true
export const BLEND_SUPPORT_CELL_SIZE = 100
export const MIN_BLEND_SUPPORT_CELL_SIZE = 8
export const MAX_BLEND_SUPPORT_CELL_SIZE = 240
export const MIN_BLEND_SUPPORT_GRID_CELLS = 1
export const MAX_BLEND_SUPPORT_GRID_CELLS = 12
export const BLEND_SUPPORT_KERNEL_RADIUS = 2
export const MIN_SMOOTH_UNION_PARAMETER = 0
export const MAX_SMOOTH_UNION_PARAMETER = 1
export const SMOOTH_UNION_PARAMETER_STEP = 0.01
export const SMOOTH_UNION_ACCELERATION = 0.35
export const SAMPLE_VISUALIZATION_OPACITY = 0.5
export const CORNER_HIT_RADIUS = 20
export const EDGE_HIT_SIZE = 16
export const MIN_GLASS_WIDTH = 88
export const MIN_GLASS_HEIGHT = 64
export const INITIAL_DISTANCE = 60
export const DEBUG_OVERLAY_STORAGE_KEY = 'liquid-glass-blending-debug-overlay-visible'

export const INITIAL_SHAPES: ShapeState[] = [
  {
    id: 'left',
    x: 0,
    y: -(GLASS_HEIGHT + INITIAL_DISTANCE) / 2,
    width: TOP_GLASS_WIDTH,
    height: GLASS_HEIGHT,
    rotation: 0,
  },
  {
    id: 'right',
    x: 0,
    y: (GLASS_HEIGHT + INITIAL_DISTANCE) / 2,
    width: BOTTOM_GLASS_WIDTH,
    height: GLASS_HEIGHT,
    rotation: 0,
  },
]
