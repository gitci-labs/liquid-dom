import { composeTransform, identityMatrix, multiplyMatrices, type Matrix2D } from './matrix'
import type { Point, RgbaColor, SurfaceProfile, Transform } from './types'

/**
 * Constructor options for a {@link Glass} node.
 */
export type GlassInit = Partial<Transform> & {
  width?: number
  height?: number
  cornerRadius?: number
  cornerTransitionSpeed?: number
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
  dispersion?: number
  surfaceProfile?: SurfaceProfile
  lightDirection?: number
  specularStrength?: number
  specularWidth?: number
  specularSharpness?: number
  specularOpacity?: number
  edgeSaturation?: number
  reflectionOffset?: number
  reflectionSaturation?: number
  tint?: RgbaColor
  zIndex?: number
}

/**
 * Constructor options for a {@link Group}.
 */
export type GroupInit = Partial<Transform>

type SceneChild = Container | Group
type GroupChild = Container | Group

type ParentNode = Scene | Group | Container

type TraversedContainer = {
  container: Container
  transform: Matrix2D
  traversalIndex: number
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
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

function removeFromParent(node: { _parent: ParentNode | null }) {
  const parent = node._parent
  if (!parent) {
    return
  }

  if (parent instanceof Scene || parent instanceof Group) {
    parent._children = parent._children.filter((child) => child !== node)
  } else {
    parent._children = parent._children.filter((child) => child !== node)
  }

  node._parent = null
}

function ensureNoCycle(parent: Group, child: Group) {
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

/**
 * A single rounded glass shape inside a {@link Container}.
 */
export class Glass implements Transform {
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

  /** Shape width in CSS pixels. */
  width = 0
  /** Shape height in CSS pixels. */
  height = 0
  /** Corner radius in CSS pixels. */
  cornerRadius = 0
  /** Controls the blend from squircle-like corners toward circular corners. */
  cornerTransitionSpeed = 120

  _parent: Container | null = null

  /**
   * Creates a glass shape descriptor.
   */
  constructor(options: GlassInit = {}) {
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
  }

  /**
   * Detaches this glass from its parent container, if attached.
   */
  remove() {
    removeFromParent(this)
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
  /** Strength of RGB channel separation applied to refraction. */
  dispersion = 0
  /** Surface profile used for the beveled edge. */
  surfaceProfile: SurfaceProfile = 'convex'
  /** 2D light direction in radians. */
  lightDirection = toRadians(-52)
  /** Multiplier applied to the white specular term. */
  specularStrength = 1.4
  /** Width of the specular band in CSS pixels. */
  specularWidth = 0.3
  /** Exponent controlling specular falloff. */
  specularSharpness = 2
  /** Final opacity of the white specular contribution. */
  specularOpacity = 0.15
  /** Saturation multiplier for the colored edge/refraction component. */
  edgeSaturation = 1.7
  /** Offset in CSS pixels used when sampling the reflection color. */
  reflectionOffset = 18
  /** Saturation multiplier for the reflection component. */
  reflectionSaturation = 0.7
  /** RGBA tint color layered over the refracted glass interior. */
  tint: RgbaColor = { r: 0.15, g: 0.15, b: 0.15, a: 0.7 }
  /** Draw order among containers; higher values render later. */
  zIndex = 0

  _parent: Scene | Group | null = null
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
    if (options.specularSharpness !== undefined) {
      this.specularSharpness = options.specularSharpness
    }
    if (options.specularOpacity !== undefined) {
      this.specularOpacity = options.specularOpacity
    }
    if (options.edgeSaturation !== undefined) {
      this.edgeSaturation = options.edgeSaturation
    }
    if (options.reflectionOffset !== undefined) {
      this.reflectionOffset = options.reflectionOffset
    }
    if (options.reflectionSaturation !== undefined) {
      this.reflectionSaturation = options.reflectionSaturation
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
 * A transform-only hierarchy node used to organize containers and nested groups.
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

  _parent: Scene | Group | null = null
  _children: GroupChild[] = []

  /**
   * Creates a transform-only group node.
   */
  constructor(options: GroupInit = {}) {
    applyTransformDefaults(this, options)
  }

  /**
   * Adds a container or nested group, reparenting it if needed.
   * Throws if doing so would create a cycle.
   */
  add(child: Container | Group) {
    if (child instanceof Group) {
      ensureNoCycle(this, child)
    }

    removeFromParent(child)
    this._children.push(child)
    child._parent = this
    return child
  }

  /**
   * Detaches this group from its parent scene or group, if attached.
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

  /**
   * Adds a container or group to the scene, reparenting it if needed.
   * Throws if doing so would create a cycle.
   */
  add(child: Container | Group) {
    if (child instanceof Group) {
      let current: ParentNode | null = this
      while (current) {
        if (current === child) {
          throw new Error('A Group cannot be added to one of its descendants.')
        }
        current = '_parent' in current ? current._parent : null
      }
    }

    removeFromParent(child)
    this._children.push(child)
    child._parent = this
    return child
  }
}

/**
 * Flattens the scene hierarchy into renderable containers with composed world transforms.
 */
export function flattenContainers(scene: Scene): TraversedContainer[] {
  const result: TraversedContainer[] = []

  function visit(children: SceneChild[], parentTransform: Matrix2D) {
    for (const child of children) {
      const nextTransform = multiplyMatrices(parentTransform, composeTransform(child))
      if (child instanceof Group) {
        visit(child._children, nextTransform)
        continue
      }

      result.push({
        container: child,
        transform: nextTransform,
        traversalIndex: result.length,
      })
    }
  }

  visit(scene._children, identityMatrix())
  return result
}
