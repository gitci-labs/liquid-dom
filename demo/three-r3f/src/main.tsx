import './style.css'
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three/webgpu'
import * as TSL from 'three/tsl'
import {
  Canvas,
  extend,
  useFrame,
  type ThreeToJSXElements,
} from '@react-three/fiber'
import { LiquidGlassR3F } from 'liquid-glass-r3f'
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  Transform,
  ZStack,
} from 'liquid-glass-dom/react'

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as unknown as Parameters<typeof extend>[0])

const GLASS_WIDTH = 260
const GLASS_HEIGHT = 148
const GLASS_ORIGIN = { x: GLASS_WIDTH / 2, y: GLASS_HEIGHT / 2 }

type ControlsState = {
  blur: number
  spacing: number
  distance: number
  tint: number
}

function App() {
  const [controls, setControls] = useState<ControlsState>({
    blur: 18,
    spacing: 26,
    distance: -42,
    tint: 0.34,
  })

  return (
    <LiquidGlassR3F.Root>
      <div id="app">
        <div className="scene-shell">
          <Canvas
            camera={{ position: [0, 1.2, 5], fov: 45, near: 0.1, far: 100 }}
            gl={async (props) => {
              if (props.canvas instanceof HTMLCanvasElement) {
                props.canvas.setAttribute('layoutsubtree', 'true')
              }
              const renderer = new THREE.WebGPURenderer(props as ConstructorParameters<typeof THREE.WebGPURenderer>[0])
              renderer.outputColorSpace = THREE.SRGBColorSpace
              await renderer.init()
              renderer.getContext()
              return renderer
            }}
          >
            <R3FScene />
            <LiquidGlassR3F.Render />
          </Canvas>
        </div>
        <aside id="controls">
          <h1>R3F WebGPU</h1>
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
        <LiquidGlassR3F.Scene>
          <ReactGlassScene controls={controls} />
        </LiquidGlassR3F.Scene>
      </div>
    </LiquidGlassR3F.Root>
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

function R3FScene() {
  const boxColors = [
    '#ff5c8a',
    '#43d9ad',
    '#7b61ff',
    '#ffa23a',
    '#4cc9f0',
    '#f8f32b',
    '#f15bb5',
  ]

  return (
    <>
      <color attach="background" args={['#111827']} />
      <ambientLight intensity={0.52} />
      <directionalLight color="#fff3d1" intensity={2.2} position={[2.5, 4, 3]} />
      <pointLight color="#ff4fd8" intensity={18} distance={6} position={[-2.6, 1.4, 2.2]} />
      <pointLight color="#35d6ff" intensity={16} distance={6} position={[2.4, 0.8, 1.4]} />
      <RotatingMesh name="torus" position={[0, 0.45, 0]}>
        <torusKnotGeometry args={[0.8, 0.24, 180, 24]} />
        <meshStandardNodeMaterial
          colorNode={TSL.color('#ffc857')}
          emissiveNode={TSL.color('#2c1645')}
          emissiveIntensity={0.22}
          metalness={0.38}
          roughness={0.24}
        />
      </RotatingMesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
        <planeGeometry args={[9, 9, 16, 16]} />
        <meshStandardNodeMaterial colorNode={TSL.color('#332a74')} roughness={0.68} side={THREE.DoubleSide} />
      </mesh>
      {boxColors.map((color, index) => (
        <RotatingMesh
          key={color}
          position={[(index - 3) * 0.52, -0.72, -1.7 + (index % 4) * 0.5]}
          rotation={[index * 0.22, index * 0.31, 0]}
          speed={0.4 + index * 0.04}
        >
          <boxGeometry args={[0.34, 0.34, 0.34]} />
          <meshBasicNodeMaterial colorNode={TSL.color(color)} />
        </RotatingMesh>
      ))}
    </>
  )
}

function RotatingMesh({
  children,
  speed = 0.6,
  ...props
}: React.ComponentProps<'mesh'> & { speed?: number }) {
  const ref = useRef<THREE.Mesh | null>(null)

  useFrame((_, delta) => {
    if (!ref.current) {
      return
    }
    ref.current.rotation.x += delta * speed * 0.45
    ref.current.rotation.y += delta * speed
  })

  return (
    <mesh ref={ref} {...props}>
      {children}
    </mesh>
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
          thickness={80}
          displacementFactor={0.9}
          displacementBlur={8}
          ior={1.45}
          contentDepth={4}
          tint={{ r: 0.9, g: 0.9, b: 0.9, a: controls.tint }}
          specularOpacity={0.28}
          reflectionOffset={26}
          shadowColor={{ r: 0, g: 0, b: 0, a: 0.24 }}
          shadowBlur={22}
          shadowOffsetY={12}
        >
          <ZStack alignment="center">
            <Transform x={-centerOffset} origin={GLASS_ORIGIN}>
              <DemoGlass label="R3F" detail="Scene rendered by React Three Fiber" tone="dark" />
            </Transform>
            <Transform x={centerOffset} origin={GLASS_ORIGIN}>
              <DemoGlass label="TSL" detail="WebGPU renderer with node materials" tone="light" />
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

createRoot(document.getElementById('root')!).render(<App />)
