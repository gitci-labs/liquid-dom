import { useLayoutEffect, useRef } from 'react'
import { useControls } from 'leva'
import {
  Frame,
  Glass,
  GlassContainer,
  HStack,
  Html,
  LiquidCanvas,
  Padding,
  Transform,
  VStack,
  ZStack,
  useFrame,
  type TransformRef,
} from '@liquid-dom/react'

const CARD_WIDTH = 156
const CARD_HEIGHT = 96
const INITIAL_ROW_SPACING = 88
const INITIAL_COLUMN_SPACING = 88
const INITIAL_ROW_TRANSFORM = 28
const INITIAL_GRID_X = 0
const INITIAL_GRID_Y = 0
const CARD_ORIGIN = { x: 0.5, y: 0.5 }

export default function SimpleLayoutSceneDemo() {
  const { columnGap, rowGap, rowTransform, gridX, gridY } = useControls('Simple layout', {
    columnGap: {
      value: INITIAL_COLUMN_SPACING,
      min: -50,
      max: 72,
      step: 1,
      label: 'VStack gap',
    },
    rowGap: {
      value: INITIAL_ROW_SPACING,
      min: 0,
      max: 88,
      step: 1,
      label: 'HStack gap',
    },
    rowTransform: {
      value: INITIAL_ROW_TRANSFORM,
      min: 0,
      max: 80,
      step: 1,
      label: 'Row transform',
    },
    gridX: {
      value: INITIAL_GRID_X,
      min: -180,
      max: 180,
      step: 1,
      label: 'Grid X',
    },
    gridY: {
      value: INITIAL_GRID_Y,
      min: -140,
      max: 140,
      step: 1,
      label: 'Grid Y',
    },
  })

  return (
    <section className="simple-layout-demo">
      <LiquidCanvas className="canvas-shell simple-layout-canvas-shell" canvasClassName="demo-canvas">
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
      </LiquidCanvas>

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
