import { useEffect, useRef, useState, type PointerEvent } from 'react'

const MAX_SHAPES = 3
const GPU_BUFFER_USAGE = {
  UNIFORM: 0x40,
  COPY_DST: 0x08,
} as const

const GLASS_SHADER = /* wgsl */ `
struct Globals {
  viewport: vec4f,
  controls: vec4f,
  pointer: vec4f,
  light: vec4f,
  specularPrimary: vec4f,
  specularSecondary: vec4f,
};

struct ShapeData {
  rects: array<vec4f, ${MAX_SHAPES}>,
  shapeMeta: array<vec4f, ${MAX_SHAPES}>,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<uniform> shapes: ShapeData;

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

fn coverUv(uv: vec2f) -> vec2f {
  let viewportAspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let imageAspect = 1.6;
  if (viewportAspect > imageAspect) {
    return vec2f(uv.x, (uv.y - 0.5) * (imageAspect / viewportAspect) + 0.5);
  }
  return vec2f((uv.x - 0.5) * (viewportAspect / imageAspect) + 0.5, uv.y);
}

fn lineMask(value: f32, thickness: f32) -> f32 {
  return 1.0 - smoothstep(0.0, thickness, abs(value));
}

fn sceneBackground(uv: vec2f) -> vec3f {
  let clampedUv = clamp(uv, vec2f(0.0), vec2f(1.0));
  let top = vec3f(0.93, 0.95, 0.98);
  let bottom = vec3f(0.72, 0.78, 0.86);
  var color = mix(top, bottom, clampedUv.y);

  let warmGlowCenter = vec2f(0.2, 0.16);
  let warmGlowDistance = distance(clampedUv, warmGlowCenter);
  let warmGlow = smoothstep(0.42, 0.0, warmGlowDistance);
  color = mix(color, vec3f(1.0, 0.97, 0.94), warmGlow * 0.42);

  let coolGlowCenter = vec2f(0.78, 0.84);
  let coolGlowDistance = distance(clampedUv, coolGlowCenter);
  let coolGlow = smoothstep(0.36, 0.0, coolGlowDistance);
  color = mix(color, vec3f(0.72, 0.82, 0.98), coolGlow * 0.24);

  let gridUv = clampedUv * vec2f(4.0, 3.1) - vec2f(0.2, 0.08);
  let gridX = lineMask(fract(gridUv.x) - 0.5, 0.008);
  let gridY = lineMask(fract(gridUv.y) - 0.5, 0.008);
  let grid = max(gridX, gridY);
  color = mix(color, color * 0.78, grid * 0.18);

  let grain = (hash21(clampedUv * globals.viewport.xy * 0.35) - 0.5) * 0.04;
  return color + grain;
}

fn sampleBackground(uv: vec2f) -> vec3f {
  return sceneBackground(uv);
}

fn sampleBlur(uv: vec2f, radiusPx: f32) -> vec3f {
  let texel = 1.0 / globals.viewport.xy;
  let offsetA = texel * radiusPx * 1.3846154;
  let offsetB = texel * radiusPx * 3.2307692;

  var color = sampleBackground(uv) * 0.2270270;
  color = color + sampleBackground(uv + vec2f(offsetA.x, 0.0)) * 0.1570150;
  color = color + sampleBackground(uv - vec2f(offsetA.x, 0.0)) * 0.1570150;
  color = color + sampleBackground(uv + vec2f(0.0, offsetA.y)) * 0.1570150;
  color = color + sampleBackground(uv - vec2f(0.0, offsetA.y)) * 0.1570150;
  color = color + sampleBackground(uv + offsetB) * 0.0374900;
  color = color + sampleBackground(uv - offsetB) * 0.0374900;
  color = color + sampleBackground(uv + vec2f(offsetB.x, -offsetB.y)) * 0.0374900;
  color = color + sampleBackground(uv + vec2f(-offsetB.x, offsetB.y)) * 0.0374900;
  return color;
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
  let sceneUv = coverUv(in.uv);
  let background = sampleBackground(sceneUv);

  let distance = sceneSdf(fragCoord);
  let fillMask = 1.0 - smoothstep(0.0, 1.4, distance);
  let edgeMask = smoothstep(34.0, 0.0, abs(distance));
  let interiorMask = smoothstep(8.0, 92.0, -distance);
  let normalEdgeMask = smoothstep(globals.controls.w, 0.0, abs(distance));
  let sdfBoundaryMask = 1.0 - smoothstep(0.0, 1.2, abs(distance));

  let gradient = sdfGradient(fragCoord);
  let bevelInfluence = normalEdgeMask * 1.35;
  let normalOuter = normalize(vec3f(-gradient * bevelInfluence, 1.0));
  let normalInner = normalize(vec3f(gradient * bevelInfluence, 1.0));
  let normal = normalOuter;

  let lightDir = normalize(globals.light.xyz);
  let viewDir = vec3f(0.0, 0.0, 1.0);
  let halfVector = normalize(lightDir + viewDir);

  let distortion = globals.controls.y * edgeMask;
  let refractedUv = coverUv(in.uv + gradient * distortion / globals.viewport.xy);
  let refracted = sampleBackground(refractedUv);
  let blurred = sampleBlur(refractedUv, globals.controls.z);
  let displacementDebug = vec3f(
    gradient.x * edgeMask * 0.5 + 0.5,
    gradient.y * edgeMask * 0.5 + 0.5,
    edgeMask
  );
  let normalDebug = normalOuter * 0.5 + vec3f(0.5);

  let frostMix = mix(0.18, 0.56, interiorMask);
  var glass = mix(refracted, blurred, frostMix);
  glass = mix(glass, vec3f(0.93, 0.96, 1.0), 0.12 + 0.08 * interiorMask);

  let outerSpecularMask = smoothstep(globals.specularPrimary.y, 0.0, abs(distance));
  let innerSpecularMask = smoothstep(globals.specularSecondary.y, 0.0, abs(distance));
  let outerSpecular = pow(max(dot(normalOuter, halfVector), 0.0), globals.specularPrimary.z);
  let innerSpecular = pow(max(dot(normalInner, halfVector), 0.0), globals.specularSecondary.z);

  let borderHue = 0.5 + 0.5 * gradient.x;
  let prismaticBorder = mix(vec3f(0.48, 0.88, 0.96), vec3f(1.0, 0.73, 0.9), borderHue);
  let primarySpecularTint = mix(vec3f(1.0), prismaticBorder, globals.specularPrimary.w);
  let secondarySpecularTint = mix(vec3f(1.0), prismaticBorder, globals.specularSecondary.w);
  let borderLight =
    primarySpecularTint * outerSpecular * globals.specularPrimary.x * outerSpecularMask +
    secondarySpecularTint * innerSpecular * globals.specularSecondary.x * innerSpecularMask;

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
  distortion: number
  blur: number
  normalEdgeWidth: number
  motion: number
  lightAzimuth: number
  lightAltitude: number
  primarySpecularStrength: number
  primarySpecularWidth: number
  primarySpecularSharpness: number
  primarySpecularTint: number
  secondarySpecularStrength: number
  secondarySpecularWidth: number
  secondarySpecularSharpness: number
  secondarySpecularTint: number
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

function createDefaultControls(): RenderControls {
  return {
    unionSoftness: 56,
    distortion: 18,
    blur: 8.5,
    normalEdgeWidth: 10,
    motion: 1,
    lightAzimuth: -148,
    lightAltitude: 54,
    primarySpecularStrength: 1,
    primarySpecularWidth: 18,
    primarySpecularSharpness: 96,
    primarySpecularTint: 0,
    secondarySpecularStrength: 1,
    secondarySpecularWidth: 18,
    secondarySpecularSharpness: 96,
    secondarySpecularTint: 0,
    showSdfBoundary: false,
    showLight: false,
    lightFollowsPointer: false,
    debugView: 'final',
    shapes: [
      {
        centerX: 0.65,
        centerY: 0.49,
        halfWidth: 0.22,
        halfHeight: 0.18,
        radius: 0.1,
      },
      {
        centerX: 0.33,
        centerY: 0.44,
        halfWidth: 0.12,
        halfHeight: 0.22,
        radius: 0.16,
      },
      {
        centerX: 0.59,
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
  const azimuthOffset = (pointer.x - 0.5) * 70 * pointerInfluence
  const altitudeOffset = (pointer.y - 0.5) * -44 * pointerInfluence
  const effectiveAzimuth = controls.lightAzimuth + azimuthOffset
  const effectiveAltitude = clamp(controls.lightAltitude + altitudeOffset, 5, 85)
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

      const presentationFormat = gpuNavigator.gpu.getPreferredCanvasFormat()
      const globalsBuffer = device.createBuffer({
        size: 24 * 4,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      })

      const shapesBuffer = device.createBuffer({
        size: MAX_SHAPES * 4 * 4 * 2,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
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

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: globalsBuffer } },
          { binding: 1, resource: { buffer: shapesBuffer } },
        ],
      })

      const globals = new Float32Array(24)
      const startTime = performance.now()

      function resizeCanvas() {
        const bounds = targetCanvas.getBoundingClientRect()
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const nextWidth = Math.max(1, Math.round(bounds.width * dpr))
        const nextHeight = Math.max(1, Math.round(bounds.height * dpr))

        if (targetCanvas.width !== nextWidth || targetCanvas.height !== nextHeight) {
          targetCanvas.width = nextWidth
          targetCanvas.height = nextHeight
        }

        targetContext.configure({
          device,
          format: presentationFormat,
          alphaMode: 'opaque',
        })

        globals[0] = nextWidth
        globals[1] = nextHeight
        globals[2] = nextWidth
        globals[3] = nextHeight
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

        globals[4] = currentControls.unionSoftness
        globals[5] = currentControls.distortion
        globals[6] = currentControls.blur
        globals[7] = currentControls.normalEdgeWidth

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

        globals[16] = currentControls.primarySpecularStrength
        globals[17] = currentControls.primarySpecularWidth
        globals[18] = currentControls.primarySpecularSharpness
        globals[19] = currentControls.primarySpecularTint

        globals[20] = currentControls.secondarySpecularStrength
        globals[21] = currentControls.secondarySpecularWidth
        globals[22] = currentControls.secondarySpecularSharpness
        globals[23] = currentControls.secondarySpecularTint

        device.queue.writeBuffer(globalsBuffer, 0, globals)

        const encoder = device.createCommandEncoder()
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
        pass.setBindGroup(0, bindGroup)
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
    description,
    onChange,
    precision = 2,
  }: {
    label: string
    value: number
    min: number
    max: number
    step: number
    description: string
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
        <span className="glass-stage__slider-copy">{description}</span>
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
        <div className="glass-stage__controls-copy">
          <p className="glass-stage__eyebrow">WebGPU SDF Controls</p>
          <h2>Shape, fusion, frost, and light</h2>
          <p className="glass-stage__description">
            Geometry sliders move and size the rounded-rectangle SDF primitives. Fusion softens the smooth union
            between them. Optics changes the refraction offset and frosted blur sampled from the procedural
            background. Lighting uses azimuth and altitude angles to drive the normal-based specular and Fresnel
            edge response.
          </p>
        </div>

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
          <p className="glass-stage__debug-copy">
            Displacement shows the SDF-gradient-driven refraction field near the edge. Normal shows the derived
            normal map used for specular and Fresnel lighting.
          </p>
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
            description: 'Smooth-union radius used when multiple SDF shapes fuse together.',
            onChange: (value) => updateControl('unionSoftness', value),
          })}
          {renderSlider({
            label: 'Refraction',
            value: controls.distortion,
            min: 0,
            max: 40,
            step: 0.25,
            precision: 2,
            description: 'How far the background is displaced along the SDF gradient near the edge.',
            onChange: (value) => updateControl('distortion', value),
          })}
          {renderSlider({
            label: 'Frost blur',
            value: controls.blur,
            min: 0,
            max: 24,
            step: 0.25,
            precision: 2,
            description: 'Blur radius used for the soft glass interior.',
            onChange: (value) => updateControl('blur', value),
          })}
          {renderSlider({
            label: 'Normal edge',
            value: controls.normalEdgeWidth,
            min: 1,
            max: 24,
            step: 0.25,
            precision: 2,
            description: 'How tightly the normal map bends away from the viewer near the SDF edge.',
            onChange: (value) => updateControl('normalEdgeWidth', value),
          })}
          {renderSlider({
            label: 'Motion',
            value: controls.motion,
            min: 0,
            max: 1.5,
            step: 0.05,
            precision: 2,
            description: 'Scales the subtle live shape drift that keeps the union breathing.',
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
            description: 'Horizontal angle around the viewport plane. 0 faces right, -90 points upward.',
            onChange: (value) => updateControl('lightAzimuth', value),
          })}
          {renderSlider({
            label: 'Altitude',
            value: controls.lightAltitude,
            min: 5,
            max: 85,
            step: 1,
            precision: 0,
            description: 'Elevation above the surface plane. Higher values aim the light more toward the viewer.',
            onChange: (value) => updateControl('lightAltitude', value),
          })}
        </section>

        <section className="glass-stage__group">
          <h3>Specular</h3>
          {renderSlider({
            label: 'Primary strength',
            value: controls.primarySpecularStrength,
            min: 0,
            max: 2,
            step: 0.05,
            precision: 2,
            description: 'Intensity of the outer highlight lobe.',
            onChange: (value) => updateControl('primarySpecularStrength', value),
          })}
          {renderSlider({
            label: 'Primary width',
            value: controls.primarySpecularWidth,
            min: 2,
            max: 40,
            step: 0.25,
            precision: 2,
            description: 'How wide the outer highlight can spread away from the SDF boundary.',
            onChange: (value) => updateControl('primarySpecularWidth', value),
          })}
          {renderSlider({
            label: 'Primary sharpness',
            value: controls.primarySpecularSharpness,
            min: 8,
            max: 192,
            step: 1,
            precision: 0,
            description: 'Specular exponent for the outer lobe. Higher values make it tighter.',
            onChange: (value) => updateControl('primarySpecularSharpness', value),
          })}
          {renderSlider({
            label: 'Primary tint',
            value: controls.primarySpecularTint,
            min: 0,
            max: 1,
            step: 0.01,
            precision: 2,
            description: 'Blend from white to the prismatic border tint on the outer lobe.',
            onChange: (value) => updateControl('primarySpecularTint', value),
          })}
          {renderSlider({
            label: 'Secondary strength',
            value: controls.secondarySpecularStrength,
            min: 0,
            max: 2,
            step: 0.05,
            precision: 2,
            description: 'Intensity of the opposite-side internal highlight lobe.',
            onChange: (value) => updateControl('secondarySpecularStrength', value),
          })}
          {renderSlider({
            label: 'Secondary width',
            value: controls.secondarySpecularWidth,
            min: 2,
            max: 40,
            step: 0.25,
            precision: 2,
            description: 'How wide the opposite-side lobe can spread from the boundary.',
            onChange: (value) => updateControl('secondarySpecularWidth', value),
          })}
          {renderSlider({
            label: 'Secondary sharpness',
            value: controls.secondarySpecularSharpness,
            min: 8,
            max: 192,
            step: 1,
            precision: 0,
            description: 'Specular exponent for the opposite-side lobe.',
            onChange: (value) => updateControl('secondarySpecularSharpness', value),
          })}
          {renderSlider({
            label: 'Secondary tint',
            value: controls.secondarySpecularTint,
            min: 0,
            max: 1,
            step: 0.01,
            precision: 2,
            description: 'Blend from white to the prismatic border tint on the opposite-side lobe.',
            onChange: (value) => updateControl('secondarySpecularTint', value),
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
              description: 'Horizontal position as a fraction of viewport width.',
              onChange: (value) => updateShape(index, 'centerX', value),
            })}
            {renderSlider({
              label: 'Center Y',
              value: shape.centerY,
              min: 0.05,
              max: 0.95,
              step: 0.005,
              precision: 3,
              description: 'Vertical position as a fraction of viewport height.',
              onChange: (value) => updateShape(index, 'centerY', value),
            })}
            {renderSlider({
              label: 'Half width',
              value: shape.halfWidth,
              min: 0.04,
              max: 0.32,
              step: 0.005,
              precision: 3,
              description: 'Half-width of the rounded rectangle, scaled from viewport width.',
              onChange: (value) => updateShape(index, 'halfWidth', value),
            })}
            {renderSlider({
              label: 'Half height',
              value: shape.halfHeight,
              min: 0.04,
              max: 0.32,
              step: 0.005,
              precision: 3,
              description: 'Half-height of the rounded rectangle, scaled from viewport height.',
              onChange: (value) => updateShape(index, 'halfHeight', value),
            })}
            {renderSlider({
              label: 'Corner radius',
              value: shape.radius,
              min: 0.02,
              max: 0.22,
              step: 0.005,
              precision: 3,
              description: 'Radius of the rounded corners, scaled from the smaller viewport dimension.',
              onChange: (value) => updateShape(index, 'radius', value),
            })}
          </section>
        ))}
      </aside>
      {status ? <div className="glass-stage__status">{status}</div> : null}
    </div>
  )
}
