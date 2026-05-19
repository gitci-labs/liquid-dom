import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { button, useControls } from 'leva'
import {
  Frame,
  Glass,
  GlassContainer,
  HStack,
  Html,
  LiquidCanvas,
  Padding,
  VStack,
  ZStack,
  useFrame,
  useLiquidScene,
  type HtmlRef,
} from '@liquid-dom/react'

type ProbeId = 'intrinsic' | 'proposal' | 'fixedWidth' | 'mutation' | 'replacement'
type ProbeMetrics = Record<ProbeId, { width: number; height: number }>

const emptyMetrics: ProbeMetrics = {
  intrinsic: { width: 0, height: 0 },
  proposal: { width: 0, height: 0 },
  fixedWidth: { width: 0, height: 0 },
  mutation: { width: 0, height: 0 },
  replacement: { width: 0, height: 0 },
}

export default function DomMeasurementDemo() {
  const [mutationCount, setMutationCount] = useState(1)
  const [replacementVariant, setReplacementVariant] = useState(0)
  const [layoutCount, setLayoutCount] = useState(0)
  const [metrics, setMetrics] = useState<ProbeMetrics>(emptyMetrics)
  const { wrapWidth, fixedWidth, textLevel } = useControls('DOM measurement', {
    wrapWidth: {
      value: 230,
      min: 150,
      max: 340,
      step: 1,
      label: 'Proposal width',
    },
    fixedWidth: {
      value: 210,
      min: 140,
      max: 320,
      step: 1,
      label: 'Fixed width',
    },
    textLevel: {
      value: 2,
      min: 1,
      max: 5,
      step: 1,
      label: 'Text content',
    },
    'Mutate DOM content': button(() => setMutationCount((count) => count + 1)),
    'Replace measured element': button(() => setReplacementVariant((variant) => variant + 1)),
  })

  const handleMetrics = useCallback((nextMetrics: ProbeMetrics) => {
    setMetrics(nextMetrics)
  }, [])

  return (
    <section className="dom-measure-demo">
      <LiquidCanvas className="canvas-shell dom-measure-canvas-shell" canvasClassName="demo-canvas">
        <LayoutCallCounter onCount={setLayoutCount} />
        <MeasurementScene
          wrapWidth={wrapWidth}
          fixedWidth={fixedWidth}
          textLevel={textLevel}
          mutationCount={mutationCount}
          replacementVariant={replacementVariant}
          onMetrics={handleMetrics}
        />
      </LiquidCanvas>

      <aside className="panel dom-measure-readouts">
        <LayoutCountReadout count={layoutCount} />
        <MeasurementReadout metrics={metrics} />
      </aside>
    </section>
  )
}

function LayoutCallCounter({ onCount }: { onCount: (count: number) => void }) {
  const layoutScene = useLiquidScene()
  const countRef = useRef(0)
  const onCountRef = useRef(onCount)
  onCountRef.current = onCount

  useLayoutEffect(() => {
    countRef.current = 0
    onCountRef.current(0)
    const originalLayout = layoutScene.layout.bind(layoutScene)
    layoutScene.layout = ((proposal) => {
      const stats = originalLayout(proposal)
      countRef.current += 1
      onCountRef.current(countRef.current)
      return stats
    }) as typeof layoutScene.layout

    return () => {
      layoutScene.layout = originalLayout
    }
  }, [layoutScene])

  return null
}

type MeasurementSceneProps = {
  wrapWidth: number
  fixedWidth: number
  textLevel: number
  mutationCount: number
  replacementVariant: number
  onMetrics: (metrics: ProbeMetrics) => void
}

function MeasurementScene({
  wrapWidth,
  fixedWidth,
  textLevel,
  mutationCount,
  replacementVariant,
  onMetrics,
}: MeasurementSceneProps) {
  const intrinsicRef = useRef<HtmlRef | null>(null)
  const proposalRef = useRef<HtmlRef | null>(null)
  const fixedWidthRef = useRef<HtmlRef | null>(null)
  const mutationRef = useRef<HtmlRef | null>(null)
  const replacementRef = useRef<HtmlRef | null>(null)
  const lastMetricsRef = useRef('')

  useFrame(() => {
    const nextMetrics: ProbeMetrics = {
      intrinsic: readMetrics(intrinsicRef.current),
      proposal: readMetrics(proposalRef.current),
      fixedWidth: readMetrics(fixedWidthRef.current),
      mutation: readMetrics(mutationRef.current),
      replacement: readMetrics(replacementRef.current),
    }
    const signature = JSON.stringify(nextMetrics)
    if (signature !== lastMetricsRef.current) {
      lastMetricsRef.current = signature
      onMetrics(nextMetrics)
    }
  })

  return (
    <ZStack alignment="center">
      <Html zIndex={-1} sizing="fill">
        <div className="dom-measure-backdrop">
          <div className="dom-measure-backdrop-copy">
            <span>DOM measurement</span>
            <strong>Intrinsic size, fixed axes, mutations, replacement</strong>
          </div>
          <div className="dom-measure-ruler dom-measure-ruler-a" />
          <div className="dom-measure-ruler dom-measure-ruler-b" />
          <div className="dom-measure-noise" />
        </div>
      </Html>

      <Frame width={840} alignment="center">
        <GlassContainer
          blur={6}
          spacing={24}
          tint={{ r: 0.09, g: 0.14, b: 0.18, a: 0.66 }}
        >
          <Padding insets={22}>
            <VStack spacing={18} alignment="center">
              <HStack spacing={18} alignment="top">
                <MeasurementGlass>
                  <Html ref={intrinsicRef}>
                    <MeasureCard
                      label="Intrinsic"
                      title="Natural max-content"
                      lines={['No frame constraints.', 'The content element defines both axes.']}
                    />
                  </Html>
                </MeasurementGlass>

                <Frame width={wrapWidth} alignment="topLeading">
                  <MeasurementGlass>
                    <Html ref={proposalRef} sizing="constrained-width">
                      <MeasureCard
                        label="Proposal width"
                        title={`${wrapWidth}px proposal`}
                        lines={copyLines(textLevel)}
                      />
                    </Html>
                  </MeasurementGlass>
                </Frame>

                <MeasurementGlass>
                  <Frame width={fixedWidth} alignment="topLeading">
                    <Html ref={fixedWidthRef} sizing="constrained-width">
                      <MeasureCard
                        label="Frame width"
                        title={`${fixedWidth}px frame`}
                        lines={copyLines(textLevel + 1)}
                      />
                    </Html>
                  </Frame>
                </MeasurementGlass>
              </HStack>

              <HStack spacing={18} alignment="top">
                <MeasurementGlass>
                  <ImperativeMutationHtml refObject={mutationRef} mutationCount={mutationCount} />
                </MeasurementGlass>

                <MeasurementGlass>
                  <ReplacementHtml refObject={replacementRef} variant={replacementVariant} />
                </MeasurementGlass>
              </HStack>
            </VStack>
          </Padding>
        </GlassContainer>
      </Frame>
    </ZStack>
  )
}

function MeasurementGlass({ children }: { children: ReactNode }) {
  return (
    <Glass cornerRadius={28}>
      <Padding insets={12}>
        {children}
      </Padding>
    </Glass>
  )
}

function ImperativeMutationHtml({
  refObject,
  mutationCount,
}: {
  refObject: MutableRefObject<HtmlRef | null>
  mutationCount: number
}) {
  useLayoutEffect(() => {
    const element = document.createElement('div')
    element.className = 'dom-measure-card dom-measure-card-direct'
    refObject.current?.setElement(element)
    return () => refObject.current?.setElement(null)
  }, [refObject])

  useLayoutEffect(() => {
    const element = refObject.current?.element
    if (!element) {
      return
    }

    element.innerHTML = `
      <span>MutationObserver</span>
      <strong>Imperative DOM edit ${mutationCount}</strong>
      ${Array.from({ length: mutationCount }, (_, index) => `<p>Inserted line ${index + 1}</p>`).join('')}
    `
  }, [refObject, mutationCount])

  return <Html ref={refObject} />
}

function ReplacementHtml({
  refObject,
  variant,
}: {
  refObject: MutableRefObject<HtmlRef | null>
  variant: number
}) {
  useLayoutEffect(() => {
    const element = document.createElement('div')
    const long = variant % 2 === 1
    element.className = long
      ? 'dom-measure-card dom-measure-card-replacement wide'
      : 'dom-measure-card dom-measure-card-replacement'
    element.innerHTML = long
      ? `
        <span>setElement</span>
        <strong>Replacement target B</strong>
        <p>This wider replacement forces a new measured content element and a new subscription.</p>
        <p>Variant ${variant}</p>
      `
      : `
        <span>setElement</span>
        <strong>Replacement target A</strong>
        <p>Compact replacement element.</p>
      `
    refObject.current?.setElement(element)
    return () => refObject.current?.setElement(null)
  }, [refObject, variant])

  return <Html ref={refObject} />
}

function MeasureCard({
  label,
  title,
  lines,
}: {
  label: string
  title: string
  lines: string[]
}) {
  return (
    <div className="dom-measure-card">
      <span>{label}</span>
      <strong>{title}</strong>
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  )
}

function MeasurementReadout({ metrics }: { metrics: ProbeMetrics }) {
  const rows: Array<[ProbeId, string]> = [
    ['intrinsic', 'Intrinsic'],
    ['proposal', 'Proposal'],
    ['fixedWidth', 'Fixed width'],
    ['mutation', 'Mutation'],
    ['replacement', 'Replacement'],
  ]

  return (
    <dl className="dom-measure-readout">
      {rows.map(([id, label]) => (
        <div key={id}>
          <dt>{label}</dt>
          <dd>{formatSize(metrics[id])}</dd>
        </div>
      ))}
    </dl>
  )
}

function LayoutCountReadout({ count }: { count: number }) {
  return (
    <div className="dom-measure-layout-count">
      <span>Layout calls</span>
      <strong>{count}</strong>
    </div>
  )
}

function readMetrics(node: HtmlRef | null) {
  return {
    width: Math.round(node?.sceneNode.width ?? 0),
    height: Math.round(node?.sceneNode.height ?? 0),
  }
}

function formatSize(size: { width: number; height: number }) {
  return `${size.width} x ${size.height}`
}

function copyLines(level: number) {
  return Array.from({ length: level }, (_, index) => {
    if (index % 3 === 0) {
      return 'This paragraph should wrap when the available width changes.'
    }
    if (index % 3 === 1) {
      return 'Changing the slider should update measured height without extra sizing code.'
    }
    return 'The scene host is placed, while the content element is measured.'
  })
}
