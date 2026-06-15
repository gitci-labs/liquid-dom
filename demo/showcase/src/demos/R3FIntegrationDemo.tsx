import { useRef, useState } from 'react'
import {
  Canvas,
  extend,
  useFrame,
  type ThreeToJSXElements,
} from '@react-three/fiber'
import { LiquidGlassR3F } from '@liquid-dom/r3f'
import {
  Frame,
  Glass,
  GlassContainer,
  Padding,
  Html,
  Transform,
  spring,
  easing
} from '@liquid-dom/react'
import * as THREE from 'three/webgpu'
import * as TSL from 'three/tsl'
import styles from './R3FIntegrationDemo.module.css'
import { useHover } from '@use-gesture/react'

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as unknown as Parameters<typeof extend>[0])

const GRID_COLUMNS = 7
const GRID_ROWS = 4
const PANEL_HOVER_SCALE = 1.03
const PANEL_SCALE_TRANSITION = spring({
  stiffness: 260,
  damping: 26,
})
const SCENE_BACKGROUND = '#558184'
const COOL_CUBE_COLORS = [
  '#0077b6',
  '#00b4d8',
  '#48cae4',
  '#2ec4b6',
  '#3a86ff',
  '#4361ee',
  '#7209b7',
] as const
const CUBES = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, index) => ({
  color: COOL_CUBE_COLORS[index % COOL_CUBE_COLORS.length],
  column: index % GRID_COLUMNS,
  id: `cube-${index}`,
  row: Math.floor(index / GRID_COLUMNS),
}))

type ControlsState = {
  cubeSize: number
  gridSpacing: number
  rotationSpeed: number
}

type ControlKey = keyof ControlsState

type RangeControlProps = {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  step: number
  value: number
  valueLabel: string
}

export default function R3FIntegrationDemo() {
  const [controls, setControls] = useState<ControlsState>({
    cubeSize: 0.35,
    gridSpacing: 1.1,
    rotationSpeed: 0.9,
  })

  function updateControl(key: ControlKey, value: number) {
    setControls((current) => ({ ...current, [key]: value }))
  }

  return (
    <section className={styles.root}>
      <LiquidGlassR3F.Root>
        <div className={styles.sceneShell}>
          <Canvas
            camera={{ position: [0, 0, 7.2], fov: 38, near: 0.1, far: 100 }}
            gl={async (props) => {
              const renderer = new THREE.WebGPURenderer(
                props as ConstructorParameters<typeof THREE.WebGPURenderer>[0],
              )
              return renderer.init()
            }}
          >
            <RainbowCubeScene controls={controls} />
            <LiquidGlassR3F.Render />
          </Canvas>
          <LiquidGlassR3F.Scene>
            <LiquidGlassPanel>
              <ControlsForm
                controls={controls}
                onChange={updateControl}
              />
            </LiquidGlassPanel>
          </LiquidGlassR3F.Scene>
        </div>
      </LiquidGlassR3F.Root>
    </section>
  )
}

function RainbowCubeScene({ controls }: { controls: ControlsState }) {
  return (
    <>
      <color attach="background" args={[SCENE_BACKGROUND]} />
      <fog attach="fog" args={[SCENE_BACKGROUND, 8, 13]} />
      <ambientLight intensity={0.72} />
      <directionalLight
        color="#fff6dc"
        intensity={2}
        position={[2.5, 3.5, 5]}
      />
      <pointLight
        color="#fff0a8"
        distance={7}
        intensity={12}
        position={[-2.8, 1.4, 3.2]}
      />
      <pointLight
        color="#ff8a4d"
        distance={8}
        intensity={10}
        position={[3.2, -1.4, 2.5]}
      />

      <group position={[0, 0, 0]}>
        {CUBES.map((cube) => (
          <RainbowCube
            key={cube.id}
            color={cube.color}
            cubeSize={controls.cubeSize}
            phase={cube.row * GRID_COLUMNS + cube.column}
            position={[
              (cube.column - (GRID_COLUMNS - 1) / 2) * controls.gridSpacing,
              ((GRID_ROWS - 1) / 2 - cube.row) * controls.gridSpacing,
              0,
            ]}
            rotationSpeed={controls.rotationSpeed}
          />
        ))}
      </group>
    </>
  )
}

function RainbowCube({
  color,
  cubeSize,
  phase,
  position,
  rotationSpeed,
}: {
  color: string
  cubeSize: number
  phase: number
  position: [number, number, number]
  rotationSpeed: number
}) {
  const ref = useRef<THREE.Mesh | null>(null)

  useFrame((_, delta) => {
    if (!ref.current) {
      return
    }

    const speed = rotationSpeed * (0.8 + (phase % COOL_CUBE_COLORS.length) * 0.045)
    ref.current.rotation.x += delta * speed * 0.72
    ref.current.rotation.y += delta * speed
    ref.current.rotation.z += delta * speed * 0.18
  })

  return (
    <mesh
      ref={ref}
      position={position}
      rotation={[phase * 0.16, phase * 0.21, phase * 0.08]}
    >
      <boxGeometry args={[cubeSize, cubeSize, cubeSize]} />
      <meshStandardNodeMaterial
        colorNode={TSL.color(color)}
        emissiveNode={TSL.color(color)}
        emissiveIntensity={0.08}
        metalness={0.18}
        roughness={0.34}
      />
    </mesh>
  )
}

function LiquidGlassPanel({ children }: { children: React.ReactNode }) {
  const [hovering, setHovering] = useState(false)
  const scale = hovering ? PANEL_HOVER_SCALE : 1

  const bind = useHover(({ hovering }) => {
    setHovering(hovering ?? false)
  })

  return (
    <Frame maxWidth={Infinity} maxHeight={Infinity} alignment='topTrailing'>
      <Padding insets={20}>
        <GlassContainer
          blendSupportGating={false}
          blur={12}
          tint={{ r: 0.9, g: 0.9, b: 0.9, a: hovering ? 0.15 : 0.1 }}
          specularOpacity={0.4}
          transition={{
            tint: easing(),
          }}
        >
          <Transform
            scaleX={scale}
            scaleY={scale}
            origin={{ x: 0.5, y: 0.5 }}
            transition={{
              scaleX: PANEL_SCALE_TRANSITION,
              scaleY: PANEL_SCALE_TRANSITION,
            }}
          >
            <Glass
              cornerRadius={34}
            >
              <Html sizing="intrinsic">
                <div {...bind()}>
                  {children}
                </div>
              </Html>
            </Glass>
          </Transform>
        </GlassContainer>
      </Padding>
    </Frame>
  )
}

function ControlsForm({
  controls,
  onChange,
}: {
  controls: ControlsState
  onChange: (key: ControlKey, value: number) => void
}) {
  return (
    <form
      className={styles.controlsPanel}
      onSubmit={(event) => event.preventDefault()}
    >
      <RangeControl
        label="Cube size"
        min={0.22}
        max={0.72}
        step={0.01}
        value={controls.cubeSize}
        valueLabel={controls.cubeSize.toFixed(2)}
        onChange={(value) => onChange('cubeSize', value)}
      />
      <RangeControl
        label="Rotation speed"
        min={0}
        max={2.4}
        step={0.05}
        value={controls.rotationSpeed}
        valueLabel={`${controls.rotationSpeed.toFixed(2)}x`}
        onChange={(value) => onChange('rotationSpeed', value)}
      />
      <RangeControl
        label="Grid spacing"
        min={0.58}
        max={1.18}
        step={0.01}
        value={controls.gridSpacing}
        valueLabel={controls.gridSpacing.toFixed(2)}
        onChange={(value) => onChange('gridSpacing', value)}
      />
    </form>
  )
}

function RangeControl({
  label,
  max,
  min,
  onChange,
  step,
  value,
  valueLabel,
}: RangeControlProps) {
  return (
    <label className={styles.control}>
      <span className={styles.controlLabel}>
        {label}
        <output>{valueLabel}</output>
      </span>
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  )
}
