import { Scene } from '../scene'
import { DomContentSync } from './dom-content-sync'
import {
  getHtmlHostOrder,
  getLayerContainers,
  getSortedSceneLayers,
} from './scene-order'
import type { GlassContentRange, SceneHtmlEntry, WebGpuGlassContentSource } from './content-source'
import type { Glass, Html } from '../scene'

/** Constructor options for a DOM-backed content provider usable by WebGPU hosts. */
export type WebGpuDomContentSourceInit = {
  targetCanvas: HTMLCanvasElement
  getCurrentDpr: () => number
  scene?: Scene
}

/**
 * DOM-to-texture content source for hosts that use {@link WebGpuGlassCore}
 * without the standalone DOM renderer.
 */
export class WebGpuDomContentSource implements WebGpuGlassContentSource {
  readonly scene: Scene | null

  private readonly targetCanvas: HTMLCanvasElement
  private readonly domContent: DomContentSync
  private destroyed = false

  private readonly handlePaintEvent = (event: Event) => {
    if (!this.destroyed) {
      this.domContent.handlePaintEvent(event)
    }
  }

  constructor({ targetCanvas, getCurrentDpr, scene }: WebGpuDomContentSourceInit) {
    this.targetCanvas = targetCanvas
    this.scene = scene ?? null
    this.domContent = new DomContentSync({ targetCanvas, getCurrentDpr })
    this.targetCanvas.setAttribute('layoutsubtree', 'true')
    this.targetCanvas.addEventListener('paint', this.handlePaintEvent as EventListener)
  }

  /** Current atlas texture for glass-attached HTML content, if any exists. */
  get atlasTexture() {
    return this.domContent.atlasTexture
  }

  /** Binding resource for glass content entries, or null before GPU allocation. */
  get contentEntriesBindingResource() {
    return this.domContent.contentEntriesBindingResource
  }

  /** Attaches GPU resources used for DOM content textures and storage buffers. */
  setDevice(device: GPUDevice, presentationFormat: GPUTextureFormat) {
    this.domContent.setDevice(device, presentationFormat)
  }

  /** Synchronizes DOM hosts, atlas metadata, and pending DOM-to-texture copies. */
  sync(scene = this.scene) {
    if (!scene) {
      throw new Error('WebGpuDomContentSource.sync requires a scene.')
    }

    const layers = getSortedSceneLayers(scene)
    this.domContent.sync(layers, getLayerContainers(layers), getHtmlHostOrder(layers))
    this.domContent.copyPending()
    return layers
  }

  /** Returns GPU state for a scene-attached HTML node. */
  getSceneHtmlEntry(html: Html): SceneHtmlEntry | null {
    return this.domContent.getSceneHtmlEntry(html)
  }

  /** Returns the storage-buffer range for a glass node's attached HTML. */
  getGlassContentRange(glass: Glass): GlassContentRange | null {
    return this.domContent.getGlassContentRange(glass)
  }

  /** Removes DOM hosts and destroys GPU resources owned by this content source. */
  destroy() {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.targetCanvas.removeEventListener('paint', this.handlePaintEvent as EventListener)
    this.domContent.destroy()
  }
}
