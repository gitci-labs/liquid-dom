import { useEffect, useRef, useState, type RefObject } from 'react'
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
  spring,
  useTimeline,
  type GlassContainerRef,
  type TransformRef,
} from 'liquid-glass-dom/react'

const CARD_WIDTH = 142
const CARD_HEIGHT = 104
const CARD_ORIGIN = { x: CARD_WIDTH / 2, y: CARD_HEIGHT / 2 }
const FAST_SPRING = spring({ stiffness: 520, damping: 42 })
const LAYOUT_SPRING = spring({ stiffness: 360, damping: 34 })
const TIMELINE_SPRING = spring({ stiffness: 480, damping: 38 })

type DemoCard = {
  id: string
  label: string
  title: string
  metric: string
}

const CARDS: DemoCard[] = [
  { id: 'declarative', label: 'transition prop', title: 'Declarative', metric: 'props' },
  { id: 'states', label: 'whileHover', title: 'Hover state', metric: 'props' },
  { id: 'timeline', label: 'useTimeline', title: 'Sequence', metric: 'steps' },
]

export default function AnimationDemo() {
  const [spacing, setSpacing] = useState(18)
  const [cardWidth, setCardWidth] = useState(CARD_WIDTH)
  const [fan, setFan] = useState(0)
  const [sequence, setSequence] = useState(0)

  return (
    <section className="animation-demo">
      <LayoutCanvas className="canvas-shell animation-canvas-shell" canvasClassName="demo-canvas">
        <ZStack alignment="center">
          <Html zIndex={-1} sizing="fill">
            <div className="animation-backdrop">
              <div className="animation-copy">
                <span>React animation API</span>
                <strong>Springs, retained refs, timeline steps</strong>
                <p>Layout values and glass properties update on the renderer frame loop.</p>
              </div>
              <div className="animation-ruler animation-ruler-a" />
              <div className="animation-ruler animation-ruler-b" />
              <div className="animation-signal animation-signal-a">width / spacing / transform</div>
              <div className="animation-signal animation-signal-b">hover springs and chained timeline playback</div>
              <div className="animation-stripes" />
            </div>
          </Html>

          <AnimationScene
            spacing={spacing}
            cardWidth={cardWidth}
            fan={fan}
            sequence={sequence}
          />
        </ZStack>
      </LayoutCanvas>

      <aside className="panel animation-controls">
        <Control
          id="animation-spacing"
          label="Stack gap"
          value={spacing}
          min={4}
          max={56}
          unit="px"
          onChange={setSpacing}
        />
        <Control
          id="animation-card-width"
          label="Frame width"
          value={cardWidth}
          min={108}
          max={220}
          unit="px"
          onChange={setCardWidth}
        />
        <Control
          id="animation-fan"
          label="Fan offset"
          value={fan}
          min={-70}
          max={70}
          unit="px"
          onChange={setFan}
        />
        <button
          type="button"
          className="animation-action"
          onClick={() => setSequence((value) => value + 1)}
        >
          Play timeline
        </button>
      </aside>
    </section>
  )
}

type AnimationSceneProps = {
  spacing: number
  cardWidth: number
  fan: number
  sequence: number
}

function AnimationScene({ spacing, cardWidth, fan, sequence }: AnimationSceneProps) {
  const containerRef = useRef<GlassContainerRef | null>(null)
  const rowRef = useRef<TransformRef | null>(null)
  const firstRef = useRef<TransformRef | null>(null)
  const secondRef = useRef<TransformRef | null>(null)
  const thirdRef = useRef<TransformRef | null>(null)
  const createTimeline = useTimeline(TIMELINE_SPRING)

  useEffect(() => {
    if (sequence === 0 || !rowRef.current || !firstRef.current || !secondRef.current || !thirdRef.current || !containerRef.current) {
      return
    }

    const controls = createTimeline()
      .to(containerRef.current, { blur: 15, thickness: 116, tint: { r: 0.13, g: 0.2, b: 0.22, a: 0.72 } })
      .to(firstRef.current, { y: -34, rotation: -0.12, scaleX: 1.1, scaleY: 1.1 })
      .to(secondRef.current, { y: 30, rotation: 0.1, scaleX: 1.08, scaleY: 1.08 })
      .to(thirdRef.current, { y: -24, rotation: 0.14, scaleX: 1.1, scaleY: 1.1 })
      .to(rowRef.current, { x: 34 })
      .to(firstRef.current, { y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      .to(secondRef.current, { y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      .to(thirdRef.current, { y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      .to(rowRef.current, { x: 0 })
      .to(containerRef.current, { blur: 8, thickness: 86, tint: { r: 0.1, g: 0.16, b: 0.18, a: 0.62 } })
      .play()

    return () => controls.stop()
  }, [createTimeline, sequence])

  return (
    <Transform ref={rowRef}>
      <GlassContainer
        ref={containerRef}
        blur={8}
        spacing={24}
        bezelWidth={18}
        thickness={86}
        tint={{ r: 0.1, g: 0.16, b: 0.18, a: 0.62 }}
        transition={{
          blur: FAST_SPRING,
          thickness: FAST_SPRING,
          tint: FAST_SPRING,
        }}
      >
        <Padding insets={24}>
          <VStack spacing={18} alignment="center">
            <Frame width={520}>
              <Glass cornerRadius={22}>
                <Html sizing="fill">
                  <div className="animation-banner">
                    <span>Declarative sliders</span>
                    <strong>Change the controls and the retained nodes spring to their targets.</strong>
                  </div>
                </Html>
              </Glass>
            </Frame>

            <Transform x={fan} transition={{ x: LAYOUT_SPRING }}>
              <HStack spacing={spacing} alignment="center" transition={{ spacing: LAYOUT_SPRING }}>
                {CARDS.map((card, index) => (
                  <AnimatedCard
                    key={card.id}
                    refNode={index === 0 ? firstRef : index === 1 ? secondRef : thirdRef}
                    card={card}
                    width={cardWidth}
                    rotation={(index - 1) * fan * 0.0022}
                  />
                ))}
              </HStack>
            </Transform>
          </VStack>
        </Padding>
      </GlassContainer>
    </Transform>
  )
}

type AnimatedCardProps = {
  refNode: RefObject<TransformRef | null>
  card: DemoCard
  width: number
  rotation: number
}

function AnimatedCard({ refNode, card, width, rotation }: AnimatedCardProps) {
  return (
    <Transform
      ref={refNode}
      origin={CARD_ORIGIN}
      rotation={rotation}
      transition={{
        rotation: LAYOUT_SPRING,
      }}
    >
      <Glass
        cornerRadius={34}
        pointerEvents
        transition={{ cornerRadius: FAST_SPRING }}
        whileHover={{ cornerRadius: 52 }}
        whilePress={{ cornerRadius: 20 }}
      >
        <Frame
          width={width}
          height={CARD_HEIGHT}
          transition={{ width: LAYOUT_SPRING }}
        >
          <Html sizing="fill">
            <div className={`animation-card ${card.id}`}>
              <span>{card.label}</span>
              <strong>{card.title}</strong>
              <em>{card.metric}</em>
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
