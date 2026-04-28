import type { Container } from '../scene'
import type { BackdropMetrics } from '../types'
import { GPU_BUFFER_USAGE } from './gpu-constants'
import { BACKDROP_METRICS_BUFFER_SIZE, parseBackdropMetrics } from './metrics'

/** Per-container state for asynchronous backdrop metrics readback. */
export type BackdropMetricsState = {
  container: Container
  readbackBuffer: GPUBuffer | null
  metrics: BackdropMetrics | null
  pendingReadback: boolean
  inScene: boolean
  cleanupAfterPending: boolean
}

/** Tracks cached backdrop metrics resources and readback lifecycle. */
export class BackdropMetricsTracker {
  private device: GPUDevice | null = null
  private readonly stateByContainer = new WeakMap<Container, BackdropMetricsState>()
  private readonly trackedContainers = new Set<Container>()
  private readonly pendingStates = new Set<BackdropMetricsState>()

  /** Creates a tracker that can query renderer teardown state. */
  constructor(private readonly isDestroyed: () => boolean) {}

  /** Attaches the GPU device and allocates buffers for already tracked containers. */
  setDevice(device: GPUDevice) {
    this.device = device

    for (const container of this.trackedContainers) {
      const state = this.stateByContainer.get(container)
      if (state) {
        this.ensureResources(state)
      }
    }
  }

  /** Enables or disables metrics tracking for a container. */
  setTracking(container: Container, enabled: boolean) {
    if (enabled) {
      const state = this.getOrCreateState(container)
      state.cleanupAfterPending = false
      this.trackedContainers.add(container)
      this.ensureResources(state)
      return
    }

    this.trackedContainers.delete(container)
    const state = this.stateByContainer.get(container)
    if (!state) {
      return
    }

    state.metrics = null
    state.inScene = false

    if (state.pendingReadback) {
      state.cleanupAfterPending = true
      return
    }

    this.cleanupState(state)
  }

  /** Returns the latest completed metrics for a tracked in-scene container. */
  getMetrics(container: Container) {
    if (!this.trackedContainers.has(container)) {
      return null
    }

    const state = this.stateByContainer.get(container)
    if (!state || !state.inScene) {
      return null
    }

    return state.metrics
  }

  /** Returns mutable state for a tracked container, creating it if needed. */
  getTrackedState(container: Container) {
    if (!this.trackedContainers.has(container)) {
      return null
    }

    return this.getOrCreateState(container)
  }

  /** Allocates the readback buffer for a metrics state if possible. */
  ensureResources(state: BackdropMetricsState) {
    if (!this.device || state.readbackBuffer) {
      return
    }

    state.readbackBuffer = this.device.createBuffer({
      size: BACKDROP_METRICS_BUFFER_SIZE,
      usage: GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
    })
  }

  /** Marks which tracked containers were seen in the latest rendered scene. */
  markSceneMembership(seenContainers: Set<Container>) {
    for (const container of this.trackedContainers) {
      const state = this.stateByContainer.get(container)
      if (!state) {
        continue
      }

      state.inScene = seenContainers.has(container)
      if (!state.inScene) {
        state.metrics = null
      }
    }
  }

  /** Starts an asynchronous readback and parses metrics when mapping completes. */
  scheduleReadback(state: BackdropMetricsState) {
    const readbackBuffer = state.readbackBuffer
    if (!readbackBuffer || state.pendingReadback) {
      return
    }

    state.pendingReadback = true
    this.pendingStates.add(state)

    void readbackBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        if (this.isDestroyed() || !this.trackedContainers.has(state.container) || !state.inScene) {
          state.metrics = null
          return
        }

        const nextMetrics = parseBackdropMetrics(readbackBuffer)
        if (!nextMetrics) {
          state.metrics = null
          return
        }

        state.metrics = nextMetrics
      })
      .catch((error) => {
        if (!this.isDestroyed() && !state.cleanupAfterPending) {
          console.error(error)
        }
        state.metrics = null
      })
      .finally(() => {
        if (readbackBuffer.mapState === 'mapped') {
          readbackBuffer.unmap()
        }

        state.pendingReadback = false
        this.pendingStates.delete(state)

        if (this.isDestroyed() || state.cleanupAfterPending) {
          this.cleanupState(state)
        }
      })
  }

  /** Releases completed resources and marks pending readbacks for cleanup. */
  destroy() {
    for (const container of this.trackedContainers) {
      const state = this.stateByContainer.get(container)
      if (!state) {
        continue
      }

      if (state.pendingReadback) {
        state.cleanupAfterPending = true
      } else {
        this.cleanupState(state)
      }
    }
    this.trackedContainers.clear()

    for (const state of this.pendingStates) {
      state.cleanupAfterPending = true
    }
  }

  /** Returns existing metrics state for a container or creates a new one. */
  private getOrCreateState(container: Container) {
    let state = this.stateByContainer.get(container)
    if (state) {
      return state
    }

    state = {
      container,
      readbackBuffer: null,
      metrics: null,
      pendingReadback: false,
      inScene: false,
      cleanupAfterPending: false,
    }
    this.stateByContainer.set(container, state)
    return state
  }

  /** Releases a state readback buffer once it is no longer pending. */
  private cleanupState(state: BackdropMetricsState) {
    if (state.pendingReadback) {
      state.cleanupAfterPending = true
      return
    }

    state.metrics = null
    state.inScene = false
    state.cleanupAfterPending = false
    this.pendingStates.delete(state)
    state.readbackBuffer?.destroy()
    state.readbackBuffer = null
  }
}
