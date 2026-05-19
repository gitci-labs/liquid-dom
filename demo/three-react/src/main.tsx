import './style.css'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RenderTarget,
  RGBAFormat,
  Scene as ThreeScene,
  SRGBColorSpace,
  TorusKnotGeometry,
  UnsignedByteType,
  WebGPURenderer,
} from 'three/webgpu'
import { WebGpuDomContentSource } from '@liquid-dom/core'
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidScene,
  Transform,
  ZStack,
  type LiquidSceneRef,
} from '@liquid-dom/react'
import { ThreeGlassRenderer } from '@liquid-dom/three'

const GLASS_WIDTH = 260
const GLASS_HEIGHT = 148
const GLASS_ORIGIN = { x: 0.5, y: 0.5 }

type ControlsState = {
  blur: number
  spacing: number
  distance: number
  tint: number
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRootRef = useRef<LiquidSceneRef | null>(null)
  const [error, setError] = useState('')
  const [controls, setControls] = useState<ControlsState>({
    blur: 18,
    spacing: 26,
    distance: -42,
    tint: 0.34,
  })

  useThreeIntegration(canvasRef, sceneRootRef, setError)

  if (error) {
    return <main className="message">{error}</main>
  }

  return (
    <div id="app">
      <canvas ref={canvasRef} id="scene" />
      <aside id="controls">
        <h1>React + Three WebGPU</h1>
        <RangeControl
          label="Blur"
          min={0}
          max={40}
          step={0.5}
          value={controls.blur}
          onChange={(blur) => setControls((current) => ({ ...current, blur }))}
        />
        <RangeControl
          label="Spacing"
          min={-24}
          max={80}
          step={1}
          value={controls.spacing}
          onChange={(spacing) => setControls((current) => ({ ...current, spacing }))}
        />
        <RangeControl
          label="Distance"
          min={-180}
          max={180}
          step={1}
          value={controls.distance}
          onChange={(distance) => setControls((current) => ({ ...current, distance }))}
        />
        <RangeControl
          label="Tint"
          min={0}
          max={1}
          step={0.01}
          value={controls.tint}
          onChange={(tint) => setControls((current) => ({ ...current, tint }))}
        />
      </aside>
      <LiquidScene ref={sceneRootRef}>
        <ReactGlassScene controls={controls} />
      </LiquidScene>
    </div>
  )
}

function RangeControl({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label>
      <span>
        {label}
        <output>{value}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

function ReactGlassScene({ controls }: { controls: ControlsState }) {
  const centerOffset = (GLASS_WIDTH + controls.distance) / 2

  return (
    <ZStack alignment="center">
      <Frame maxWidth={Infinity} maxHeight={Infinity}>
        <GlassContainer
          blur={controls.blur}
          spacing={controls.spacing}
          bezelWidth={16}
          thickness={90}
          displacementFactor={0.9}
          displacementBlur={8}
          ior={1.45}
          contentDepth={4}
          tint={{ r: 0.9, g: 0.9, b: 0.9, a: controls.tint }}
          specularOpacity={0.5}
          reflectionOffset={26}
          shadowColor={{ r: 0, g: 0, b: 0, a: 0.24 }}
          shadowBlur={22}
          shadowOffsetY={12}
        >
          <ZStack alignment="center">
            <Transform x={-centerOffset} origin={GLASS_ORIGIN}>
              <DemoGlass label="React" detail="Layout scene from React bindings" tone="dark" />
            </Transform>
            <Transform x={centerOffset} origin={GLASS_ORIGIN}>
              <DemoGlass label="Three" detail="Backdrop rendered by WebGPU" tone="light" />
            </Transform>
          </ZStack>
        </GlassContainer>
      </Frame>
    </ZStack>
  )
}

function DemoGlass({
  label,
  detail,
  tone,
}: {
  label: string
  detail: string
  tone: 'dark' | 'light'
}) {
  return (
    <Glass cornerRadius={38}>
      <Frame width={GLASS_WIDTH} height={GLASS_HEIGHT}>
        <Html sizing="fill">
          <div className={`glass-content glass-content--${tone}`}>
            <span className="glass-content__eyebrow">Liquid glass</span>
            <strong className="glass-content__value">{label}</strong>
            <span className="glass-content__detail">{detail}</span>
          </div>
        </Html>
      </Frame>
    </Glass>
  )
}

function useThreeIntegration(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  sceneRootRef: React.RefObject<LiquidSceneRef | null>,
  setError: (message: string) => void,
) {
  useEffect(() => {
    let disposed = false
    let frameId: number | null = null
    let cleanup = () => undefined

    async function start() {
      const canvas = canvasRef.current
      const sceneRoot = sceneRootRef.current
      if (!canvas || !sceneRoot) {
        return
      }
      const sceneCanvas = canvas
      const liquidGlassRoot = sceneRoot
      if (!('gpu' in navigator)) {
        setError('This demo needs WebGPU enabled in the browser.')
        return
      }

      sceneCanvas.setAttribute('layoutsubtree', 'true')
      const renderer = new WebGPURenderer({
        canvas: sceneCanvas,
        antialias: false,
        alpha: false,
      })
      renderer.outputColorSpace = SRGBColorSpace
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      await renderer.init()
      if (disposed) {
        renderer.dispose()
        return
      }
      renderer.getContext()

      const backgroundTarget = new RenderTarget(1, 1, {
        format: RGBAFormat,
        type: UnsignedByteType,
        colorSpace: SRGBColorSpace,
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0,
      })
      backgroundTarget.texture.name = '@liquid-dom/three-react-backdrop'

      const threeScene = createThreeScene()
      const camera = new PerspectiveCamera(45, 1, 0.1, 100)
      camera.position.set(0, 1.2, 5)
      const contentSource = new WebGpuDomContentSource({
        targetCanvas: sceneCanvas,
        getCurrentDpr: () => renderer.getPixelRatio(),
        scene: liquidGlassRoot.scene,
      })
      const glass = new ThreeGlassRenderer({
        renderer,
        scene: liquidGlassRoot.scene,
        contentSource,
      })
      contentSource.setDevice(glass.device, glass.format)

      let lastCssWidth = 0
      let lastCssHeight = 0
      let lastDpr = 0
      let lastTime = performance.now()

      function resize() {
        const width = sceneCanvas.clientWidth
        const height = sceneCanvas.clientHeight
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        if (width !== lastCssWidth || height !== lastCssHeight || dpr !== lastDpr) {
          renderer.setPixelRatio(dpr)
          renderer.setSize(width, height, false)
          backgroundTarget.setSize(Math.max(1, sceneCanvas.width), Math.max(1, sceneCanvas.height))
          camera.aspect = width / Math.max(height, 1)
          camera.updateProjectionMatrix()
          lastCssWidth = width
          lastCssHeight = height
          lastDpr = dpr
        }
      }

      function frame(time: number) {
        const delta = time - lastTime
        lastTime = time
        resize()
        liquidGlassRoot.update({ width: sceneCanvas.clientWidth, height: sceneCanvas.clientHeight }, delta)
        animateThreeScene(threeScene, time)

        renderer.setRenderTarget(backgroundTarget)
        renderer.render(threeScene, camera)
        renderer.setRenderTarget(null)

        contentSource.sync()
        glass.render({
          backdrop: backgroundTarget,
          width: sceneCanvas.width,
          height: sceneCanvas.height,
          dpr: renderer.getPixelRatio(),
        })

        frameId = requestAnimationFrame(frame)
      }

      cleanup = () => {
        if (frameId !== null) {
          cancelAnimationFrame(frameId)
          frameId = null
        }
        contentSource.destroy()
        glass.destroy()
        backgroundTarget.dispose()
        renderer.dispose()
      }

      resize()
      frameId = requestAnimationFrame(frame)
    }

    void start().catch((error: unknown) => {
      console.error(error)
      setError(error instanceof Error ? error.message : 'Unable to start the demo.')
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [canvasRef, sceneRootRef, setError])
}

function createThreeScene() {
  const scene = new ThreeScene()
  scene.background = new Color(0x16142d)

  const torus = new Mesh(
    new TorusKnotGeometry(0.8, 0.24, 180, 24),
    new MeshStandardMaterial({
      color: 0xffc857,
      emissive: 0x2c1645,
      emissiveIntensity: 0.22,
      metalness: 0.38,
      roughness: 0.24,
    }),
  )
  torus.name = 'torus'
  torus.position.y = 0.45
  scene.add(torus)

  const floor = new Mesh(
    new PlaneGeometry(9, 9, 16, 16),
    new MeshStandardMaterial({
      color: 0x332a74,
      roughness: 0.68,
      side: DoubleSide,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -1
  scene.add(floor)

  const boxColors = [
    0xff5c8a,
    0x43d9ad,
    0x7b61ff,
    0xffa23a,
    0x4cc9f0,
    0xf8f32b,
    0xf15bb5,
  ]
  for (let index = 0; index < 14; index += 1) {
    const box = new Mesh(
      new BoxGeometry(0.32, 0.32, 0.32),
      new MeshStandardMaterial({
        color: boxColors[index % boxColors.length],
        emissive: boxColors[(index + 2) % boxColors.length],
        emissiveIntensity: 0.08,
        roughness: 0.42,
      }),
    )
    box.name = 'box'
    box.position.set((index - 6.5) * 0.45, -0.72, -1.7 + (index % 4) * 0.5)
    box.rotation.set(index * 0.22, index * 0.31, 0)
    scene.add(box)
  }

  scene.add(new AmbientLight(0xffffff, 0.52))
  const keyLight = new DirectionalLight(0xfff3d1, 2.2)
  keyLight.position.set(2.5, 4, 3)
  scene.add(keyLight)
  const magentaLight = new PointLight(0xff4fd8, 18, 6)
  magentaLight.position.set(-2.6, 1.4, 2.2)
  scene.add(magentaLight)
  const cyanLight = new PointLight(0x35d6ff, 16, 6)
  cyanLight.position.set(2.4, 0.8, 1.4)
  scene.add(cyanLight)

  return scene
}

function animateThreeScene(scene: ThreeScene, time: number) {
  const torus = scene.getObjectByName('torus')
  if (torus) {
    torus.rotation.x = time * 0.00035
    torus.rotation.y = time * 0.00055
  }
  const boxes = scene.children.filter((child) => child.name === 'box')
  for (let index = 0; index < boxes.length; index += 1) {
    boxes[index].rotation.y += 0.003 + index * 0.00008
  }
}

createRoot(document.getElementById('root')!).render(<App />)
