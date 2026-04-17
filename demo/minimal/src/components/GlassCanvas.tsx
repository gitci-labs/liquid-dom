import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { HtmlBackground } from './HtmlBackground'
import { hydrateStoredState, loadStoredState, saveStoredState } from './controlStorage'

const MAX_SHAPES = 3
const GPU_BUFFER_USAGE = {
  UNIFORM: 0x40,
  COPY_DST: 0x08,
} as const
const GPU_TEXTURE_USAGE = {
  TEXTURE_BINDING: 0x04,
  COPY_DST: 0x02,
  RENDER_ATTACHMENT: 0x10,
} as const

type HTMLCanvasElementWithSubtree = HTMLCanvasElement & {
  onpaint: ((event: Event) => void) | null
  requestPaint: () => void
}

type GPUQueueWithElementCopy = GPUQueue & {
  copyElementImageToTexture: (
    source: Element,
    width: number,
    height: number,
    destination: { texture: GPUTexture },
  ) => void
}

const BLUR_SHADER = /* wgsl */ `
struct BlurParams {
  direction: vec2f,
  radius: f32,
  _padding: f32,
};

@group(0) @binding(0) var blurSampler: sampler;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> blurParams: BlurParams;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );

  let position = positions[vertexIndex];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * 0.5 + 0.5;
  return output;
}

fn gaussianWeight(index: f32, sigma: f32) -> f32 {
  return exp(-0.5 * index * index / max(sigma * sigma, 0.0001));
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  let textureSize = vec2f(textureDimensions(inputTexture));
  let blurStep = blurParams.direction / max(textureSize, vec2f(1.0)) * (blurParams.radius / 4.0);
  let sigma = 2.0;
  let clampedUv = clamp(in.uv, vec2f(0.0), vec2f(1.0));

  var color = vec3f(0.0);
  var totalWeight = 0.0;

  for (var i = -4; i <= 4; i = i + 1) {
    let index = f32(i);
    let weight = gaussianWeight(index, sigma);
    let sampleUv = clamp(clampedUv + blurStep * index, vec2f(0.0), vec2f(1.0));
    color = color + textureSampleLevel(inputTexture, blurSampler, sampleUv, 0.0).rgb * weight;
    totalWeight = totalWeight + weight;
  }

  return vec4f(color / max(totalWeight, 0.0001), 1.0);
}
`

const GLASS_SHADER = /* wgsl */ `
struct Globals {
  canvas: vec4f,
  surface: vec4f,
  glass: vec4f,
  lighting: vec4f,
  specularPrimary: vec4f,
  specularSecondary: vec4f,
  profile: vec4f,
};

struct ShapeData {
  rects: array<vec4f, ${MAX_SHAPES}>,
  shapeMeta: array<vec4f, ${MAX_SHAPES}>,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<uniform> shapes: ShapeData;
@group(0) @binding(2) var backgroundSampler: sampler;
@group(0) @binding(3) var backgroundTextureSharp: texture_2d<f32>;
@group(0) @binding(4) var backgroundTextureBlurred: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

fn hash21(p: vec2f) -> f32 {
  let q = fract(p * vec2f(123.34, 456.21));
  return fract(q.x * q.y * (q.x + q.y + 19.19));
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn squircleLength(v: vec2f) -> f32 {
  let a = abs(v);
  return pow(pow(a.x, 4.0) + pow(a.y, 4.0), 0.25);
}

fn circularLength(v: vec2f) -> f32 {
  return length(v);
}

fn sdRoundRect(p: vec2f, halfSize: vec2f, radius: f32) -> f32 {
  let cornerLimit = min(halfSize.x, halfSize.y);
  let clampedRadius = min(radius, cornerLimit);
  let blendDistance = max(globals.surface.z, 0.0001);
  let circleBlend = clamp((radius - cornerLimit) / blendDistance, 0.0, 1.0);
  let q = abs(p) - halfSize + vec2f(clampedRadius);
  let cornerDistance = mix(squircleLength(max(q, vec2f(0.0))), circularLength(max(q, vec2f(0.0))), circleBlend);
  return cornerDistance + min(max(q.x, q.y), 0.0) - clampedRadius;
}

fn sceneSdf(pos: vec2f) -> f32 {
  var distance = 1e5;
  var found = false;

  for (var i = 0u; i < ${MAX_SHAPES}u; i = i + 1u) {
    let shapeMeta = shapes.shapeMeta[i];
    if (shapeMeta.w < 0.5) {
      continue;
    }

    let rect = shapes.rects[i];
    let shapeDistance = sdRoundRect(pos - rect.xy, rect.zw, shapeMeta.x);
    if (!found) {
      distance = shapeDistance;
      found = true;
    } else {
      distance = smin(distance, shapeDistance, globals.surface.x);
    }
  }

  return distance;
}

fn sdfGradient(pos: vec2f) -> vec2f {
  let eps = 1.0;
  let gradient = vec2f(
    sceneSdf(pos + vec2f(eps, 0.0)) - sceneSdf(pos - vec2f(eps, 0.0)),
    sceneSdf(pos + vec2f(0.0, eps)) - sceneSdf(pos - vec2f(0.0, eps)),
  );
  let magnitude = length(gradient);
  if (magnitude < 0.0001) {
    return vec2f(0.0, -1.0);
  }
  return gradient / magnitude;
}

fn lineMask(value: f32, thickness: f32) -> f32 {
  return 1.0 - smoothstep(0.0, thickness, abs(value));
}

fn sampleBackgroundSharp(uv: vec2f) -> vec3f {
  let clampedUv = vec2f(uv.x, 1.0 - uv.y);
  return textureSampleLevel(backgroundTextureSharp, backgroundSampler, clampedUv, 0.0).rgb;
}

fn sampleBackgroundBlurred(uv: vec2f) -> vec3f {
  let clampedUv = vec2f(uv.x, 1.0 - uv.y);
  return textureSampleLevel(backgroundTextureBlurred, backgroundSampler, clampedUv, 0.0).rgb;
}

fn smootherstep(value: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

fn smootherstepDerivative(value: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  return 30.0 * x * x * (x * (x - 2.0) + 1.0);
}

fn convexSquircle(x: f32) -> vec2f {
  let u = 1.0 - clamp(x, 0.0, 1.0);
  let inside = max(1.0 - pow(u, 4.0), 0.0001);
  let height = sqrt(inside);
  let derivative = 2.0 * pow(u, 3.0) / sqrt(inside);
  return vec2f(height, derivative);
}

fn concaveCircle(x: f32) -> vec2f {
  let squircle = convexSquircle(x);
  return vec2f(1.0 - squircle.x, -squircle.y);
}

fn evaluateHeightProfile(profileIndex: f32, x: f32) -> vec2f {
  if (profileIndex < 0.5) {
    return convexSquircle(x);
  }

  if (profileIndex < 1.5) {
    return concaveCircle(x);
  }

  let convex = convexSquircle(x);
  let concave = concaveCircle(x);
  let blend = smootherstep(x);
  let blendDerivative = smootherstepDerivative(x);
  let height = mix(convex.x, concave.x, blend);
  let derivative = mix(convex.y, concave.y, blend) + (concave.x - convex.x) * blendDerivative;
  return vec2f(height, derivative);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );

  let position = positions[vertexIndex];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * 0.5 + 0.5;
  return output;
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  let fragCoord = in.uv * globals.canvas.xy;
  let background = sampleBackgroundSharp(in.uv);

  let distance = sceneSdf(fragCoord);
  let fillMask = 1.0 - smoothstep(0.0, 1.4, distance);
  let interiorMask = smoothstep(8.0, 92.0, -distance);
  let sdfBoundaryMask = 1.0 - smoothstep(0.0, 1.2, abs(distance));

  let gradient = sdfGradient(fragCoord);
  let pixelWidth = max(fwidth(distance), 0.75);
  let rimWidth = max(globals.specularPrimary.y, 0.0001);
  let rimBandMask = (1.0 - smoothstep(0.0, pixelWidth, distance)) * (1.0 - smoothstep(rimWidth, rimWidth + pixelWidth, -distance));
  let rimNormal = gradient;
  let lightDir = normalize(select(vec2f(1.0, 0.0), globals.lighting.xy, dot(globals.lighting.xy, globals.lighting.xy) > 0.0001));
  let mirroredLightDir = -lightDir;

  let bezelWidth = max(globals.surface.w, pixelWidth * 2.0);
  let inwardDistance = max(-distance, 0.0);
  let bezelProgress = clamp(inwardDistance / bezelWidth, 0.0, 1.0);
  let profileResult = evaluateHeightProfile(globals.profile.x, bezelProgress);
  let profileHeight = profileResult.x * bezelWidth;
  let flatHeight = evaluateHeightProfile(globals.profile.x, 1.0).x * bezelWidth;
  let baseHeight = globals.glass.x;
  let surfaceHeight = baseHeight + select(profileHeight, flatHeight, inwardDistance > bezelWidth);
  let surfaceDerivative = select(profileResult.y, 0.0, inwardDistance > bezelWidth);
  let clampedSlope = min(surfaceDerivative, tan(1.4835298));
  // Build a beveled surface normal from the SDF gradient plus the chosen height profile,
  // then refract the view ray per channel to get the displaced background lookup.
  let surfaceNormal = normalize(vec3f(gradient * clampedSlope, 1.0));
  let chromaticAberration = max(globals.glass.w, 0.0);
  let baseIor = max(globals.glass.z, 1.0001);
  let refractedRayRed = refract(
    vec3f(0.0, 0.0, -1.0),
    surfaceNormal,
    1.0 / max(baseIor + chromaticAberration, 1.0001),
  );
  let refractedRayGreen = refract(vec3f(0.0, 0.0, -1.0), surfaceNormal, 1.0 / baseIor);
  let refractedRayBlue = refract(
    vec3f(0.0, 0.0, -1.0),
    surfaceNormal,
    1.0 / max(baseIor - chromaticAberration, 1.0001),
  );
  let displacementPxRed =
    select(
      refractedRayRed.xy / max(-refractedRayRed.z, 0.0001) * surfaceHeight * globals.glass.y,
      vec2f(0.0),
      fillMask <= 0.0,
    );
  let displacementPxGreen =
    select(
      refractedRayGreen.xy / max(-refractedRayGreen.z, 0.0001) * surfaceHeight * globals.glass.y,
      vec2f(0.0),
      fillMask <= 0.0,
    );
  let displacementPxBlue =
    select(
      refractedRayBlue.xy / max(-refractedRayBlue.z, 0.0001) * surfaceHeight * globals.glass.y,
      vec2f(0.0),
      fillMask <= 0.0,
    );
  let displacementPx = (displacementPxRed + displacementPxGreen + displacementPxBlue) / 3.0;
  let refractedUvRed = in.uv + displacementPxRed / globals.canvas.xy;
  let refractedUvGreen = in.uv + displacementPxGreen / globals.canvas.xy;
  let refractedUvBlue = in.uv + displacementPxBlue / globals.canvas.xy;
  let blurred = vec3f(
    sampleBackgroundBlurred(refractedUvRed).r,
    sampleBackgroundBlurred(refractedUvGreen).g,
    sampleBackgroundBlurred(refractedUvBlue).b,
  );
  let displacementDebugScale = max((globals.surface.w + globals.glass.x) * globals.glass.y * 0.25, 1.0);
  let displacementDebug = vec3f(
    displacementPx.x / displacementDebugScale * 0.5 + 0.5,
    displacementPx.y / displacementDebugScale * 0.5 + 0.5,
    0.0
  );
  let normalDebug = vec3f(rimNormal * 0.5 + vec2f(0.5), 0.5);

  // The colored edge component starts from the refracted blur and can be overdriven via
  // saturation. A second sample is taken farther out along the rim normal to fake reflection.
  let glassTint = vec3f(globals.specularSecondary.z);
  let sampledSpecularColor = blurred;
  let reflectedSpecularUv = in.uv + rimNormal * globals.specularSecondary.y / globals.canvas.xy;
  let reflectedSpecularColor = sampleBackgroundBlurred(reflectedSpecularUv);
  let glass = mix(blurred, glassTint, globals.specularSecondary.w);
  let sampledSpecularLuma = dot(sampledSpecularColor, vec3f(0.2126, 0.7152, 0.0722));
  let reflectedSpecularLuma = dot(reflectedSpecularColor, vec3f(0.2126, 0.7152, 0.0722));
  let sampledSpecularBase = vec3f(sampledSpecularLuma);
  let reflectedSpecularBase = vec3f(reflectedSpecularLuma);
  let sampledSpecularTint = mix(sampledSpecularBase, sampledSpecularColor, 1.0 + globals.specularSecondary.x);
  let reflectedSpecularTint = mix(reflectedSpecularBase, reflectedSpecularColor, 1.0 + globals.profile.y);
  // Reflection only shows when the reflected sample is bright enough and the refracted sample
  // underneath is dark enough to accept it.
  let reflectionPresence = smoothstep(0.2, 0.85, reflectedSpecularLuma);
  let refractionAcceptance = 1.0 - smoothstep(0.35, 0.85, sampledSpecularLuma);
  let reflectionBlend = reflectionPresence * refractionAcceptance;
  let edgeSpecularColor = mix(sampledSpecularTint, reflectedSpecularTint, reflectionBlend);

  // White specular is a separate rim-only highlight driven by 2D normal/light alignment and
  // then masked back to the configured rim band.
  let rimSpecular = pow(max(dot(rimNormal, lightDir), 0.0), globals.specularPrimary.z);
  let mirroredRimSpecular = pow(max(dot(rimNormal, mirroredLightDir), 0.0), globals.specularPrimary.z);
  let specularOpacity = clamp((rimSpecular + mirroredRimSpecular) * globals.specularPrimary.x, 0.0, 1.0);
  let finalSpecularOpacity = specularOpacity * globals.specularPrimary.w;
  let sampledBorderOpacity = specularOpacity * rimBandMask;
  let borderLight = vec3f(1.0) * finalSpecularOpacity * rimBandMask;

  if (globals.lighting.w > 0.5 && globals.lighting.w < 1.5) {
    return vec4f(displacementDebug, 1.0);
  }

  if (globals.lighting.w > 1.5) {
    return vec4f(normalDebug, 1.0);
  }

  var color = background;
  if (fillMask > 0.0) {
    color = mix(color, glass, fillMask);
    color = mix(color, edgeSpecularColor, sampledBorderOpacity);
    color = color + borderLight;
  }

  if (globals.lighting.z > 0.5) {
    color = mix(color, vec3f(1.0, 0.24, 0.18), sdfBoundaryMask);
  }

  return vec4f(color, 1.0);
}
`

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}

type ShapeSettings = {
  centerX: number
  centerY: number
  halfWidth: number
  halfHeight: number
  radius: number
}

type ShapeRecord = {
  centerX: number
  centerY: number
  halfWidth: number
  halfHeight: number
  radius: number
  active: number
}

type RenderControls = {
  unionSoftness: number
  cornerBlendDistance: number
  blur: number
  bezelWidth: number
  glassThickness: number
  displacementScale: number
  glassRefractiveIndex: number
  chromaticAberration: number
  displacementProfile: 'convexSquircle' | 'concave' | 'lip'
  lightAzimuth: number
  specularStrength: number
  specularWidth: number
  specularSharpness: number
  specularOpacity: number
  specularColorSaturation: number
  specularReflectionDistance: number
  specularReflectionSaturation: number
  glassTintBrightness: number
  glassTintOpacity: number
  showSdfBoundary: boolean
  showLight: boolean
  lightFollowsPointer: boolean
  debugView: 'final' | 'displacement' | 'normal'
  shapes: ShapeSettings[]
}

const CONTROL_STORAGE_KEY = 'liquid-glass-controls'
const CONTROL_PANEL_COLLAPSED_STORAGE_KEY = 'liquid-glass-controls-collapsed'
const SHAPE_LABELS = ['Primary slab', 'Orbital blob', 'Lower bridge'] as const
const DEBUG_VIEW_OPTIONS = [
  { value: 'final', label: 'Final' },
  { value: 'displacement', label: 'Displacement' },
  { value: 'normal', label: 'Normal' },
] as const
const DISPLACEMENT_PROFILE_OPTIONS = [
  { value: 'convexSquircle', label: 'Convex squircle' },
  { value: 'concave', label: 'Concave' },
  { value: 'lip', label: 'Lip' },
] as const

function createDefaultControls(): RenderControls {
  return {
    unionSoftness: 42.5,
    cornerBlendDistance: 120,
    blur: 3.75,
    bezelWidth: 13.75,
    glassThickness: 90,
    displacementScale: 1,
    glassRefractiveIndex: 1.5,
    chromaticAberration: 0,
    displacementProfile: 'convexSquircle',
    lightAzimuth: -52,
    specularStrength: 1.4,
    specularWidth: 0.3,
    specularSharpness: 2,
    specularOpacity: 0.15,
    specularColorSaturation: 1.7,
    specularReflectionDistance: 18,
    specularReflectionSaturation: 0.7,
    glassTintBrightness: 0.15,
    glassTintOpacity: 0.7,
    showSdfBoundary: false,
    showLight: false,
    lightFollowsPointer: false,
    debugView: 'displacement',
    shapes: [
      {
        centerX: 393,
        centerY: 198,
        halfWidth: 221.54,
        halfHeight: 24,
        radius: 598,
      },
      {
        centerX: 142,
        centerY: 198,
        halfWidth: 24,
        halfHeight: 24,
        radius: 266,
      },
      {
        centerX: 794,
        centerY: 694,
        halfWidth: 279.84,
        halfHeight: 80.85,
        radius: 80.85,
      },
    ],
  }
}

function loadStoredControls(): RenderControls {
  return loadStoredState(CONTROL_STORAGE_KEY, createDefaultControls())
}

function resolveLightDirection(
  controls: Pick<RenderControls, 'lightAzimuth' | 'lightFollowsPointer'>,
  pointer: { x: number; y: number },
) {
  const pointerInfluence = controls.lightFollowsPointer ? 1 : 0
  const pointerVectorX = pointer.x - 0.5
  const pointerVectorY = 0.5 - pointer.y
  const pointerMagnitude = Math.hypot(pointerVectorX, pointerVectorY)
  const pointerAzimuth =
    pointerMagnitude > 0.0001
      ? (Math.atan2(pointerVectorY, pointerVectorX) * 180) / Math.PI
      : controls.lightAzimuth
  const effectiveAzimuth = controls.lightAzimuth * (1 - pointerInfluence) + pointerAzimuth * pointerInfluence
  const effectiveAzimuthRadians = degreesToRadians(effectiveAzimuth)

  return {
    azimuth: effectiveAzimuth,
    direction: {
      x: Math.cos(effectiveAzimuthRadians),
      y: Math.sin(effectiveAzimuthRadians),
      z: 0,
    },
  }
}

function writeShapes(
  device: GPUDevice,
  buffer: GPUBuffer,
  dpr: number,
  controls: RenderControls,
) {
  const [shapeA, shapeB, shapeC] = controls.shapes

  const shapes: ShapeRecord[] = [
    {
      centerX: shapeA.centerX * dpr,
      centerY: shapeA.centerY * dpr,
      halfWidth: shapeA.halfWidth * dpr,
      halfHeight: shapeA.halfHeight * dpr,
      radius: shapeA.radius * dpr,
      active: 1,
    },
    {
      centerX: shapeB.centerX * dpr,
      centerY: shapeB.centerY * dpr,
      halfWidth: shapeB.halfWidth * dpr,
      halfHeight: shapeB.halfHeight * dpr,
      radius: shapeB.radius * dpr,
      active: 1,
    },
    {
      centerX: shapeC.centerX * dpr,
      centerY: shapeC.centerY * dpr,
      halfWidth: shapeC.halfWidth * dpr,
      halfHeight: shapeC.halfHeight * dpr,
      radius: shapeC.radius * dpr,
      active: 1,
    },
  ]

  const rectBuffer = new Float32Array(MAX_SHAPES * 4)
  const metaBuffer = new Float32Array(MAX_SHAPES * 4)

  shapes.forEach((shape, index) => {
    const rectOffset = index * 4
    rectBuffer[rectOffset + 0] = shape.centerX
    rectBuffer[rectOffset + 1] = shape.centerY
    rectBuffer[rectOffset + 2] = shape.halfWidth
    rectBuffer[rectOffset + 3] = shape.halfHeight

    const metaOffset = index * 4
    metaBuffer[metaOffset + 0] = shape.radius
    metaBuffer[metaOffset + 1] = 0
    metaBuffer[metaOffset + 2] = 0
    metaBuffer[metaOffset + 3] = shape.active
  })

  device.queue.writeBuffer(buffer, 0, rectBuffer)
  device.queue.writeBuffer(buffer, rectBuffer.byteLength, metaBuffer)
}

export function GlassCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const backgroundContentRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const pointerRef = useRef({ x: 0.5, y: 0.5 })
  const [pointerState, setPointerState] = useState({ x: 0.5, y: 0.5 })
  const [controls, setControls] = useState<RenderControls>(() => loadStoredControls())
  const [isControlsCollapsed, setIsControlsCollapsed] = useState<boolean>(() =>
    loadStoredState(CONTROL_PANEL_COLLAPSED_STORAGE_KEY, false),
  )
  const controlsRef = useRef<RenderControls>(controls)
  const [status, setStatus] = useState('Initializing WebGPU renderer...')
  const [copyStatus, setCopyStatus] = useState('')

  useEffect(() => {
    controlsRef.current = controls
  }, [controls])

  useEffect(() => {
    saveStoredState(CONTROL_STORAGE_KEY, controls)
  }, [controls])

  useEffect(() => {
    saveStoredState(CONTROL_PANEL_COLLAPSED_STORAGE_KEY, isControlsCollapsed)
  }, [isControlsCollapsed])

  useEffect(() => {
    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    let cleanupCanvas: HTMLCanvasElementWithSubtree | null = null

    async function init() {
      const canvas = canvasRef.current
      const backgroundContent = backgroundContentRef.current
      if (!canvas) {
        return
      }
      if (!backgroundContent) {
        return
      }
      const targetCanvas = canvas as HTMLCanvasElementWithSubtree
      cleanupCanvas = targetCanvas
      const backgroundElement = backgroundContent
      targetCanvas.setAttribute('layoutsubtree', 'true')

      const gpuNavigator = navigator as Navigator & { gpu?: GPU }
      if (!gpuNavigator.gpu) {
        setStatus('WebGPU is not available in this browser.')
        return
      }

      const adapter = await gpuNavigator.gpu.requestAdapter()
      if (!adapter) {
        setStatus('No compatible GPU adapter was returned.')
        return
      }

      const device = await adapter.requestDevice()
      const context = targetCanvas.getContext('webgpu') as GPUCanvasContext | null
      if (!context) {
        setStatus('Unable to acquire a WebGPU canvas context.')
        return
      }
      const targetContext = context

      const presentationFormat = gpuNavigator.gpu.getPreferredCanvasFormat()
      const globalsBuffer = device.createBuffer({
        size: 28 * 4,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      })

      const shapesBuffer = device.createBuffer({
        size: MAX_SHAPES * 4 * 4 * 2,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      })
      const blurHorizontalBuffer = device.createBuffer({
        size: 4 * 4,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      })
      const blurVerticalBuffer = device.createBuffer({
        size: 4 * 4,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      })

      const backgroundSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      })

      const blurShaderModule = device.createShaderModule({ code: BLUR_SHADER })
      const blurPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: blurShaderModule,
          entryPoint: 'vertexMain',
        },
        fragment: {
          module: blurShaderModule,
          entryPoint: 'fragmentMain',
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: {
          topology: 'triangle-list',
        },
      })

      const shaderModule = device.createShaderModule({ code: GLASS_SHADER })
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: shaderModule,
          entryPoint: 'vertexMain',
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fragmentMain',
          targets: [{ format: presentationFormat }],
        },
        primitive: {
          topology: 'triangle-list',
        },
      })

      const globals = new Float32Array(28)
      const blurHorizontalParams = new Float32Array(4)
      const blurVerticalParams = new Float32Array(4)
      let currentDpr = 1
      let backgroundFrameTexture: GPUTexture | null = null
      let backgroundBlurPingTexture: GPUTexture | null = null
      let backgroundBlurTexture: GPUTexture | null = null
      let blurHorizontalBindGroup: GPUBindGroup | null = null
      let blurVerticalBindGroup: GPUBindGroup | null = null
      let mainBindGroup: GPUBindGroup | null = null

      function createRenderTarget(width: number, height: number) {
        return device.createTexture({
          size: {
            width,
            height,
            depthOrArrayLayers: 1,
          },
          format: 'rgba8unorm',
          usage:
            GPU_TEXTURE_USAGE.TEXTURE_BINDING |
            GPU_TEXTURE_USAGE.RENDER_ATTACHMENT |
            GPU_TEXTURE_USAGE.COPY_DST,
        })
      }

      function copyBackgroundElement(width: number, height: number) {
        if (!backgroundFrameTexture) {
          return
        }

        ;(device.queue as GPUQueueWithElementCopy).copyElementImageToTexture(
          backgroundElement,
          width,
          height,
          { texture: backgroundFrameTexture },
        )
      }

      function rebuildRenderTargets(width: number, height: number) {
        backgroundFrameTexture?.destroy()
        backgroundBlurPingTexture?.destroy()
        backgroundBlurTexture?.destroy()
        backgroundFrameTexture = createRenderTarget(width, height)
        backgroundBlurPingTexture = createRenderTarget(width, height)
        backgroundBlurTexture = createRenderTarget(width, height)

        blurHorizontalBindGroup = device.createBindGroup({
          layout: blurPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: backgroundSampler },
            { binding: 1, resource: backgroundFrameTexture.createView() },
            { binding: 2, resource: { buffer: blurHorizontalBuffer } },
          ],
        })

        blurVerticalBindGroup = device.createBindGroup({
          layout: blurPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: backgroundSampler },
            { binding: 1, resource: backgroundBlurPingTexture.createView() },
            { binding: 2, resource: { buffer: blurVerticalBuffer } },
          ],
        })

        mainBindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: globalsBuffer } },
            { binding: 1, resource: { buffer: shapesBuffer } },
            { binding: 2, resource: backgroundSampler },
            { binding: 3, resource: backgroundFrameTexture.createView() },
            { binding: 4, resource: backgroundBlurTexture.createView() },
          ],
        })
      }

      function resizeCanvas() {
        const bounds = targetCanvas.getBoundingClientRect()
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        currentDpr = dpr
        const nextWidth = Math.max(1, Math.round(bounds.width * dpr))
        const nextHeight = Math.max(1, Math.round(bounds.height * dpr))

        if (
          targetCanvas.width !== nextWidth ||
          targetCanvas.height !== nextHeight ||
          !backgroundFrameTexture ||
          !backgroundBlurPingTexture ||
          !backgroundBlurTexture ||
          !blurHorizontalBindGroup ||
          !blurVerticalBindGroup ||
          !mainBindGroup
        ) {
          targetCanvas.width = nextWidth
          targetCanvas.height = nextHeight
          rebuildRenderTargets(nextWidth, nextHeight)
        }

        targetContext.configure({
          device,
          format: presentationFormat,
          alphaMode: 'opaque',
        })

        globals[0] = nextWidth
        globals[1] = nextHeight
        globals[2] = pointerRef.current.x
        globals[3] = pointerRef.current.y
      }

      targetCanvas.onpaint = () => {
        copyBackgroundElement(targetCanvas.width, targetCanvas.height)
      }

      function renderFrame() {
        if (disposed) {
          return
        }

        const currentControls = controlsRef.current
        const resolvedLight = resolveLightDirection(currentControls, pointerRef.current)
        resizeCanvas()
        writeShapes(device, shapesBuffer, currentDpr, currentControls)
        const displacementProfileIndex =
          currentControls.displacementProfile === 'convexSquircle'
            ? 0
            : currentControls.displacementProfile === 'concave'
              ? 1
              : 2

        globals[4] = currentControls.unionSoftness
        globals[5] = currentControls.blur * currentDpr
        globals[6] = currentControls.cornerBlendDistance * currentDpr
        globals[7] = currentControls.bezelWidth * currentDpr

        globals[8] = currentControls.glassThickness
        globals[9] = currentControls.displacementScale
        globals[10] = currentControls.glassRefractiveIndex
        globals[11] = currentControls.chromaticAberration

        globals[12] = resolvedLight.direction.x
        globals[13] = resolvedLight.direction.y
        globals[14] = currentControls.showSdfBoundary ? 1 : 0
        globals[15] =
          currentControls.debugView === 'displacement'
            ? 1
            : currentControls.debugView === 'normal'
              ? 2
              : 0

        globals[16] = currentControls.specularStrength
        globals[17] = currentControls.specularWidth * currentDpr
        globals[18] = currentControls.specularSharpness
        globals[19] = currentControls.specularOpacity

        globals[20] = currentControls.specularColorSaturation
        globals[21] = currentControls.specularReflectionDistance * currentDpr
        globals[22] = currentControls.glassTintBrightness
        globals[23] = currentControls.glassTintOpacity

        globals[24] = displacementProfileIndex
        globals[25] = currentControls.specularReflectionSaturation
        globals[26] = 0
        globals[27] = 0

        device.queue.writeBuffer(globalsBuffer, 0, globals)
        blurHorizontalParams[0] = 1
        blurHorizontalParams[1] = 0
        blurHorizontalParams[2] = currentControls.blur * currentDpr
        blurHorizontalParams[3] = 0
        blurVerticalParams[0] = 0
        blurVerticalParams[1] = 1
        blurVerticalParams[2] = currentControls.blur * currentDpr
        blurVerticalParams[3] = 0
        device.queue.writeBuffer(blurHorizontalBuffer, 0, blurHorizontalParams)
        device.queue.writeBuffer(blurVerticalBuffer, 0, blurVerticalParams)

        const encoder = device.createCommandEncoder()
        const backgroundFrameView = backgroundFrameTexture?.createView()
        const backgroundBlurPingView = backgroundBlurPingTexture?.createView()
        const backgroundBlurView = backgroundBlurTexture?.createView()

        if (
          !backgroundFrameView ||
          !backgroundBlurPingView ||
          !backgroundBlurView ||
          !blurHorizontalBindGroup ||
          !blurVerticalBindGroup ||
          !mainBindGroup
        ) {
          return
        }

        const blurHorizontalPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
              view: backgroundBlurPingView,
            },
          ],
        })
        blurHorizontalPass.setPipeline(blurPipeline)
        blurHorizontalPass.setBindGroup(0, blurHorizontalBindGroup)
        blurHorizontalPass.draw(3)
        blurHorizontalPass.end()

        const blurVerticalPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
              view: backgroundBlurView,
            },
          ],
        })
        blurVerticalPass.setPipeline(blurPipeline)
        blurVerticalPass.setBindGroup(0, blurVerticalBindGroup)
        blurVerticalPass.draw(3)
        blurVerticalPass.end()

        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
              view: targetContext.getCurrentTexture().createView(),
            },
          ],
        })

        pass.setPipeline(pipeline)
        pass.setBindGroup(0, mainBindGroup)
        pass.draw(3)
        pass.end()

        device.queue.submit([encoder.finish()])
        frameRef.current = requestAnimationFrame(() => renderFrame())
      }

      resizeObserver = new ResizeObserver(() => {
        resizeCanvas()
      })
      resizeObserver.observe(targetCanvas)

      setStatus('')
      targetCanvas.requestPaint()
      frameRef.current = requestAnimationFrame(() => renderFrame())
    }

    init().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown WebGPU initialization error.'
      setStatus(message)
    })

    return () => {
      disposed = true
      if (cleanupCanvas) {
        cleanupCanvas.onpaint = null
      }
      resizeObserver?.disconnect()
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }
    }
  }, [])

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const nextPointer = {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    }
    pointerRef.current = nextPointer
    setPointerState(nextPointer)
  }

  function handlePointerLeave() {
    const centeredPointer = { x: 0.5, y: 0.5 }
    pointerRef.current = centeredPointer
    setPointerState(centeredPointer)
  }

  function updateControl<Key extends Exclude<keyof RenderControls, 'shapes'>>(key: Key, value: number) {
    setControls((current) => ({
      ...current,
      [key]: value,
    }))
    setCopyStatus('')
  }

  function updateShape(index: number, key: keyof ShapeSettings, value: number) {
    setControls((current) => ({
      ...current,
      shapes: current.shapes.map((shape, shapeIndex) => {
        if (shapeIndex !== index) {
          return shape
        }

        return {
          ...shape,
          [key]: value,
        }
      }),
    }))
    setCopyStatus('')
  }

  async function handleCopySettings() {
    const payload = JSON.stringify(controls, null, 2)

    try {
      await navigator.clipboard.writeText(payload)
      setCopyStatus('Copied settings JSON.')
    } catch {
      setCopyStatus('Clipboard write failed.')
    }
  }

  async function handleApplySettingsFromClipboard() {
    try {
      const payload = await navigator.clipboard.readText()
      if (!payload.trim()) {
        setCopyStatus('Clipboard is empty.')
        return
      }

      const parsed = JSON.parse(payload)
      const nextControls = hydrateStoredState(createDefaultControls(), parsed)
      setControls(nextControls)
      setCopyStatus('Applied settings JSON from clipboard.')
    } catch (error) {
      if (error instanceof SyntaxError) {
        setCopyStatus('Clipboard does not contain valid JSON.')
        return
      }

      setCopyStatus('Clipboard read failed.')
    }
  }

  function handleResetControls() {
    setControls(createDefaultControls())
    setCopyStatus('')
  }

  function handleDebugViewChange(debugView: RenderControls['debugView']) {
    setControls((current) => ({
      ...current,
      debugView,
    }))
    setCopyStatus('')
  }

  function handleDisplacementProfileChange(displacementProfile: RenderControls['displacementProfile']) {
    setControls((current) => ({
      ...current,
      displacementProfile,
    }))
    setCopyStatus('')
  }

  function handleSdfBoundaryToggle() {
    setControls((current) => ({
      ...current,
      showSdfBoundary: !current.showSdfBoundary,
    }))
    setCopyStatus('')
  }

  function handleLightOverlayToggle() {
    setControls((current) => ({
      ...current,
      showLight: !current.showLight,
    }))
    setCopyStatus('')
  }

  function handleLightFollowToggle() {
    setControls((current) => ({
      ...current,
      lightFollowsPointer: !current.lightFollowsPointer,
    }))
    setCopyStatus('')
  }

  function handleControlsCollapseToggle() {
    setIsControlsCollapsed((current) => !current)
  }

  function renderSlider({
    label,
    value,
    min,
    max,
    step,
    onChange,
    precision = 2,
  }: {
    label: string
    value: number
    min: number
    max: number
    step: number
    onChange: (value: number) => void
    precision?: number
  }) {
    return (
      <label className="glass-stage__slider">
        <div className="glass-stage__slider-head">
          <span>{label}</span>
          <span>{value.toFixed(precision)}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
    )
  }

  const resolvedLight = resolveLightDirection(controls, pointerState)
  const effectiveLightDirection = resolvedLight.direction
  const lightDirX = effectiveLightDirection.x
  const lightDirY = effectiveLightDirection.y
  const lightMarkerX = 50 + lightDirX * 23
  const lightMarkerY = 50 + lightDirY * 23
  const lightAngle = Math.atan2(lightDirY, lightDirX)
  const lightRayLength = 18
  const lightRayCenterX = 50 + lightDirX * 11
  const lightRayCenterY = 50 + lightDirY * 11

  return (
    <div className="glass-stage">
      <canvas
        ref={canvasRef}
        className="glass-stage__canvas"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <HtmlBackground ref={backgroundContentRef} />
      </canvas>
      {controls.showLight ? (
        <div className="glass-stage__light-visual" aria-hidden="true">
          <div
            className="glass-stage__light-ray"
            style={{
              left: `${lightRayCenterX}%`,
              top: `${lightRayCenterY}%`,
              width: `${lightRayLength}%`,
              transform: `translate(-50%, -50%) rotate(${lightAngle}rad)`,
            }}
          />
          <div
            className="glass-stage__light-marker"
            style={{
              left: `${lightMarkerX}%`,
              top: `${lightMarkerY}%`,
            }}
          />
          <div className="glass-stage__light-center" />
        </div>
      ) : null}
      <aside
        className={
          isControlsCollapsed
            ? 'glass-stage__controls glass-stage__controls--collapsed'
            : 'glass-stage__controls'
        }
      >
        <div className="glass-stage__controls-header">
          <div className="glass-stage__controls-copy">
            <p className="glass-stage__eyebrow">Renderer</p>
            <h2>Controls</h2>
          </div>
          <button
            type="button"
            className="glass-stage__button glass-stage__button--ghost glass-stage__collapse-button"
            onClick={handleControlsCollapseToggle}
            aria-expanded={!isControlsCollapsed}
            aria-controls="glass-stage-controls-body"
          >
            {isControlsCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
        <div
          id="glass-stage-controls-body"
          className={
            isControlsCollapsed
              ? 'glass-stage__controls-body glass-stage__controls-body--hidden'
              : 'glass-stage__controls-body'
          }
        >
        <div className="glass-stage__toolbar">
          <button type="button" className="glass-stage__button" onClick={handleCopySettings}>
            Copy settings
          </button>
          <button type="button" className="glass-stage__button glass-stage__button--ghost" onClick={handleApplySettingsFromClipboard}>
            Apply clipboard
          </button>
          <button type="button" className="glass-stage__button glass-stage__button--ghost" onClick={handleResetControls}>
            Reset
          </button>
          {copyStatus ? <span className="glass-stage__copy-status">{copyStatus}</span> : null}
        </div>

        <section className="glass-stage__group">
          <h3>Debug view</h3>
          <button
            type="button"
            className={
              controls.showSdfBoundary
                ? 'glass-stage__toggle glass-stage__toggle--active'
                : 'glass-stage__toggle'
            }
            onClick={handleSdfBoundaryToggle}
          >
            {controls.showSdfBoundary ? 'Hide SDF boundary' : 'Show SDF boundary'}
          </button>
          <div className="glass-stage__segmented" role="tablist" aria-label="Debug view">
            {DEBUG_VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  controls.debugView === option.value
                    ? 'glass-stage__segment glass-stage__segment--active'
                    : 'glass-stage__segment'
                }
                onClick={() => handleDebugViewChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="glass-stage__group">
          <h3>Surface response</h3>
          {renderSlider({
            label: 'Union softness',
            value: controls.unionSoftness,
            min: 0,
            max: 96,
            step: 0.5,
            precision: 1,
            onChange: (value) => updateControl('unionSoftness', value),
          })}
          {renderSlider({
            label: 'Corner blend',
            value: controls.cornerBlendDistance,
            min: 1,
            max: 120,
            step: 0.25,
            precision: 2,
            onChange: (value) => updateControl('cornerBlendDistance', value),
          })}
          <div className="glass-stage__segmented" role="tablist" aria-label="Displacement profile">
            {DISPLACEMENT_PROFILE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  controls.displacementProfile === option.value
                    ? 'glass-stage__segment glass-stage__segment--active'
                    : 'glass-stage__segment'
                }
                onClick={() => handleDisplacementProfileChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {renderSlider({
            label: 'Bezel width',
            value: controls.bezelWidth,
            min: 1,
            max: 240,
            step: 0.25,
            precision: 2,
            onChange: (value) => updateControl('bezelWidth', value),
          })}
          {renderSlider({
            label: 'Frost blur',
            value: controls.blur,
            min: 0,
            max: 24,
            step: 0.25,
            precision: 2,
            onChange: (value) => updateControl('blur', value),
          })}
          {renderSlider({
            label: 'Glass thickness',
            value: controls.glassThickness,
            min: 0,
            max: 200,
            step: 0.25,
            precision: 2,
            onChange: (value) => updateControl('glassThickness', value),
          })}
          {renderSlider({
            label: 'Displacement scale',
            value: controls.displacementScale,
            min: 0,
            max: 24,
            step: 0.25,
            precision: 2,
            onChange: (value) => updateControl('displacementScale', value),
          })}
          {renderSlider({
            label: 'Glass IOR',
            value: controls.glassRefractiveIndex,
            min: 1.01,
            max: 2.2,
            step: 0.01,
            precision: 2,
            onChange: (value) => updateControl('glassRefractiveIndex', value),
          })}
          {renderSlider({
            label: 'Chromatic aberration',
            value: controls.chromaticAberration,
            min: 0,
            max: 0.4,
            step: 0.01,
            precision: 2,
            onChange: (value) => updateControl('chromaticAberration', value),
          })}
        </section>

        <section className="glass-stage__group">
          <h3>Lighting</h3>
          <button
            type="button"
            className={
              controls.showLight
                ? 'glass-stage__toggle glass-stage__toggle--active'
                : 'glass-stage__toggle'
            }
            onClick={handleLightOverlayToggle}
          >
            {controls.showLight ? 'Hide light visual' : 'Show light visual'}
          </button>
          <button
            type="button"
            className={
              controls.lightFollowsPointer
                ? 'glass-stage__toggle glass-stage__toggle--active'
                : 'glass-stage__toggle'
            }
            onClick={handleLightFollowToggle}
          >
            {controls.lightFollowsPointer ? 'Light follows mouse' : 'Light ignores mouse'}
          </button>
          {renderSlider({
            label: 'Azimuth',
            value: controls.lightAzimuth,
            min: -180,
            max: 180,
            step: 1,
            precision: 0,
            onChange: (value) => updateControl('lightAzimuth', value),
          })}
        </section>

        <section className="glass-stage__group">
          <h3>Specular</h3>
          {renderSlider({
            label: 'Strength',
            value: controls.specularStrength,
            min: 0,
            max: 20,
            step: 0.05,
            precision: 2,
            onChange: (value) => updateControl('specularStrength', value),
          })}
          {renderSlider({
            label: 'Width',
            value: controls.specularWidth,
            min: 0,
            max: 3,
            step: 0.05,
            precision: 2,
            onChange: (value) => updateControl('specularWidth', value),
          })}
          {renderSlider({
            label: 'Sharpness',
            value: controls.specularSharpness,
            min: 0,
            max: 50,
            step: 1,
            precision: 0,
            onChange: (value) => updateControl('specularSharpness', value),
          })}
          {renderSlider({
            label: 'Opacity',
            value: controls.specularOpacity,
            min: 0,
            max: 1,
            step: 0.01,
            precision: 2,
            onChange: (value) => updateControl('specularOpacity', value),
          })}
          {renderSlider({
            label: 'Color saturation',
            value: controls.specularColorSaturation,
            min: 0,
            max: 5,
            step: 0.01,
            precision: 2,
            onChange: (value) => updateControl('specularColorSaturation', value),
          })}
          {renderSlider({
            label: 'Reflection distance',
            value: controls.specularReflectionDistance,
            min: 0,
            max: 128,
            step: 1,
            precision: 0,
            onChange: (value) => updateControl('specularReflectionDistance', value),
          })}
          {renderSlider({
            label: 'Reflection saturation',
            value: controls.specularReflectionSaturation,
            min: 0,
            max: 5,
            step: 0.01,
            precision: 2,
            onChange: (value) => updateControl('specularReflectionSaturation', value),
          })}
        </section>

        <section className="glass-stage__group">
          <h3>Glass</h3>
          {renderSlider({
            label: 'Tint brightness',
            value: controls.glassTintBrightness,
            min: 0,
            max: 1,
            step: 0.01,
            precision: 2,
            onChange: (value) => updateControl('glassTintBrightness', value),
          })}
          {renderSlider({
            label: 'Tint opacity',
            value: controls.glassTintOpacity,
            min: 0,
            max: 1,
            step: 0.01,
            precision: 2,
            onChange: (value) => updateControl('glassTintOpacity', value),
          })}
        </section>

        {controls.shapes.map((shape, index) => (
          <section className="glass-stage__group" key={SHAPE_LABELS[index]}>
            <h3>{SHAPE_LABELS[index]}</h3>
            {renderSlider({
              label: 'Center X',
              value: shape.centerX,
              min: 0,
              max: 3000,
              step: 1,
              precision: 0,
              onChange: (value) => updateShape(index, 'centerX', value),
            })}
            {renderSlider({
              label: 'Center Y',
              value: shape.centerY,
              min: 0,
              max: 2000,
              step: 1,
              precision: 0,
              onChange: (value) => updateShape(index, 'centerY', value),
            })}
            {renderSlider({
              label: 'Half width',
              value: shape.halfWidth,
              min: 10,
              max: 1500,
              step: 1,
              precision: 0,
              onChange: (value) => updateShape(index, 'halfWidth', value),
            })}
            {renderSlider({
              label: 'Half height',
              value: shape.halfHeight,
              min: 10,
              max: 1000,
              step: 1,
              precision: 0,
              onChange: (value) => updateShape(index, 'halfHeight', value),
            })}
            {renderSlider({
              label: 'Corner radius',
              value: shape.radius,
              min: 1,
              max: 1000,
              step: 1,
              precision: 0,
              onChange: (value) => updateShape(index, 'radius', value),
            })}
          </section>
        ))}
        </div>
      </aside>
      {status ? <div className="glass-stage__status">{status}</div> : null}
    </div>
  )
}
