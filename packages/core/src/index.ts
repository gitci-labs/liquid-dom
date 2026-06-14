import * as sdfUtilsValues from './sdf-utils'
import type {
  BoundsRect as SdfUtilsBoundsRect,
  ResolvedSmoothUnionOptions as SdfUtilsResolvedSmoothUnionOptions,
  SdfSample as SdfUtilsSdfSample,
  ShapeSubmergedAreas as SdfUtilsShapeSubmergedAreas,
  ShapeSubmersionEntry as SdfUtilsShapeSubmersionEntry,
  SmoothUnionOptions as SdfUtilsSmoothUnionOptions,
  TransformedShapeBounds as SdfUtilsTransformedShapeBounds,
} from './sdf-utils'

export { GlassPointerEvent } from './events'
export { Glass, Html, Container, Group, StackingContext, Scene } from './scene'
export { Renderer, WebGpuGlassCore, WebGpuDomContentSource, resolveSpecularWidthPx } from './renderer'
export {
  DEFAULT_NORMAL_GATING,
  DEFAULT_SMOOTH_UNION,
  resolveNormalGating,
  resolveSmoothUnionOptions,
} from './sdf'
export const sdfUtils = sdfUtilsValues
export namespace sdfUtils {
  export type BoundsRect = SdfUtilsBoundsRect
  export type ResolvedSmoothUnionOptions = SdfUtilsResolvedSmoothUnionOptions
  export type SdfSample = SdfUtilsSdfSample
  export type ShapeSubmergedAreas = SdfUtilsShapeSubmergedAreas
  export type ShapeSubmersionEntry = SdfUtilsShapeSubmersionEntry
  export type SmoothUnionOptions = SdfUtilsSmoothUnionOptions
  export type TransformedShapeBounds = SdfUtilsTransformedShapeBounds
}
export type { GlassPointerEventInit, GlassPointerEventType } from './events'
export type {
  WebGpuDomContentSourceInit,
  WebGpuGlassContentSource,
  WebGpuGlassCoreInit,
  WebGpuGlassCoreRenderOptions,
} from './renderer'
export type {
  BackdropMetrics,
  Point,
  RgbaColor,
  SpecularWidth,
  SurfaceProfile,
  Transform,
} from './types'
export type {
  NormalGating,
  NormalGatingOptions,
  ResolvedSmoothUnionOptions,
  ResolvedNormalGating,
  SmoothUnionOptions,
} from './sdf'
