import type { GlassPointerEvent } from 'liquid-glass-dom'

export type DemoTab = 'tiny' | 'sdf-overlap' | 'layout-simple' | 'animation' | 'dom-measurement' | 'layout' | 'pointer' | 'html'

export type EventRow = {
  id: number
  message: string
}

export type LiveState = {
  glass: string
  type: string
  localX: number
  localY: number
  inside: boolean
}

export const MAX_LOG_ROWS = 10

export function formatPointerEvent(label: string, event: GlassPointerEvent) {
  return `${label} ${event.type} local(${event.localX.toFixed(1)}, ${event.localY.toFixed(1)}) inside=${event.inside}`
}
