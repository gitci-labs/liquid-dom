export { GlassPointerEvent } from './events'
export { Glass, Html, Container, Group, StackingContext, Scene } from './scene'
export { Renderer, WebGpuGlassCore, WebGpuDomContentSource, resolveSpecularWidthPx } from './renderer'
export {
  DEFAULT_NORMAL_GATING,
  SDF_EPSILON,
  aabbArea,
  aabbFromPoints,
  clamp01,
  createEmptySubmergedAreas,
  estimateCellSubmersion,
  estimateShapeCellSubmersions,
  estimateSubmergedAreaPercentagesFromBounds,
  hermiteCapGate,
  intersectBounds,
  intersectConvexPolygons,
  lerp,
  normalGateForNormals,
  polygonArea,
  polygonSignedArea,
  polygonUnionArea,
  resolveNormalGating,
  sameNormalGating,
  shapeSubmergedAreaAtCenteredLocal,
  shapeSubmergedAreaAtLocal,
  smoothUnionGatingInfo,
  smoothUnionWeight,
} from './sdf'
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
  ResolvedNormalGating,
  SdfSample,
  BoundsRect,
  ShapeSubmergedAreas,
  ShapeSubmergedAreasOf,
  ShapeSubmersionEntry,
  TransformedShapeBounds,
} from './sdf'
