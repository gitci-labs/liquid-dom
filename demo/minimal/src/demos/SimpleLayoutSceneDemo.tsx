import { useLayoutEffect, useRef, useState } from 'react'
import {
  Frame,
  Glass,
  GlassContainer,
  HStack,
  Html,
  LayoutCanvas,
  Padding,
  Transform,
  VStack,
  ZStack,
  useFrame,
  type TransformRef,
} from 'liquid-glass-dom/react'

const CARD_WIDTH = 156
const CARD_HEIGHT = 96
const INITIAL_ROW_SPACING = 18
const INITIAL_COLUMN_SPACING = 18
const INITIAL_ROW_TRANSFORM = 28
const INITIAL_GRID_X = 0
const INITIAL_GRID_Y = 0
const CARD_ORIGIN = { x: CARD_WIDTH / 2, y: CARD_HEIGHT / 2 }

export default function SimpleLayoutSceneDemo() {
  const [columnGap, setColumnGap] = useState(INITIAL_COLUMN_SPACING)
  const [rowGap, setRowGap] = useState(INITIAL_ROW_SPACING)
  const [rowTransform, setRowTransform] = useState(INITIAL_ROW_TRANSFORM)
  const [gridX, setGridX] = useState(INITIAL_GRID_X)
  const [gridY, setGridY] = useState(INITIAL_GRID_Y)

  return (
    <section className="simple-layout-demo">
      <LayoutCanvas className="canvas-shell simple-layout-canvas-shell" canvasClassName="demo-canvas">
        <ZStack alignment="center">
          <Html zIndex={-1} sizing="fill">
            <div className="simple-layout-backdrop">
              <div className="simple-layout-copy">
                <span>React layout scene</span>
                <strong>Retained UI tree, live glass transforms</strong>
                <p>Sharp type, bands, and blocks make the refraction easier to read.</p>
              </div>
              <div className="simple-layout-marquee">
                LAYOUT / GLASS / TRANSFORM / HTML / REFRACTION / STACKS
              </div>
              <div className="simple-layout-band simple-layout-band-a" />
              <div className="simple-layout-band simple-layout-band-b" />
              <div className="simple-layout-checker" />
              <div className="simple-layout-panel simple-layout-panel-a">
                <span>VStack</span>
                <strong>3 rows</strong>
              </div>
              <div className="simple-layout-panel simple-layout-panel-b">
                <span>HStack</span>
                <strong>9 glass nodes</strong>
              </div>
              <div className="simple-layout-ticks" />
            </div>
          </Html>

          <Transform x={gridX} y={gridY}>
            <GlassGrid
              columnGap={columnGap}
              rowGap={rowGap}
              rowTransform={rowTransform}
            />
          </Transform>
        </ZStack>
      </LayoutCanvas>

      <aside className="panel layout-controls">
        <Control
          id="simple-layout-column-gap"
          label="VStack gap"
          value={columnGap}
          min={-50}
          max={72}
          unit="px"
          onChange={setColumnGap}
        />
        <Control
          id="simple-layout-row-gap"
          label="HStack gap"
          value={rowGap}
          min={0}
          max={88}
          unit="px"
          onChange={setRowGap}
        />
        <Control
          id="simple-layout-row-transform"
          label="Row transform"
          value={rowTransform}
          min={0}
          max={80}
          unit="px"
          onChange={setRowTransform}
        />
        <Control
          id="simple-layout-grid-x"
          label="Grid X"
          value={gridX}
          min={-180}
          max={180}
          unit="px"
          onChange={setGridX}
        />
        <Control
          id="simple-layout-grid-y"
          label="Grid Y"
          value={gridY}
          min={-140}
          max={140}
          unit="px"
          onChange={setGridY}
        />
      </aside>
    </section>
  )
}

type GlassGridProps = {
  columnGap: number
  rowGap: number
  rowTransform: number
}

function GlassGrid({ columnGap, rowGap, rowTransform }: GlassGridProps) {
  return (
    <GlassContainer
      blur={4}
      spacing={24}
      bezelWidth={17}
      thickness={86}
      tint={{ r: 0.1, g: 0.16, b: 0.18, a: 0.62 }}
    >
      <VStack spacing={columnGap} alignment="center">
        {Array.from({ length: 3 }, (_, rowIndex) => {
          const x = rowIndex === 0 ? rowTransform : rowIndex === 2 ? -rowTransform : 0
          return (
            <Transform key={rowIndex} x={x}>
              <HStack spacing={rowGap} alignment="center">
                {Array.from({ length: 3 }, (_, columnIndex) => {
                  const cardIndex = rowIndex * 3 + columnIndex + 1
                  return (
                    <Padding key={columnIndex} insets={{
                      horizontal: -20,
                      vertical: -20,
                    }}>
                      <GlassCard index={cardIndex} />
                    </Padding>
                  )
                })}
              </HStack>
            </Transform>
          )
        })}
      </VStack>
    </GlassContainer>
  )
}

function GlassCard({ index }: { index: number }) {
  const transformRef = useRef<TransformRef | null>(null)
  const targetScaleRef = useRef(1)

  useLayoutEffect(() => {
    if (transformRef.current) {
      transformRef.current.origin = CARD_ORIGIN
    }
  }, [])

  useFrame(({ delta }) => {
    const transform = transformRef.current
    if (!transform) {
      return
    }

    const target = targetScaleRef.current
    const mix = 1 - Math.exp(-delta / 90)
    const nextScale = transform.scaleX + (target - transform.scaleX) * mix
    transform.scaleX = nextScale
    transform.scaleY = nextScale
  })

  return (
    <Transform ref={transformRef} origin={CARD_ORIGIN}>
      <Glass
        cornerRadius={32}
        pointerEvents
        onPointerEnter={() => {
          targetScaleRef.current = 1.2
        }}
        onPointerLeave={() => {
          targetScaleRef.current = 1
        }}
      >
        <Frame width={CARD_WIDTH} height={CARD_HEIGHT}>
          <Html sizing="fill">
            <div className="simple-layout-card">
              <span>Glass {index}</span>
              <strong>{String(index).padStart(2, '0')}</strong>
            </div>
          </Html>
        </Frame>
      </Glass>
    </Transform>
  )
}

type ControlProps = {
  id: string
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}

function Control({ id, label, value, min, max, unit, onChange }: ControlProps) {
  return (
    <label className="layout-control" htmlFor={id}>
      <span>{label}</span>
      <output htmlFor={id}>{value}{unit}</output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}
