import { useEffect, useState } from 'react'
import {
  Frame,
  Glass,
  GlassContainer,
  LayoutCanvas,
  Transform,
  ZStack,
} from 'liquid-glass-dom/react'

const GLASS_WIDTH = 220
const GLASS_HEIGHT = 132
const INITIAL_DISTANCE = -44
const INITIAL_CONTAINER_SPACING = 34

export default function SdfOverlapDemo() {
  const [distance, setDistance] = useState(INITIAL_DISTANCE)
  const [containerSpacing, setContainerSpacing] = useState(INITIAL_CONTAINER_SPACING)
  const centerOffset = (GLASS_WIDTH + distance) / 2

  return (
    <section className="sdf-overlap-demo">
      <LayoutCanvas className="canvas-shell sdf-overlap-canvas-shell" canvasClassName="demo-canvas">
        <Frame maxWidth={Infinity} maxHeight={Infinity}>
          <GlassContainer
            blur={7}
            spacing={containerSpacing}
            bezelWidth={18}
            thickness={86}
            contentDepth={18}
            tint={{ r: 0.11, g: 0.15, b: 0.16, a: 0.62 }}
          >
            <ZStack alignment="center">
              <Transform x={-centerOffset}>
                <OverlapGlass />
              </Transform>
              <Transform x={centerOffset}>
                <OverlapGlass />
              </Transform>
            </ZStack>
          </GlassContainer>
        </Frame>
      </LayoutCanvas>

      <aside className="panel sdf-overlap-controls">
        <Control
          id="sdf-overlap-distance"
          label="Edge distance"
          value={distance}
          min={-GLASS_WIDTH}
          max={180}
          unit="px"
          onChange={setDistance}
        />
        <Control
          id="sdf-container-spacing"
          label="Container spacing"
          value={containerSpacing}
          min={0}
          max={90}
          unit="px"
          onChange={setContainerSpacing}
        />
      </aside>
    </section>
  )
}

function OverlapGlass() {
  return (
    <Glass cornerRadius={42}>
      <Frame width={GLASS_WIDTH} height={GLASS_HEIGHT} />
    </Glass>
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
  const [draftValue, setDraftValue] = useState(String(value))

  useEffect(() => {
    setDraftValue(String(value))
  }, [value])

  const updateValue = (nextValue: number) => {
    const clampedValue = Math.min(max, Math.max(min, nextValue))
    onChange(clampedValue)
  }

  return (
    <label className="layout-control sdf-overlap-control" htmlFor={id}>
      <span>{label}</span>
      <output htmlFor={id}>{value}{unit}</output>
      <div className="sdf-overlap-control-row">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step="1"
          value={value}
          onChange={(event) => updateValue(Number(event.currentTarget.value))}
        />
        <input
          aria-label={label}
          className="sdf-overlap-number"
          type="number"
          min={min}
          max={max}
          step="1"
          value={draftValue}
          onBlur={() => setDraftValue(String(value))}
          onChange={(event) => {
            const nextDraftValue = event.currentTarget.value
            setDraftValue(nextDraftValue)

            if (nextDraftValue === '' || nextDraftValue === '-') {
              return
            }

            const nextValue = Number(nextDraftValue)
            if (Number.isFinite(nextValue)) {
              updateValue(nextValue)
            }
          }}
        />
      </div>
    </label>
  )
}
