import * as sdfUtilsValues from './sdf-utils'
import type {
  BlendSupportKernelRadius as SdfUtilsBlendSupportKernelRadius,
  BlendSupportSampling as SdfUtilsBlendSupportSampling,
  BlendSupportSubmersionCurve as SdfUtilsBlendSupportSubmersionCurve,
  BoundsRect as SdfUtilsBoundsRect,
  ResolvedSmoothUnionOptions as SdfUtilsResolvedSmoothUnionOptions,
  SdfSample as SdfUtilsSdfSample,
  ShapeSubmergedAreas as SdfUtilsShapeSubmergedAreas,
  ShapeSubmersionCell as SdfUtilsShapeSubmersionCell,
  ShapeSubmersionEntry as SdfUtilsShapeSubmersionEntry,
  ShapeSubmersionGrid as SdfUtilsShapeSubmersionGrid,
  ShapeSubmersionGridValues as SdfUtilsShapeSubmersionGridValues,
  SmoothUnionOptions as SdfUtilsSmoothUnionOptions,
  TransformedShapeBounds as SdfUtilsTransformedShapeBounds,
} from './sdf-utils'

export { GlassPointerEvent } from './events'
export { Glass, Html, Container, Group, StackingContext, Scene } from './scene'
export { Renderer, WebGpuGlassCore, WebGpuDomContentSource, resolveSpecularWidthPx } from './renderer'
export {
  DEFAULT_BLEND_SUPPORT_KERNEL_RADIUS,
  DEFAULT_BLEND_SUPPORT_SAMPLING,
  DEFAULT_BLEND_SUPPORT_SUBMERSION_CURVE,
  DEFAULT_NORMAL_GATING,
  DEFAULT_SMOOTH_UNION,
  resolveBlendSupportKernelRadius,
  resolveBlendSupportSampling,
  resolveBlendSupportSubmersionCurve,
  resolveNormalGating,
  resolveSmoothUnionOptions,
} from './sdf'
export const sdfUtils = sdfUtilsValues
export namespace sdfUtils {
  export type BlendSupportKernelRadius = SdfUtilsBlendSupportKernelRadius
  export type BlendSupportSampling = SdfUtilsBlendSupportSampling
  export type BlendSupportSubmersionCurve = SdfUtilsBlendSupportSubmersionCurve
  export type BoundsRect = SdfUtilsBoundsRect
  export type ResolvedSmoothUnionOptions = SdfUtilsResolvedSmoothUnionOptions
  export type SdfSample = SdfUtilsSdfSample
  export type ShapeSubmergedAreas = SdfUtilsShapeSubmergedAreas
  export type ShapeSubmersionCell = SdfUtilsShapeSubmersionCell
  export type ShapeSubmersionEntry = SdfUtilsShapeSubmersionEntry
  export type ShapeSubmersionGrid = SdfUtilsShapeSubmersionGrid
  export type ShapeSubmersionGridValues = SdfUtilsShapeSubmersionGridValues
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
  BlendSupportKernelRadius,
  BlendSupportSampling,
  BlendSupportSubmersionCurve,
  NormalGating,
  NormalGatingOptions,
  ResolvedSmoothUnionOptions,
  ResolvedNormalGating,
  SmoothUnionOptions,
} from './sdf'
