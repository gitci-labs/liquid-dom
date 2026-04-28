import { GlassPointerEvent, type GlassPointerEventInit, type GlassPointerEventType } from '../events'
import type { Glass } from '../scene'
import {
  createGlassInteractionEntries,
  hitTestGlassInteractionEntries,
  measureGlassInteractionEntry,
  type GlassInteractionEntry,
  type PointerSnapshot,
  type PointerState,
} from './interaction'

/** Dependencies needed by the pointer controller without owning the renderer. */
type PointerControllerOptions = {
  targetCanvas: HTMLCanvasElement
  renderer: GlassPointerEventInit['renderer']
  isDestroyed: () => boolean
  flushSceneContentSync: () => void
  getSceneHtmlHosts: () => Set<HTMLDivElement>
  getGlassContentHosts: () => Set<HTMLDivElement>
}

/** Returns whether an event's composed path contains one of the HTML hosts. */
function eventTargetsHost(event: Event, hosts: Set<HTMLDivElement>) {
  const path = event.composedPath()

  for (const host of hosts) {
    if (path.includes(host)) {
      return true
    }
  }

  return false
}

/** Owns glass pointer hit testing, hover state, capture state, and dispatch. */
export class PointerController {
  private glassInteractionEntries = new Map<Glass, GlassInteractionEntry>()
  private glassInteractionOrder: GlassInteractionEntry[] = []
  private readonly pointerStates = new Map<number, PointerState>()

  /** Native pointermove listener wired to the renderer canvas. */
  readonly handlePointerMove = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointermove', event)
  }

  /** Native pointerdown listener wired to the renderer canvas. */
  readonly handlePointerDown = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointerdown', event)
  }

  /** Native pointerup listener wired to the renderer canvas. */
  readonly handlePointerUp = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointerup', event)
  }

  /** Native pointercancel listener wired to the renderer canvas. */
  readonly handlePointerCancel = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointercancel', event)
  }

  /** Native pointerleave listener wired to the renderer canvas. */
  readonly handlePointerLeave = (event: PointerEvent) => {
    this.handleNativePointerEvent('pointerleave', event)
  }

  /** Creates a pointer controller for one renderer canvas. */
  constructor(private readonly options: PointerControllerOptions) {}

  /** Rebuilds hit-test entries after scene or layout changes. */
  syncInteractions(containers: Parameters<typeof createGlassInteractionEntries>[0]) {
    const previousEntries = this.glassInteractionEntries
    const { entriesByGlass, orderedEntries } = createGlassInteractionEntries(containers)
    this.glassInteractionEntries = entriesByGlass
    this.glassInteractionOrder = orderedEntries
    this.handleRemovedInteractionTargets(previousEntries)
  }

  /** Clears cached hit-test entries and pointer state. */
  clear() {
    this.glassInteractionEntries.clear()
    this.glassInteractionOrder = []
    this.pointerStates.clear()
  }

  /** Returns existing pointer state or initializes one for a native pointer id. */
  private getPointerState(pointerId: number) {
    let state = this.pointerStates.get(pointerId)
    if (state) {
      return state
    }

    state = {
      hoveredGlass: null,
      capturedGlass: null,
      capturedWithNativePointerCapture: false,
      pressedGlass: null,
      lastSnapshot: null,
    }
    this.pointerStates.set(pointerId, state)
    return state
  }

  /** Captures canvas-relative pointer coordinates for event dispatch. */
  private createPointerSnapshot(event: PointerEvent): PointerSnapshot {
    const bounds = this.options.targetCanvas.getBoundingClientRect()
    return {
      nativeEvent: event,
      canvasX: event.clientX - bounds.left,
      canvasY: event.clientY - bounds.top,
    }
  }

  /** Dispatches a synthetic glass pointer event and mirrors preventDefault. */
  private dispatchGlassPointerEvent(
    type: GlassPointerEventType,
    glass: Glass,
    entry: GlassInteractionEntry | null,
    snapshot: PointerSnapshot,
    inside: boolean,
  ) {
    const localPoint = entry
      ? measureGlassInteractionEntry(entry, snapshot.canvasX, snapshot.canvasY)
      : { localX: 0, localY: 0 }
    const event = new GlassPointerEvent(type, {
      glass,
      renderer: this.options.renderer,
      nativeEvent: snapshot.nativeEvent,
      canvasX: snapshot.canvasX,
      canvasY: snapshot.canvasY,
      localX: localPoint.localX,
      localY: localPoint.localY,
      inside,
    })

    glass.dispatchEvent(event)
    if (event.defaultPrevented) {
      snapshot.nativeEvent.preventDefault()
    }
  }

  /** Sends enter/leave events when the hovered glass target changes. */
  private updateHoveredGlass(state: PointerState, nextEntry: GlassInteractionEntry | null, snapshot: PointerSnapshot) {
    const currentGlass = state.hoveredGlass
    const nextGlass = nextEntry?.glass ?? null
    if (currentGlass === nextGlass) {
      return
    }

    if (currentGlass) {
      const currentEntry = this.glassInteractionEntries.get(currentGlass) ?? null
      this.dispatchGlassPointerEvent('pointerleave', currentGlass, currentEntry, snapshot, false)
    }

    state.hoveredGlass = nextGlass
    if (nextEntry) {
      this.dispatchGlassPointerEvent('pointerenter', nextEntry.glass, nextEntry, snapshot, true)
    }
  }

  /** Releases native pointer capture when the canvas currently owns it. */
  private releaseNativePointerCapture(pointerId: number) {
    if (!this.options.targetCanvas.hasPointerCapture(pointerId)) {
      return
    }

    try {
      this.options.targetCanvas.releasePointerCapture(pointerId)
    } catch {
      // Ignore browsers rejecting a redundant release.
    }
  }

  /** Removes idle pointer state after hover, capture, and press state are clear. */
  private cleanupPointerState(pointerId: number, state: PointerState) {
    if (state.hoveredGlass || state.capturedGlass || state.pressedGlass) {
      return
    }

    this.pointerStates.delete(pointerId)
  }

  /** Flushes scene sync after handling an event and prunes idle pointer state. */
  private finishPointerEvent(pointerId: number, state: PointerState) {
    this.options.flushSceneContentSync()
    this.cleanupPointerState(pointerId, state)
  }

  /** Cancels or retargets pointer state when glass nodes leave the scene. */
  private handleRemovedInteractionTargets(previousEntries: Map<Glass, GlassInteractionEntry>) {
    for (const [pointerId, state] of this.pointerStates) {
      const snapshot = state.lastSnapshot
      const capturedGlass = state.capturedGlass
      if (capturedGlass && !this.glassInteractionEntries.has(capturedGlass)) {
        const previousEntry = previousEntries.get(capturedGlass) ?? null
        if (snapshot) {
          this.dispatchGlassPointerEvent('pointercancel', capturedGlass, previousEntry, snapshot, false)
        }
        state.capturedGlass = null
        state.capturedWithNativePointerCapture = false
        state.pressedGlass = null
        this.releaseNativePointerCapture(pointerId)
      }

      const hoveredGlass = state.hoveredGlass
      if (hoveredGlass && !this.glassInteractionEntries.has(hoveredGlass)) {
        const previousEntry = previousEntries.get(hoveredGlass) ?? null
        if (snapshot) {
          this.dispatchGlassPointerEvent('pointerleave', hoveredGlass, previousEntry, snapshot, false)
        }
        state.hoveredGlass = null
      }

      if (!state.capturedGlass && snapshot) {
        this.updateHoveredGlass(
          state,
          hitTestGlassInteractionEntries(this.glassInteractionOrder, snapshot.canvasX, snapshot.canvasY),
          snapshot,
        )
      }

      this.cleanupPointerState(pointerId, state)
    }
  }

  /** Handles native pointer events and dispatches the matching glass events. */
  private handleNativePointerEvent(type: GlassPointerEventType, event: PointerEvent) {
    if (this.options.isDestroyed()) {
      return
    }

    this.options.flushSceneContentSync()

    const state = this.getPointerState(event.pointerId)
    const snapshot = this.createPointerSnapshot(event)
    state.lastSnapshot = snapshot

    const capturedEntry = state.capturedGlass
      ? this.glassInteractionEntries.get(state.capturedGlass) ?? null
      : null

    if (capturedEntry) {
      if (type === 'pointerleave') {
        if (!state.capturedWithNativePointerCapture) {
          this.dispatchGlassPointerEvent('pointercancel', capturedEntry.glass, capturedEntry, snapshot, false)
          state.capturedGlass = null
          state.capturedWithNativePointerCapture = false
          state.pressedGlass = null
          this.updateHoveredGlass(state, null, snapshot)
          this.cleanupPointerState(event.pointerId, state)
        }
        return
      }

      const measurement = measureGlassInteractionEntry(capturedEntry, snapshot.canvasX, snapshot.canvasY)
      this.dispatchGlassPointerEvent(type, capturedEntry.glass, capturedEntry, snapshot, measurement.inside)

      if (type === 'pointerup' || type === 'pointercancel') {
        if (
          type === 'pointerup' &&
          event.button === 0 &&
          state.pressedGlass === capturedEntry.glass &&
          measurement.inside
        ) {
          this.dispatchGlassPointerEvent('click', capturedEntry.glass, capturedEntry, snapshot, true)
        }

        state.capturedGlass = null
        state.capturedWithNativePointerCapture = false
        state.pressedGlass = null
        this.releaseNativePointerCapture(event.pointerId)
        this.updateHoveredGlass(
          state,
          hitTestGlassInteractionEntries(this.glassInteractionOrder, snapshot.canvasX, snapshot.canvasY),
          snapshot,
        )
      }

      this.finishPointerEvent(event.pointerId, state)
      return
    }

    if (type === 'pointerleave') {
      if (state.hoveredGlass) {
        const hoveredEntry = this.glassInteractionEntries.get(state.hoveredGlass) ?? null
        this.dispatchGlassPointerEvent('pointerleave', state.hoveredGlass, hoveredEntry, snapshot, false)
        state.hoveredGlass = null
      }

      this.finishPointerEvent(event.pointerId, state)
      return
    }

    const hitEntry = hitTestGlassInteractionEntries(
      this.glassInteractionOrder,
      snapshot.canvasX,
      snapshot.canvasY,
    )
    this.updateHoveredGlass(state, hitEntry, snapshot)

    if (hitEntry) {
      this.dispatchGlassPointerEvent(type, hitEntry.glass, hitEntry, snapshot, true)

      if (type === 'pointerdown') {
        state.pressedGlass = hitEntry.glass
        this.options.flushSceneContentSync()

        if (this.glassInteractionEntries.has(hitEntry.glass)) {
          state.capturedGlass = hitEntry.glass
          state.capturedWithNativePointerCapture = false

          if (
            !eventTargetsHost(event, this.options.getSceneHtmlHosts()) &&
            !eventTargetsHost(event, this.options.getGlassContentHosts())
          ) {
            try {
              this.options.targetCanvas.setPointerCapture(event.pointerId)
              state.capturedWithNativePointerCapture = true
            } catch {
              state.capturedGlass = null
              state.pressedGlass = null
            }
          }
        }
      }
    }

    this.finishPointerEvent(event.pointerId, state)
  }
}
