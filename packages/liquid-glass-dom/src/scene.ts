import type { GlassPointerEvent, GlassPointerEventType } from './events'
import { composeTransform, identityMatrix, multiplyMatrices, type Matrix2D } from './matrix'
import type { Point, RgbaColor, SpecularWidth, SurfaceProfile, Transform } from './types'

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
  displacementBlur?: number
  normalDivergenceBlendPower?: number
  normalDivergenceBlendEnabled?: boolean
  ior?: number
  contentIor?: number
  contentDepth?: number
  dispersion?: number
  surfaceProfile?: SurfaceProfile
  lightDirection?: number
  specularStrength?: number
  specularWidth?: SpecularWidth
  specularFalloff?: number
  oppositeSpecularStrength?: number
  specularSharpness?: number
  specularOpacity?: number
  reflectionOffset?: number
  tint?: RgbaColor
  shadowColor?: RgbaColor
  shadowOffsetX?: number
  shadowOffsetY?: number
  shadowBlur?: number
  shadowSpread?: number
  debugDisplacement?: boolean
  zIndex?: number
}

/**
 * Constructor options for a {@link Group}.
 */
export type GroupInit = Partial<Transform>

/**
 * Constructor options for a {@link StackingContext}.
 */
export type StackingContextInit = GroupInit & {
  zIndex?: number
}

type SceneChild = Container | Html | Group
type RenderSceneChild = Container | Html
type ContainerChild = Glass | Group
type GlassChild = Html | Group
type GroupChild = Container | Glass | Html | Group
type ParentNode = Scene | Container | Glass | Group
type SceneMutationListener = () => void

/** Flattened container with its composed world transform and stable traversal order. */
type TraversedContainer = {
  /** Container node reached through the scene hierarchy. */
  container: Container
  /** Container transform composed with any ancestor groups. */
  transform: Matrix2D
  /** Stable preorder index among flattened containers. */
  traversalIndex: number
}

/** Flattened scene render layer with its composed world transform and stable traversal order. */
export type TraversedSceneLayer = {
  /** Renderable scene node reached through the scene hierarchy. */
  child: RenderSceneChild
  /** Scene-layer transform composed with any ancestor groups. */
  transform: Matrix2D
  /** Stable preorder index among flattened scene layers. */
  traversalIndex: number
}

/** Flattened glass child with its transform relative to the owning container. */
export type TraversedGlass = {
  /** Glass node reached through the container hierarchy. */
  glass: Glass
  /** Glass transform composed with any ancestor groups inside the container. */
  transform: Matrix2D
  /** Stable preorder index among flattened glass nodes. */
  traversalIndex: number
}

/** Flattened HTML child with its transform relative to the owning glass. */
export type TraversedHtml = {
  /** HTML node reached through the glass hierarchy. */
  html: Html
  /** HTML transform composed with any ancestor groups inside the glass. */
  transform: Matrix2D
  /** Stable preorder index among flattened glass HTML nodes. */
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

  parent._children = parent._children.filter((child) => child !== node)

  node._parent = null
  scene?._notifyMutation()
}

/** Throws when adding a group under the target parent would create a scene graph cycle. */
function ensureNoCycle(parent: ParentNode, child: Group) {
  if (parent === child) {
    throw new Error('A Group cannot be added to itself.')
  }

  let current: ParentNode | null = parent
  while (current) {
    if (current === child) {
      throw new Error('A Group cannot be added to one of its descendants.')
    }
    current = '_parent' in current ? current._parent : null
  }
}

/** Returns the nearest non-group parent that defines what child node types a group may contain. */
function getGroupContext(parent: ParentNode | null): Scene | Container | Glass | null {
  let current = parent
  while (current instanceof Group) {
    current = current._parent
  }

  return current
}

/** Throws when a child cannot be inserted in a group for the provided parent context. */
function validateGroupChildForContext(child: GroupChild, context: Scene | Container | Glass | null) {
  if (!context || child instanceof Group) {
    return
  }

  if (context instanceof Scene && (child instanceof Container || child instanceof Html)) {
    return
  }
  if (context instanceof Container && child instanceof Glass) {
    return
  }
  if (context instanceof Glass && child instanceof Html) {
    return
  }

  throw new Error('A Group child must match the node type accepted by its nearest non-group parent.')
}

/** Recursively validates all descendants of a group against the provided parent context. */
function validateGroupForContext(group: Group, context: Scene | Container | Glass | null) {
  for (const child of group._children) {
    validateGroupChildForContext(child, context)
    if (child instanceof Group) {
      validateGroupForContext(child, context)
    }
  }
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
  _parent: Scene | Glass | Group | null = null

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

  _parent: Container | Group | null = null
  _children: GlassChild[] = []

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

  /** Adds an HTML child or transform-only group to this glass, reparenting it if needed. */
  add<T extends GlassChild>(child: T): T {
    if (child instanceof Group) {
      ensureNoCycle(this, child)
      validateGroupForContext(child, this)
    }

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
  /** Blur radius applied to the precomputed displacement field in CSS pixels. */
  displacementBlur = 4
  /**
   * Exponent shaping SDF smooth-union normal gating.
   * Higher values suppress blending longer as boundary normals diverge.
   */
  normalDivergenceBlendPower = 0.5
  /** Enables normal-based suppression of SDF smooth-union blending. */
  normalDivergenceBlendEnabled = true
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
  /** Width of the specular band. Numeric values are CSS pixels; `'hairline'` is one device pixel. */
  specularWidth: SpecularWidth = 'hairline'
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
  /** RGBA color used by the container's drop shadow. Alpha `0` disables shadows. */
  shadowColor: RgbaColor = { r: 0, g: 0, b: 0, a: 0 }
  /** Horizontal drop shadow offset in CSS pixels. */
  shadowOffsetX = 0
  /** Vertical drop shadow offset in CSS pixels. */
  shadowOffsetY = 0
  /** Drop shadow blur radius in CSS pixels. */
  shadowBlur = 0
  /** Drop shadow spread in CSS pixels. Positive values expand the silhouette. */
  shadowSpread = 0
  /** Renders the calculated displacement field instead of the shaded glass. */
  debugDisplacement = false
  /** Draw order among scene layers; higher values render later. */
  zIndex = 0

  _parent: Scene | Group | null = null
  _children: ContainerChild[] = []

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
    if (options.displacementBlur !== undefined) {
      this.displacementBlur = options.displacementBlur
    }
    if (options.normalDivergenceBlendPower !== undefined) {
      this.normalDivergenceBlendPower = options.normalDivergenceBlendPower
    }
    if (options.normalDivergenceBlendEnabled !== undefined) {
      this.normalDivergenceBlendEnabled = options.normalDivergenceBlendEnabled
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
    if (options.shadowColor !== undefined) {
      this.shadowColor = cloneColor(options.shadowColor)
    }
    if (options.shadowOffsetX !== undefined) {
      this.shadowOffsetX = options.shadowOffsetX
    }
    if (options.shadowOffsetY !== undefined) {
      this.shadowOffsetY = options.shadowOffsetY
    }
    if (options.shadowBlur !== undefined) {
      this.shadowBlur = options.shadowBlur
    }
    if (options.shadowSpread !== undefined) {
      this.shadowSpread = options.shadowSpread
    }
    if (options.debugDisplacement !== undefined) {
      this.debugDisplacement = options.debugDisplacement
    }
    if (options.zIndex !== undefined) {
      this.zIndex = options.zIndex
    }
  }

  /**
   * Adds a glass shape or transform-only group to this container, reparenting it if needed.
   */
  add<T extends ContainerChild>(child: T): T {
    if (child instanceof Group) {
      ensureNoCycle(this, child)
      validateGroupForContext(child, this)
    }

    removeFromParent(child)
    this._children.push(child)
    child._parent = this
    notifySceneMutation(child)
    return child
  }

  /**
   * Detaches this container from its parent scene or group, if attached.
   */
  remove() {
    removeFromParent(this)
  }
}

/**
 * A transform-only hierarchy node that can be inserted anywhere in the scene graph.
 */
export class Group implements Transform {
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

  _parent: Scene | Container | Glass | Group | null = null
  _children: GroupChild[] = []

  /**
   * Creates a transform-only group node.
   */
  constructor(options: GroupInit = {}) {
    applyTransformDefaults(this, options)
  }

  /**
   * Adds a child node, reparenting it if needed.
   * Throws if the child type is invalid for this group's nearest non-group parent.
   */
  add<T extends GroupChild>(child: T): T {
    if (child instanceof Group) {
      ensureNoCycle(this, child)
    }

    const context = getGroupContext(this)
    validateGroupChildForContext(child, context)
    if (child instanceof Group) {
      validateGroupForContext(child, context)
    }

    removeFromParent(child)
    this._children.push(child)
    child._parent = this
    notifySceneMutation(child)
    return child
  }

  /**
   * Detaches this group from its parent, if attached.
   */
  remove() {
    removeFromParent(this)
  }
}

/**
 * A transform-only hierarchy node that creates a local z-index sorting context.
 */
export class StackingContext extends Group {
  private _zIndex = 0

  /**
   * Creates a local stacking context.
   */
  constructor(options: StackingContextInit = {}) {
    super(options)

    if (options.zIndex !== undefined) {
      this._zIndex = options.zIndex
    }
  }

  /** Draw order of this entire subtree in the nearest parent stacking context. */
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
}

/**
 * Root node for a glass scene graph.
 */
export class Scene {
  _children: SceneChild[] = []
  _listeners = new Set<SceneMutationListener>()

  /**
   * Adds a container, HTML layer, transform-only group, or stacking context to the scene.
   */
  add<T extends SceneChild>(child: T): T {
    if (child instanceof Group) {
      ensureNoCycle(this, child)
      validateGroupForContext(child, this)
    }

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
 * Flattens scene children into final paint order with group transforms composed away.
 */
export function flattenSceneLayers(scene: Scene): TraversedSceneLayer[] {
  const result: TraversedSceneLayer[] = []

  function visitContext(children: readonly GroupChild[], parentTransform: Matrix2D) {
    const order = { value: 0 }
    const items: Array<{
      child: RenderSceneChild | StackingContext
      transform: Matrix2D
      zIndex: number
      order: number
    }> = []

    collectContextItems(children, parentTransform, order, (child, transform) => {
      if (child instanceof Container || child instanceof Html) {
        items.push({
          child,
          transform,
          zIndex: child.zIndex,
          order: order.value,
        })
        order.value += 1
      }
    }, (context, transform) => {
      items.push({
        child: context,
        transform,
        zIndex: context.zIndex,
        order: order.value,
      })
      order.value += 1
    })

    items.sort((left, right) => left.zIndex - right.zIndex || left.order - right.order)

    for (const item of items) {
      if (item.child instanceof StackingContext) {
        visitContext(item.child._children, item.transform)
        continue
      }

      result.push({
        child: item.child,
        transform: item.transform,
        traversalIndex: result.length,
      })
    }
  }

  visitContext(scene._children, identityMatrix())
  return result
}

/**
 * Flattens a container's glass hierarchy into final paint order.
 */
export function flattenContainerGlasses(container: Container): TraversedGlass[] {
  const result: TraversedGlass[] = []

  function visitContext(children: readonly GroupChild[], parentTransform: Matrix2D) {
    const order = { value: 0 }
    const items: Array<{
      child: Glass | StackingContext
      transform: Matrix2D
      zIndex: number
      order: number
    }> = []

    collectContextItems(children, parentTransform, order, (child, transform) => {
      if (child instanceof Glass) {
        items.push({
          child,
          transform,
          zIndex: child.zIndex,
          order: order.value,
        })
        order.value += 1
      }
    }, (context, transform) => {
      items.push({
        child: context,
        transform,
        zIndex: context.zIndex,
        order: order.value,
      })
      order.value += 1
    })

    items.sort((left, right) => left.zIndex - right.zIndex || left.order - right.order)

    for (const item of items) {
      if (item.child instanceof StackingContext) {
        visitContext(item.child._children, item.transform)
        continue
      }

      result.push({
        glass: item.child,
        transform: item.transform,
        traversalIndex: result.length,
      })
    }
  }

  visitContext(container._children, identityMatrix())
  return result
}

/**
 * Flattens a glass node's HTML hierarchy into final paint order.
 */
export function flattenGlassHtml(glass: Glass): TraversedHtml[] {
  const result: TraversedHtml[] = []

  function visitContext(children: readonly GroupChild[], parentTransform: Matrix2D) {
    const order = { value: 0 }
    const items: Array<{
      child: Html | StackingContext
      transform: Matrix2D
      zIndex: number
      order: number
    }> = []

    collectContextItems(children, parentTransform, order, (child, transform) => {
      if (child instanceof Html) {
        items.push({
          child,
          transform,
          zIndex: child.zIndex,
          order: order.value,
        })
        order.value += 1
      }
    }, (context, transform) => {
      items.push({
        child: context,
        transform,
        zIndex: context.zIndex,
        order: order.value,
      })
      order.value += 1
    })

    items.sort((left, right) => left.zIndex - right.zIndex || left.order - right.order)

    for (const item of items) {
      if (item.child instanceof StackingContext) {
        visitContext(item.child._children, item.transform)
        continue
      }

      result.push({
        html: item.child,
        transform: item.transform,
        traversalIndex: result.length,
      })
    }
  }

  visitContext(glass._children, identityMatrix())
  return result
}

function collectContextItems(
  children: readonly GroupChild[],
  parentTransform: Matrix2D,
  order: { value: number },
  addRenderable: (child: GroupChild, transform: Matrix2D) => void,
  addContext: (context: StackingContext, transform: Matrix2D) => void,
) {
  for (const child of children) {
    const transform = multiplyMatrices(parentTransform, composeTransform(child))
    if (child instanceof StackingContext) {
      addContext(child, transform)
      continue
    }

    if (child instanceof Group) {
      collectContextItems(child._children, transform, order, addRenderable, addContext)
      continue
    }

    addRenderable(child, transform)
  }
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
