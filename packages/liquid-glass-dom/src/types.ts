/**
 * A 2D point in CSS pixel space.
 */
export type Point = {
  x: number
  y: number
}

/**
 * A non-premultiplied RGBA color with normalized channel values.
 */
export type RgbaColor = {
  /** Red channel in the range `0..1`. */
  r: number
  /** Green channel in the range `0..1`. */
  g: number
  /** Blue channel in the range `0..1`. */
  b: number
  /** Alpha channel in the range `0..1`. */
  a: number
}

/**
 * A local transform in the same coordinate space as normal HTML layout.
 */
export interface Transform {
  /** Horizontal translation in CSS pixels. */
  x: number
  /** Vertical translation in CSS pixels. */
  y: number
  /** Horizontal scale factor. */
  scaleX: number
  /** Vertical scale factor. */
  scaleY: number
  /** Clockwise rotation in radians. */
  rotation: number
  /** Local-space transform origin in CSS pixels. */
  origin: Point
}

/**
 * Surface profile used for the beveled glass edge.
 */
export type SurfaceProfile = 'convex' | 'concave' | 'lip'
