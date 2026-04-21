import type { Renderer } from './renderer'
import type { Glass } from './scene'

const GLASS_POINTER_EVENT_TYPES = [
  'click',
  'pointerenter',
  'pointerleave',
  'pointermove',
  'pointerdown',
  'pointerup',
  'pointercancel',
] as const

export type GlassPointerEventType = (typeof GLASS_POINTER_EVENT_TYPES)[number]

export type GlassPointerEventInit = {
  glass: Glass
  renderer: Renderer
  nativeEvent: PointerEvent
  canvasX: number
  canvasY: number
  localX: number
  localY: number
  inside: boolean
}

/**
 * Custom pointer event dispatched by a {@link Glass} instance.
 */
export class GlassPointerEvent extends Event {
  readonly glass: Glass
  readonly renderer: Renderer
  readonly nativeEvent: PointerEvent
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean
  readonly button: number
  readonly buttons: number
  readonly clientX: number
  readonly clientY: number
  readonly canvasX: number
  readonly canvasY: number
  readonly localX: number
  readonly localY: number
  readonly inside: boolean

  constructor(type: GlassPointerEventType, init: GlassPointerEventInit) {
    super(type, { bubbles: false, cancelable: true, composed: false })

    this.glass = init.glass
    this.renderer = init.renderer
    this.nativeEvent = init.nativeEvent
    this.pointerId = init.nativeEvent.pointerId
    this.pointerType = init.nativeEvent.pointerType
    this.isPrimary = init.nativeEvent.isPrimary
    this.button = init.nativeEvent.button
    this.buttons = init.nativeEvent.buttons
    this.clientX = init.nativeEvent.clientX
    this.clientY = init.nativeEvent.clientY
    this.canvasX = init.canvasX
    this.canvasY = init.canvasY
    this.localX = init.localX
    this.localY = init.localY
    this.inside = init.inside
  }
}
