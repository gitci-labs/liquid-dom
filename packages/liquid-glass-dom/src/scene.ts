import type { GlassPointerEvent, GlassPointerEventType } from './events'
import { composeTransform, type Matrix2D } from './matrix'
import type { Point, RgbaColor, SurfaceProfile, Transform } from './types'

/**
 * Constructor options for a {@link Html} node.
 */
export type HtmlInit = Partial<Transform> & {
  width?: number
  height?: number
  zIndex?: number
  element?: HTMLElement | null
}

/**
 * Constructor options for a {@link Glass} node.
 */
export type GlassInit = Partial<Transform> & {
  width?: number
  height?: number
  cornerRadius?: number
  cornerTransitionSpeed?: number
  pointerEvents?: boolean
  zIndex?: number
}

export interface GlassEventMap {
  click: GlassPointerEvent
  pointerenter: GlassPointerEvent
  pointerleave: GlassPointerEvent
  pointermove: GlassPointerEvent
  pointerdown: GlassPointerEvent
  pointerup: GlassPointerEvent
  pointercancel: GlassPointerEvent
}

/**
 * Constructor options for a {@link Container}.
 */
export type ContainerInit = Partial<Transform> & {
  spacing?: number
  blur?: number
  bezelWidth?: number
  thickness?: number
  displacementFactor?: number
  ior?: number
  contentIor?: number
  contentDepth?: number
  dispersion?: number
  surfaceProfile?: SurfaceProfile
  lightDirection?: number
  specularStrength?: number
  specularWidth?: number
  specularFalloff?: number
  oppositeSpecularStrength?: number
  specularSharpness?: number
  specularOpacity?: number
  reflectionOffset?: number
  tint?: RgbaColor
  zIndex?: number
}

type SceneChild = Container | Html
type ParentNode = Scene | Container | Glass
type SceneMutationListener = () => void

type TraversedContainer = {
  container: Container
  transform: Matrix2D
  traversalIndex: number
}

export type TraversedSceneLayer = {
  child: SceneChild
  transform: Matrix2D
  traversalIndex: number
}

function clonePoint(point?: Point): Point {
  return point ? { x: point.x, y: point.y } : { x: 0, y: 0 }
}

function cloneColor(color?: RgbaColor): RgbaColor {
  return color ? { r: color.r, g: color.g, b: color.b, a: color.a } : { r: 0, g: 0, b: 0, a: 0 }
}

function applyTransformDefaults(target: Transform, options: Partial<Transform> | undefined) {
  if (!options) {
    return
  }

  if (options.x !== undefined) {
    target.x = options.x
  }
  if (options.y !== undefined) {
    target.y = options.y
  }
  if (options.scaleX !== undefined) {
    target.scaleX = options.scaleX
  }
  if (options.scaleY !== undefined) {
    target.scaleY = options.scaleY
  }
  if (options.rotation !== undefined) {
    target.rotation = options.rotation
  }
  if (options.origin !== undefined) {
    target.origin = clonePoint(options.origin)
  }
}

function findScene(node: { _parent: ParentNode | null } | ParentNode | null): Scene | null {
  let current: ParentNode | null = node instanceof Scene ? node : node?._parent ?? null

  while (current) {
    if (current instanceof Scene) {
      return current
    }

    current = current._parent
  }

  return null
}

function notifySceneMutation(node: { _parent: ParentNode | null } | ParentNode | null) {
  findScene(node)?._notifyMutation()
}

function removeFromParent(node: { _parent: ParentNode | null }) {
  const parent = node._parent
  if (!parent) {
    return
  }

  const scene = findScene(node)

  if (parent instanceof Scene) {
    parent._children = parent._children.filter((child) => child !== node)
  } else if (parent instanceof Container) {
    parent._children = parent._children.filter((child) => child !== node)
  } else {
    parent._children = parent._children.filter((child) => child !== node)
  }

  node._parent = null
  scene?._notifyMutation()
}

/**
 * A DOM-backed scene node that can be layered directly in the scene or inside a glass shape.
 */
export class Html implements Transform {
  /** Horizontal translation in CSS pixels. */
  x = 0
  /** Vertical translation in CSS pixels. */
  y = 0
  /** Horizontal scale factor. */
  scaleX = 1
  /** Vertical scale factor. */
  scaleY = 1
  /** Clockwise rotation in radians. */
  rotation = 0
  /** Local-space transform origin in CSS pixels. */
  origin: Point = { x: 0, y: 0 }

  /** Host element copied by the renderer and used by the browser for hit testing. */
  readonly host: HTMLDivElement

  private _width = 0
  private _height = 0
  private _zIndex = 0
  private _element: HTMLElement | null = null
  _elementVersion = 0
  _parent: Scene | Glass | null = null

  constructor(options: HtmlInit = {}) {
    this.host = document.createElement('div')
    this.host.style.position = 'absolute'
    this.host.style.left = '0'
    this.host.style.top = '0'
    this.host.style.display = 'block'
    this.host.style.overflow = 'hidden'
    // Chrome's HTML-in-canvas copy path can capture an empty texture for scene-level
    // Html hosts when paint containment is applied here.
    this.host.style.transformOrigin = '0 0'

    applyTransformDefaults(this, options)

    if (options.width !== undefined) {
      this.width = options.width
    } else {
      this.syncHostSize()
    }
    if (options.height !== undefined) {
      this.height = options.height
    } else {
      this.syncHostSize()
    }
    if (options.zIndex !== undefined) {
      this.zIndex = options.zIndex
    }
    if (options.element !== undefined) {
      this.setElement(options.element)
    }
  }

  /** Node width in CSS pixels. */
  get width() {
    return this._width
  }

  set width(value: number) {
    if (this._width === value) {
      return
    }

    this._width = value
    this.syncHostSize()
    notifySceneMutation(this)
  }

  /** Node height in CSS pixels. */
  get height() {
    return this._height
  }

  set height(value: number) {
    if (this._height === value) {
      return
    }

    this._height = value
    this.syncHostSize()
    notifySceneMutation(this)
  }

  /** Draw order among sibling scene or glass HTML nodes. */
  get zIndex() {
    return this._zIndex
  }

  set zIndex(value: number) {
    if (this._zIndex === value) {
      return
    }

    this._zIndex = value
    notifySceneMutation(this)
  }

  /** The optional child element rendered inside this node's host. */
  get element() {
    return this._element
  }

  /** Replaces the single child element inside this node's host. */
  setElement(element: HTMLElement | null) {
    if (this._element === element) {
      return
    }

    this._element = element
    this._elementVersion += 1
    this.host.replaceChildren()
    if (element) {
      this.host.append(element)
    }
    notifySceneMutation(this)
  }

  /** Detaches this HTML node from its parent scene or glass, if attached. */
  remove() {
    removeFromParent(this)
  }

  private syncHostSize() {
    this.host.style.width = `${this._width}px`
    this.host.style.height = `${this._height}px`
  }
}

/**
 * A single rounded glass shape inside a {@link Container}.
 */
export class Glass extends EventTarget implements Transform {
  /** Horizontal translation in CSS pixels. */
  x = 0
  /** Vertical translation in CSS pixels. */
  y = 0
  /** Horizontal scale factor. */
  scaleX = 1
  /** Vertical scale factor. */
  scaleY = 1
  /** Clockwise rotation in radians. */
  rotation = 0
  /** Local-space transform origin in CSS pixels. */
  origin: Point = { x: 0, y: 0 }

  private _width = 0
  private _height = 0

  /** Shape width in CSS pixels. */
  get width() {
    return this._width
  }

  set width(value: number) {
    if (this._width === value) {
      return
    }

    this._width = value
    notifySceneMutation(this)
  }

  /** Shape height in CSS pixels. */
  get height() {
    return this._height
  }

  set height(value: number) {
    if (this._height === value) {
      return
    }

    this._height = value
    notifySceneMutation(this)
  }

  /** Corner radius in CSS pixels. */
  cornerRadius = 0
  /** Controls the blend from squircle-like corners toward circular corners. */
  cornerTransitionSpeed = 120
  private _pointerEvents = false
  private _zIndex = 0

  /** Enables renderer-side glass pointer events when set to `true`. */
  get pointerEvents() {
    return this._pointerEvents
  }

  set pointerEvents(value: boolean) {
    if (this._pointerEvents === value) {
      return
    }

    this._pointerEvents = value
    notifySceneMutation(this)
  }

  /** Draw order among sibling glass nodes in the same container. */
  get zIndex() {
    return this._zIndex
  }

  set zIndex(value: number) {
    if (this._zIndex === value) {
      return
    }

    this._zIndex = value
    notifySceneMutation(this)
  }

  _parent: Container | null = null
  _children: Html[] = []

  /**
   * Creates a glass shape descriptor.
   */
  constructor(options: GlassInit = {}) {
    super()
    applyTransformDefaults(this, options)

    if (options.width !== undefined) {
      this.width = options.width
    }
    if (options.height !== undefined) {
      this.height = options.height
    }
    if (options.cornerRadius !== undefined) {
      this.cornerRadius = options.cornerRadius
    }
    if (options.cornerTransitionSpeed !== undefined) {
      this.cornerTransitionSpeed = options.cornerTransitionSpeed
    }
    if (options.pointerEvents !== undefined) {
      this.pointerEvents = options.pointerEvents
    }
    if (options.zIndex !== undefined) {
      this.zIndex = options.zIndex
    }
  }

  /** Adds an HTML child to this glass, reparenting it if needed. */
  add(child: Html) {
    removeFromParent(child)
    this._children.push(child)
    child._parent = this
    notifySceneMutation(child)
    return child
  }

  /**
   * Detaches this glass from its parent container, if attached.
   */
  remove() {
    removeFromParent(this)
  }

  addEventListener<T extends GlassPointerEventType>(
    type: T,
    listener: ((event: GlassEventMap[T]) => void) | null,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    super.addEventListener(type, listener, options)
  }

  removeEventListener<T extends GlassPointerEventType>(
    type: T,
    listener: ((event: GlassEventMap[T]) => void) | null,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    super.removeEventListener(type, listener, options)
  }
}

/**
 * A renderable glass layer whose child {@link Glass} nodes blend into a single SDF field.
 */
export class Container implements Transform {
  /** Horizontal translation in CSS pixels. */
  x = 0
  /** Vertical translation in CSS pixels. */
  y = 0
  /** Horizontal scale factor. */
  scaleX = 1
  /** Vertical scale factor. */
  scaleY = 1
  /** Clockwise rotation in radians. */
  rotation = 0
  /** Local-space transform origin in CSS pixels. */
  origin: Point = { x: 0, y: 0 }

  /** Fusion distance used when blending neighboring shapes in CSS pixels. */
  spacing = 42.5
  /** Backdrop blur radius in CSS pixels. */
  blur = 3.75
  /** Width of the beveled edge in CSS pixels. */
  bezelWidth = 13.75
  /** Base glass thickness in CSS pixels. */
  thickness = 90
  /** Scalar applied to the physically-derived displacement amount. */
  displacementFactor = 1
  /** Refractive index used for the displacement model. */
  ior = 1.5
  /** Refractive index used when refracting DOM content rendered inside the glass. */
  contentIor = 1
  /**
   * Content-only refraction depth in CSS pixels.
   * This is used instead of {@link thickness} when calculating DOM-content refraction.
   */
  contentDepth = 0
  /** Strength of RGB channel separation applied to refraction. */
  dispersion = 0
  /** Surface profile used for the beveled edge. */
  surfaceProfile: SurfaceProfile = 'convex'
  /** 2D light direction in radians, where 0 points upward in screen space. */
  lightDirection = -Math.PI / 4
  /** Multiplier applied to the white specular term. */
  specularStrength = 1.4
  /** Width of the specular band in CSS pixels. */
  specularWidth = 0.3
  /** Amount by which specular strength falls off from the edge to the end of the band. */
  specularFalloff = 0
  /** Multiplier applied to the opposite-side white specular term. */
  oppositeSpecularStrength = 1.4
  /** Exponent controlling specular falloff. */
  specularSharpness = 2
  /** Final opacity of the white specular contribution. */
  specularOpacity = 0.15
  /** Offset in CSS pixels used when sampling the reflection color. */
  reflectionOffset = 18
  /** RGBA tint color layered over the refracted glass interior. */
  tint: RgbaColor = { r: 0.15, g: 0.15, b: 0.15, a: 0.7 }
  /** Draw order among scene layers; higher values render later. */
  zIndex = 0

  _parent: Scene | null = null
  _children: Glass[] = []

  /**
   * Creates a glass rendering layer with optical properties shared by its child shapes.
   */
  constructor(options: ContainerInit = {}) {
    applyTransformDefaults(this, options)

    if (options.spacing !== undefined) {
      this.spacing = options.spacing
    }
    if (options.blur !== undefined) {
      this.blur = options.blur
    }
    if (options.bezelWidth !== undefined) {
      this.bezelWidth = options.bezelWidth
    }
    if (options.thickness !== undefined) {
      this.thickness = options.thickness
    }
    if (options.displacementFactor !== undefined) {
      this.displacementFactor = options.displacementFactor
    }
    if (options.ior !== undefined) {
      this.ior = options.ior
    }
    if (options.contentIor !== undefined) {
      this.contentIor = options.contentIor
    }
    if (options.contentDepth !== undefined) {
      this.contentDepth = options.contentDepth
    }
    if (options.dispersion !== undefined) {
      this.dispersion = options.dispersion
    }
    if (options.surfaceProfile !== undefined) {
      this.surfaceProfile = options.surfaceProfile
    }
    if (options.lightDirection !== undefined) {
      this.lightDirection = options.lightDirection
    }
    if (options.specularStrength !== undefined) {
      this.specularStrength = options.specularStrength
    }
    if (options.specularWidth !== undefined) {
      this.specularWidth = options.specularWidth
    }
    if (options.specularFalloff !== undefined) {
      this.specularFalloff = options.specularFalloff
    }
    this.oppositeSpecularStrength = options.oppositeSpecularStrength ?? this.specularStrength
    if (options.specularSharpness !== undefined) {
      this.specularSharpness = options.specularSharpness
    }
    if (options.specularOpacity !== undefined) {
      this.specularOpacity = options.specularOpacity
    }
    if (options.reflectionOffset !== undefined) {
      this.reflectionOffset = options.reflectionOffset
    }
    if (options.tint !== undefined) {
      this.tint = cloneColor(options.tint)
    }
    if (options.zIndex !== undefined) {
      this.zIndex = options.zIndex
    }
  }

  /**
   * Adds a glass shape to this container, reparenting it if needed.
   */
  add(child: Glass) {
    removeFromParent(child)
    this._children.push(child)
    child._parent = this
    notifySceneMutation(child)
    return child
  }

  /**
   * Detaches this container from its parent scene, if attached.
   */
  remove() {
    removeFromParent(this)
  }
}

/**
 * Root node for a glass scene graph.
 */
export class Scene {
  _children: SceneChild[] = []
  _listeners = new Set<SceneMutationListener>()

  /**
   * Adds a container or HTML layer to the scene, reparenting it if needed.
   */
  add<T extends SceneChild>(child: T): T {
    removeFromParent(child)
    this._children.push(child)
    child._parent = this
    this._notifyMutation()
    return child
  }

  _subscribe(listener: SceneMutationListener) {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  _notifyMutation() {
    for (const listener of this._listeners) {
      listener()
    }
  }
}

/**
 * Flattens direct scene children into render layers with composed transforms.
 */
export function flattenSceneLayers(scene: Scene): TraversedSceneLayer[] {
  return scene._children.map((child, traversalIndex) => ({
    child,
    transform: composeTransform(child),
    traversalIndex,
  }))
}

/**
 * Flattens the scene hierarchy into renderable containers with composed world transforms.
 */
export function flattenContainers(scene: Scene): TraversedContainer[] {
  return flattenSceneLayers(scene)
    .filter((entry): entry is TraversedSceneLayer & { child: Container } => entry.child instanceof Container)
    .map((entry) => ({
      container: entry.child,
      transform: entry.transform,
      traversalIndex: entry.traversalIndex,
    }))
}
