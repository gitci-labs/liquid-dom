import backgroundImageUrl from '../assets/background.jpg'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

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

function createTextureFromSource(
  device: GPUDevice,
  source: ImageBitmap | HTMLCanvasElement,
  width: number,
  height: number,
) {
  const texture = device.createTexture({
    size: {
      width,
      height,
      depthOrArrayLayers: 1,
    },
    format: 'rgba8unorm',
    usage:
      GPU_TEXTURE_USAGE.TEXTURE_BINDING |
      GPU_TEXTURE_USAGE.COPY_DST |
      GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
  })

  device.queue.copyExternalImageToTexture(
    { source },
    { texture },
    {
      width,
      height,
      depthOrArrayLayers: 1,
    },
  )

  return texture
}

function createConstrainedCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxDimension: number,
) {
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create a 2D canvas for blur texture generation.')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.clearRect(0, 0, targetWidth, targetHeight)
  context.drawImage(source, 0, 0, width, height, 0, 0, targetWidth, targetHeight)

  return {
    canvas,
    width: targetWidth,
    height: targetHeight,
  }
}

async function loadImageElement(url: string) {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  return image
}

const BACKGROUND_BLIT_SHADER = /* wgsl */ `
struct Globals {
  viewport: vec4f,
  controls: vec4f,
  pointer: vec4f,
  light: vec4f,
  specular: vec4f,
  rim: vec4f,
  displacement: vec4f,
  profile: vec4f,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var backgroundSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

fn coverUv(uv: vec2f) -> vec2f {
  let viewportAspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let imageAspect = globals.viewport.z / max(globals.viewport.w, 1.0);
  let focalOffset = vec2f(0.0, -0.12);
  if (viewportAspect > imageAspect) {
    return clamp(vec2f(uv.x, (uv.y - 0.5) * (imageAspect / viewportAspect) + 0.5) + focalOffset, vec2f(0.0), vec2f(1.0));
  }
  return clamp(vec2f((uv.x - 0.5) * (viewportAspect / imageAspect) + 0.5, uv.y) + focalOffset, vec2f(0.0), vec2f(1.0));
}

fn tiledUv(uv: vec2f) -> vec2f {
  let imageSize = max(globals.viewport.zw, vec2f(1.0));
  let repeatScale = max(globals.viewport.xy / imageSize, vec2f(1.0));
  let focalOffset = vec2f(0.0, -0.12);
  return fract(uv * repeatScale + focalOffset);
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
  let imageSmallerThanViewport = globals.viewport.z < globals.viewport.x || globals.viewport.w < globals.viewport.y;
  let sourceUv = select(coverUv(in.uv), tiledUv(in.uv), imageSmallerThanViewport);
  let color = textureSampleLevel(sourceTexture, backgroundSampler, sourceUv, 0.0).rgb;
  return vec4f(color, 1.0);
}
`

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
  viewport: vec4f,
  controls: vec4f,
  pointer: vec4f,
  light: vec4f,
  specular: vec4f,
  rim: vec4f,
  displacement: vec4f,
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

fn sdRoundRect(p: vec2f, halfSize: vec2f, radius: f32) -> f32 {
  let q = abs(p) - halfSize + vec2f(radius);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
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
      distance = smin(distance, shapeDistance, globals.controls.x);
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
  let clampedUv = clamp(uv, vec2f(0.0), vec2f(1.0));
  return textureSampleLevel(backgroundTextureSharp, backgroundSampler, clampedUv, 0.0).rgb;
}

fn sampleBackgroundBlurred(uv: vec2f) -> vec3f {
  let clampedUv = clamp(uv, vec2f(0.0), vec2f(1.0));
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
  let fragCoord = in.uv * globals.viewport.xy;
  let background = sampleBackgroundSharp(in.uv);

  let distance = sceneSdf(fragCoord);
  let fillMask = 1.0 - smoothstep(0.0, 1.4, distance);
  let interiorMask = smoothstep(8.0, 92.0, -distance);
  let sdfBoundaryMask = 1.0 - smoothstep(0.0, 1.2, abs(distance));

  let gradient = sdfGradient(fragCoord);
  let pixelWidth = max(fwidth(distance), 0.75);
  let rimWidth = max(globals.specular.y, pixelWidth * 2.0);
  let rimBandMask = (1.0 - smoothstep(0.0, pixelWidth, distance)) * (1.0 - smoothstep(rimWidth, rimWidth + pixelWidth, -distance));
  let rimProgress = clamp(1.0 + distance / rimWidth, 0.0, 1.0);
  let rimProfile = rimBandMask * pow(rimProgress, 3.4);
  let rimTilt = tan(globals.rim.x);
  let rimNormal = normalize(vec3f(-gradient * rimProfile * rimTilt, 1.0));

  let lightDir = normalize(globals.light.xyz);
  let viewDir = vec3f(0.0, 0.0, 1.0);
  let halfVector = normalize(lightDir + viewDir);
  let mirroredHalfVector = normalize(vec3f(-halfVector.xy, halfVector.z));

  let bezelWidth = max(globals.displacement.x, pixelWidth * 2.0);
  let inwardDistance = max(-distance, 0.0);
  let bezelProgress = clamp(inwardDistance / bezelWidth, 0.0, 1.0);
  let profileResult = evaluateHeightProfile(globals.profile.x, bezelProgress);
  let profileHeight = profileResult.x * bezelWidth;
  let flatHeight = evaluateHeightProfile(globals.profile.x, 1.0).x * bezelWidth;
  let baseHeight = globals.displacement.y;
  let surfaceHeight = baseHeight + select(profileHeight, flatHeight, inwardDistance > bezelWidth);
  let surfaceDerivative = select(profileResult.y, 0.0, inwardDistance > bezelWidth);
  let clampedSlope = min(surfaceDerivative, tan(1.4835298));
  let surfaceNormal = normalize(vec3f(gradient * clampedSlope, 1.0));
  let refractedRay = refract(vec3f(0.0, 0.0, -1.0), surfaceNormal, 1.0 / max(globals.displacement.w, 1.0001));
  let displacementPx =
    select(
      refractedRay.xy / max(-refractedRay.z, 0.0001) * surfaceHeight * globals.displacement.z,
      vec2f(0.0),
      fillMask <= 0.0,
    );
  let refractedUv = in.uv + displacementPx / globals.viewport.xy;
  let blurred = sampleBackgroundBlurred(refractedUv);
  let displacementDebugScale = max((globals.displacement.x + globals.displacement.y) * globals.displacement.z * 0.25, 1.0);
  let displacementDebug = vec3f(
    displacementPx.x / displacementDebugScale * 0.5 + 0.5,
    displacementPx.y / displacementDebugScale * 0.5 + 0.5,
    0.0
  );
  let normalDebug = rimNormal * 0.5 + vec3f(0.5);

  var glass = blurred;
  glass = mix(glass, vec3f(0.93, 0.96, 1.0), 0.12 + 0.08 * interiorMask);

  let rimSpecular = pow(max(dot(rimNormal, halfVector), 0.0), globals.specular.z);
  let mirroredRimSpecular = pow(max(dot(rimNormal, mirroredHalfVector), 0.0), globals.specular.z);

  let borderHue = 0.5 + 0.5 * gradient.x;
  let prismaticBorder = mix(vec3f(0.48, 0.88, 0.96), vec3f(1.0, 0.73, 0.9), borderHue);
  let specularTint = mix(vec3f(1.0), prismaticBorder, globals.specular.w);
  let borderLight = specularTint * (rimSpecular + mirroredRimSpecular) * globals.specular.x * rimBandMask;

  let shadow = vec3f(0.0, 0.03, 0.08) * smoothstep(22.0, 0.0, distance - 1.0) * 0.16;

  if (globals.light.w > 0.5 && globals.light.w < 1.5) {
    return vec4f(displacementDebug, 1.0);
  }

  if (globals.light.w > 1.5) {
    return vec4f(normalDebug, 1.0);
  }

  var color = background - shadow;
  if (fillMask > 0.0) {
    color = mix(color, glass, fillMask);
    color = color + borderLight;
  }

  let grain = (hash21(fragCoord) - 0.5) * 0.015;
  color = color + grain;
  if (globals.pointer.w > 0.5) {
    color = mix(color, vec3f(1.0, 0.24, 0.18), sdfBoundaryMask);
  }
  color = pow(max(color, vec3f(0.0)), vec3f(0.95));

  return vec4f(color, 1.0);
}
`

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function easeInOutSine(value: number) {
  return -(Math.cos(Math.PI * value) - 1) * 0.5
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
  blur: number
  bezelWidth: number
  glassThickness: number
  displacementScale: number
  glassRefractiveIndex: number
  displacementProfile: 'convexSquircle' | 'concave' | 'lip'
  motion: number
  lightAzimuth: number
  lightAltitude: number
  specularStrength: number
  specularWidth: number
  rimAngle: number
  specularSharpness: number
  specularTint: number
  showSdfBoundary: boolean
  showLight: boolean
  lightFollowsPointer: boolean
  debugView: 'final' | 'displacement' | 'normal'
  shapes: ShapeSettings[]
}

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
    unionSoftness: 56,
    blur: 0,
    bezelWidth: 25,
    glassThickness: 90,
    displacementScale: 1,
    glassRefractiveIndex: 1.5,
    displacementProfile: 'convexSquircle',
    motion: 0,
    lightAzimuth: -48,
    lightAltitude: 25,
    specularStrength: 2,
    specularWidth: 10.75,
    rimAngle: 27,
    specularSharpness: 46,
    specularTint: 0,
    showSdfBoundary: false,
    showLight: false,
    lightFollowsPointer: false,
    debugView: 'final',
    shapes: [
      {
        centerX: 0.685,
        centerY: 0.515,
        halfWidth: 0.095,
        halfHeight: 0.205,
        radius: 0.07,
      },
      {
        centerX: 0.14,
        centerY: 0.19,
        halfWidth: 0.105,
        halfHeight: 0.05,
        radius: 0.04,
      },
      {
        centerX: 0.6,
        centerY: 0.72,
        halfWidth: 0.12,
        halfHeight: 0.07,
        radius: 0.07,
      },
    ],
  }
}

function resolveLightDirection(
  controls: Pick<RenderControls, 'lightAzimuth' | 'lightAltitude' | 'lightFollowsPointer'>,
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
  const effectiveAltitude = clamp(controls.lightAltitude, 5, 85)
  const effectiveAzimuthRadians = degreesToRadians(effectiveAzimuth)
  const effectiveAltitudeRadians = degreesToRadians(effectiveAltitude)

  return {
    azimuth: effectiveAzimuth,
    altitude: effectiveAltitude,
    direction: {
      x: Math.cos(effectiveAltitudeRadians) * Math.cos(effectiveAzimuthRadians),
      y: Math.cos(effectiveAltitudeRadians) * Math.sin(effectiveAzimuthRadians),
      z: Math.sin(effectiveAltitudeRadians),
    },
  }
}

function writeShapes(
  device: GPUDevice,
  buffer: GPUBuffer,
  width: number,
  height: number,
  elapsedSeconds: number,
  controls: RenderControls,
) {
  const motion = controls.motion
  const wave = easeInOutSine((Math.sin(elapsedSeconds * 0.55) + 1) * 0.5) * motion
  const sway = Math.sin(elapsedSeconds * 0.4) * motion
  const drift = Math.cos(elapsedSeconds * 0.9) * motion
  const minDimension = Math.min(width, height)
  const [shapeA, shapeB, shapeC] = controls.shapes

  const shapes: ShapeRecord[] = [
    {
      centerX: width * shapeA.centerX,
      centerY: height * (shapeA.centerY + sway * 0.012),
      halfWidth: width * (shapeA.halfWidth + 0.02 * wave),
      halfHeight: height * (shapeA.halfHeight + 0.015 * (1 - wave)),
      radius: minDimension * shapeA.radius,
      active: 1,
    },
    {
      centerX: width * (shapeB.centerX + wave * 0.08),
      centerY: height * (shapeB.centerY + drift * 0.02),
      halfWidth: width * (shapeB.halfWidth + 0.012 * (1 - wave)),
      halfHeight: height * (shapeB.halfHeight + 0.028 * wave),
      radius: minDimension * shapeB.radius,
      active: 1,
    },
    {
      centerX: width * shapeC.centerX,
      centerY: height * shapeC.centerY,
      halfWidth: width * (shapeC.halfWidth + 0.018 * motion * Math.sin(elapsedSeconds * 0.48 + 0.8)),
      halfHeight: height * shapeC.halfHeight,
      radius: minDimension * shapeC.radius,
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
  const frameRef = useRef<number | null>(null)
  const pointerRef = useRef({ x: 0.5, y: 0.5 })
  const [pointerState, setPointerState] = useState({ x: 0.5, y: 0.5 })
  const [controls, setControls] = useState<RenderControls>(() => createDefaultControls())
  const controlsRef = useRef<RenderControls>(createDefaultControls())
  const [status, setStatus] = useState('Initializing WebGPU renderer...')
  const [copyStatus, setCopyStatus] = useState('')

  useEffect(() => {
    controlsRef.current = controls
  }, [controls])

  useEffect(() => {
    let disposed = false
    let resizeObserver: ResizeObserver | null = null

    async function init() {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }
      const targetCanvas = canvas

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

      const backgroundImage = await loadImageElement(backgroundImageUrl)
      const sharpTextureSource = createConstrainedCanvas(
        backgroundImage,
        backgroundImage.naturalWidth,
        backgroundImage.naturalHeight,
        4096,
      )

      const presentationFormat = gpuNavigator.gpu.getPreferredCanvasFormat()
      const globalsBuffer = device.createBuffer({
        size: 32 * 4,
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

      const backgroundSourceTexture = createTextureFromSource(
        device,
        sharpTextureSource.canvas,
        sharpTextureSource.width,
        sharpTextureSource.height,
      )

      const backgroundSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      })

      const blitShaderModule = device.createShaderModule({ code: BACKGROUND_BLIT_SHADER })
      const blitPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: blitShaderModule,
          entryPoint: 'vertexMain',
        },
        fragment: {
          module: blitShaderModule,
          entryPoint: 'fragmentMain',
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: {
          topology: 'triangle-list',
        },
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

      const globals = new Float32Array(32)
      const blurHorizontalParams = new Float32Array(4)
      const blurVerticalParams = new Float32Array(4)
      const startTime = performance.now()
      let currentDpr = 1
      let backgroundFrameTexture: GPUTexture | null = null
      let backgroundBlurPingTexture: GPUTexture | null = null
      let backgroundBlurTexture: GPUTexture | null = null
      let backgroundBlitBindGroup: GPUBindGroup | null = null
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
          usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
        })
      }

      function rebuildRenderTargets(width: number, height: number) {
        backgroundFrameTexture?.destroy()
        backgroundBlurPingTexture?.destroy()
        backgroundBlurTexture?.destroy()

        backgroundFrameTexture = createRenderTarget(width, height)
        backgroundBlurPingTexture = createRenderTarget(width, height)
        backgroundBlurTexture = createRenderTarget(width, height)

        backgroundBlitBindGroup = device.createBindGroup({
          layout: blitPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: globalsBuffer } },
            { binding: 1, resource: backgroundSampler },
            { binding: 2, resource: backgroundSourceTexture.createView() },
          ],
        })

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
          !backgroundBlitBindGroup ||
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
        globals[2] = sharpTextureSource.width
        globals[3] = sharpTextureSource.height
      }

      function renderFrame(now: number) {
        if (disposed) {
          return
        }

        const elapsedSeconds = (now - startTime) * 0.001
        const currentControls = controlsRef.current
        const resolvedLight = resolveLightDirection(currentControls, pointerRef.current)
        resizeCanvas()
        writeShapes(device, shapesBuffer, targetCanvas.width, targetCanvas.height, elapsedSeconds, currentControls)
        const displacementProfileIndex =
          currentControls.displacementProfile === 'convexSquircle'
            ? 0
            : currentControls.displacementProfile === 'concave'
              ? 1
              : 2

        globals[4] = currentControls.unionSoftness
        globals[5] = currentControls.blur
        globals[6] = 0
        globals[7] = 0

        globals[8] = pointerRef.current.x
        globals[9] = pointerRef.current.y
        globals[10] = 0
        globals[11] = currentControls.showSdfBoundary ? 1 : 0

        globals[12] = resolvedLight.direction.x
        globals[13] = resolvedLight.direction.y
        globals[14] = resolvedLight.direction.z
        globals[15] =
          currentControls.debugView === 'displacement'
            ? 1
            : currentControls.debugView === 'normal'
              ? 2
              : 0

        globals[16] = currentControls.specularStrength
        globals[17] = currentControls.specularWidth * currentDpr
        globals[18] = currentControls.specularSharpness
        globals[19] = currentControls.specularTint

        globals[20] = degreesToRadians(clamp(currentControls.rimAngle, 0, 89.5))
        globals[21] = 0
        globals[22] = 0
        globals[23] = 0

        globals[24] = currentControls.bezelWidth * currentDpr
        globals[25] = currentControls.glassThickness
        globals[26] = currentControls.displacementScale
        globals[27] = currentControls.glassRefractiveIndex

        globals[28] = displacementProfileIndex
        globals[29] = 0
        globals[30] = 0
        globals[31] = 0

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
          !backgroundBlitBindGroup ||
          !blurHorizontalBindGroup ||
          !blurVerticalBindGroup ||
          !mainBindGroup
        ) {
          return
        }

        const blitPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
              view: backgroundFrameView,
            },
          ],
        })
        blitPass.setPipeline(blitPipeline)
        blitPass.setBindGroup(0, backgroundBlitBindGroup)
        blitPass.draw(3)
        blitPass.end()

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
        frameRef.current = requestAnimationFrame(renderFrame)
      }

      resizeObserver = new ResizeObserver(() => {
        resizeCanvas()
      })
      resizeObserver.observe(targetCanvas)

      setStatus('')
      frameRef.current = requestAnimationFrame(renderFrame)
    }

    init().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown WebGPU initialization error.'
      setStatus(message)
    })

    return () => {
      disposed = true
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
      />
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
      <aside className="glass-stage__controls">
        <div className="glass-stage__toolbar">
          <button type="button" className="glass-stage__button" onClick={handleCopySettings}>
            Copy settings
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
            label: 'Motion',
            value: controls.motion,
            min: 0,
            max: 1.5,
            step: 0.05,
            precision: 2,
            onChange: (value) => updateControl('motion', value),
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
          {renderSlider({
            label: 'Altitude',
            value: controls.lightAltitude,
            min: 5,
            max: 85,
            step: 1,
            precision: 0,
            onChange: (value) => updateControl('lightAltitude', value),
          })}
        </section>

        <section className="glass-stage__group">
          <h3>Specular</h3>
          {renderSlider({
            label: 'Strength',
            value: controls.specularStrength,
            min: 0,
            max: 2,
            step: 0.05,
            precision: 2,
            onChange: (value) => updateControl('specularStrength', value),
          })}
          {renderSlider({
            label: 'Width',
            value: controls.specularWidth,
            min: 2,
            max: 40,
            step: 0.25,
            precision: 2,
            onChange: (value) => updateControl('specularWidth', value),
          })}
          {renderSlider({
            label: 'Rim angle',
            value: controls.rimAngle,
            min: 0,
            max: 89.5,
            step: 0.5,
            precision: 1,
            onChange: (value) => updateControl('rimAngle', value),
          })}
          {renderSlider({
            label: 'Sharpness',
            value: controls.specularSharpness,
            min: 8,
            max: 192,
            step: 1,
            precision: 0,
            onChange: (value) => updateControl('specularSharpness', value),
          })}
          {renderSlider({
            label: 'Tint',
            value: controls.specularTint,
            min: 0,
            max: 1,
            step: 0.01,
            precision: 2,
            onChange: (value) => updateControl('specularTint', value),
          })}
        </section>

        {controls.shapes.map((shape, index) => (
          <section className="glass-stage__group" key={SHAPE_LABELS[index]}>
            <h3>{SHAPE_LABELS[index]}</h3>
            {renderSlider({
              label: 'Center X',
              value: shape.centerX,
              min: 0.05,
              max: 0.95,
              step: 0.005,
              precision: 3,
              onChange: (value) => updateShape(index, 'centerX', value),
            })}
            {renderSlider({
              label: 'Center Y',
              value: shape.centerY,
              min: 0.05,
              max: 0.95,
              step: 0.005,
              precision: 3,
              onChange: (value) => updateShape(index, 'centerY', value),
            })}
            {renderSlider({
              label: 'Half width',
              value: shape.halfWidth,
              min: 0.04,
              max: 0.32,
              step: 0.005,
              precision: 3,
              onChange: (value) => updateShape(index, 'halfWidth', value),
            })}
            {renderSlider({
              label: 'Half height',
              value: shape.halfHeight,
              min: 0.04,
              max: 0.32,
              step: 0.005,
              precision: 3,
              onChange: (value) => updateShape(index, 'halfHeight', value),
            })}
            {renderSlider({
              label: 'Corner radius',
              value: shape.radius,
              min: 0.02,
              max: 0.22,
              step: 0.005,
              precision: 3,
              onChange: (value) => updateShape(index, 'radius', value),
            })}
          </section>
        ))}
      </aside>
      {status ? <div className="glass-stage__status">{status}</div> : null}
    </div>
  )
}
