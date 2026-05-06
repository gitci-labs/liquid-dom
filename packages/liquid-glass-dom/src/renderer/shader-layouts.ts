import { structLayout, vec4 } from './gpu-layout'

/** Uniform layout for one blur pass direction and radius. */
export const BlurParamsLayout = structLayout({
  params: vec4('directionX', 'directionY', 'radius'),
})

/** Uniform layout for canvas, material, lighting, and shape-count globals. */
export const GlobalsLayout = structLayout({
  canvas: vec4('width', 'height'),
  shape: vec4('smoothing', 'bezelWidth', 'shapeCount', 'surfaceProfile'),
  sdf: vec4('normalDivergenceBlendPower', 'normalDivergenceBlendEnabled'),
  glass: vec4('thickness', 'displacementFactor', 'ior', 'dispersion'),
  content: vec4('ior', 'depth'),
  lighting: vec4('x', 'y'),
  specular: vec4('strength', 'width', 'sharpness', 'opacity'),
  specularSecondary: vec4('oppositeStrength', 'falloff', 'reflectionOffset'),
  tint: vec4('r', 'g', 'b', 'a'),
  shadow: vec4('offsetX', 'offsetY', 'spread', 'blur'),
  shadowColor: vec4('r', 'g', 'b', 'a'),
  debug: vec4('displacement'),
})

/** Storage layout for one glass shape's inverse transform and geometry. */
export const ShapeDataLayout = structLayout({
  inverse0: vec4('a', 'c', 'e', 'minimumScale'),
  inverse1: vec4('b', 'd', 'f', 'cornerRadius'),
  geometry: vec4('halfWidth', 'halfHeight', 'cornerTransitionSpeed'),
  contentRange: vec4('start', 'count'),
})

/** Storage layout for one glass-attached HTML content atlas entry. */
export const ContentDataLayout = structLayout({
  inverse0: vec4('a', 'c', 'e', 'copiedWidth'),
  inverse1: vec4('b', 'd', 'f', 'copiedHeight'),
  atlasRect: vec4('u', 'v', 'uScale', 'vScale'),
})

/** Uniform layout for the bounds sampled by the backdrop metrics shader. */
export const BackdropMetricsBoundsLayout = structLayout({
  bounds: vec4('minX', 'minY', 'maxX', 'maxY'),
})

/** Uniform layout for compositing scene-attached HTML into the scene target. */
export const HtmlCompositeParamsLayout = structLayout({
  canvas: vec4('width', 'height', 'uScale', 'vScale'),
  inverse0: vec4('a', 'c', 'e', 'copiedWidth'),
  inverse1: vec4('b', 'd', 'f', 'copiedHeight'),
})
