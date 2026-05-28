import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  LayoutEngine,
  Frame,
  HStack,
  Leaf,
  Overlay,
  Padding,
} from '@liquid-dom/layout'
import type { LayoutNode, ProposedSize } from '@liquid-dom/layout'
import {
  formatMs,
  lerp,
  syncVisualLayout,
  visualLeaf,
  wave,
} from '../lib/visual'
import type { VisualBox } from '../lib/visual'

type AnimatedExample = {
  title: string
  proposal: ProposedSize
  root: LayoutNode
  boxes: VisualBox[]
  update: (phase: number) => void
}

type AnimatedCardState = {
  title: string
  proposal: ProposedSize
  size: { width: number; height: number }
}

class BadgeLeaf extends Leaf {
  width = 76

  protected override measureLeaf() {
    return { width: this.width, height: 34 }
  }
}

export function AnimatedExamplesTab() {
  const examples = useMemo(() => createAnimatedExamples(), [])
  const engines = useMemo(
    () => examples.map((example) => new LayoutEngine({ root: example.root })),
    [examples],
  )
  const stageRefs = useRef<Array<HTMLDivElement | null>>([])
  const [frameState, setFrameState] = useState(() => layoutAnimatedExamples(examples, engines, stageRefs.current, 0, 0, 0))

  useEffect(() => {
    let frameId = 0
    let running = true
    let lastFrameAt = performance.now()
    let lastFpsAt = lastFrameAt
    let lastUiAt = lastFrameAt
    let framesSinceFps = 0
    let fps = 0

    const tick = (now: number) => {
      if (!running) return

      const phase = now / 1400
      framesSinceFps += 1
      if (now - lastFpsAt >= 300) {
        fps = (framesSinceFps / (now - lastFpsAt)) * 1000
        framesSinceFps = 0
        lastFpsAt = now
      }

      const nextFrameState = layoutAnimatedExamples(examples, engines, stageRefs.current, phase, fps, now - lastFrameAt)
      if (now - lastUiAt >= 300) {
        setFrameState(nextFrameState)
        lastUiAt = now
      }
      lastFrameAt = now
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)

    return () => {
      running = false
      cancelAnimationFrame(frameId)
      for (const engine of engines) engine.dispose()
    }
  }, [engines, examples])

  return (
    <article className="panel animation-panel">
      <header className="panel-header">
        <div>
          <h2>Animated layout parameters</h2>
          <p>Each frame mutates layout nodes with changing spacing, padding, frame, and overlay parameters.</p>
        </div>
        <div className="fps-meter">
          <span>FPS</span>
          <strong>{Math.round(frameState.fps)}</strong>
        </div>
      </header>
      <div className="animation-grid">
        {frameState.cards.map((card, index) => (
          <section className="animation-card" key={card.title}>
            <header>
              <h3>{card.title}</h3>
              <span>{Math.round(card.size.width)} x {Math.round(card.size.height)}</span>
            </header>
            <div
              className="layout-stage animation-stage"
              ref={(element) => {
                stageRefs.current[index] = element
              }}
              style={{ width: card.proposal.width ?? 430, height: card.proposal.height ?? 160 }}
            />
          </section>
        ))}
      </div>
      <pre>{`fps: ${Math.round(frameState.fps)}
frame interval: ${formatMs(frameState.frameInterval)}
examples: ${examples.length}
nodes: ${frameState.nodeCount}
measure calls: ${frameState.measureCalls}
cache hits: ${frameState.cacheHits}
cache misses: ${frameState.cacheMisses}`}</pre>
    </article>
  )
}

function layoutAnimatedExamples(
  examples: AnimatedExample[],
  engines: LayoutEngine[],
  stages: Array<HTMLDivElement | null>,
  phase: number,
  fps: number,
  frameInterval: number,
) {
  let measureCalls = 0
  let cacheHits = 0
  let cacheMisses = 0
  let nodeCount = 0
  const cards: AnimatedCardState[] = []

  for (const [index, example] of examples.entries()) {
    example.update(phase)
    const stats = engines[index]?.layout(example.proposal)
    if (!stats) continue
    const stage = stages[index]
    if (stage) {
      syncVisualLayout(stage, example.root, example.boxes, example.proposal)
    }

    measureCalls += stats.measureCalls
    cacheHits += stats.cacheHits
    cacheMisses += stats.cacheMisses
    nodeCount += stats.nodes
    const rect = example.root.layout?.rect
    cards.push({
      title: example.title,
      proposal: example.proposal,
      size: { width: rect?.width ?? 0, height: rect?.height ?? 0 },
    })
  }

  return {
    cards,
    fps,
    frameInterval,
    measureCalls,
    cacheHits,
    cacheMisses,
    nodeCount,
  }
}

function createAnimatedExamples(): AnimatedExample[] {
  return [
    (() => {
      const a = visualLeaf('spacing-a', { width: 62, height: 38 }, 'A', 'teal')
      const b = visualLeaf('spacing-b', { width: 86, height: 50 }, 'spacing', 'blue')
      const c = visualLeaf('spacing-c', { width: 62, height: 38 }, 'C', 'red')
      const row = new HStack({ spacing: 4, alignment: 'center' }).append(a.node, b.node, c.node)
      return {
        title: 'HStack spacing',
        proposal: { width: 430, height: 120 },
        root: row,
        boxes: [a, b, c],
        update: (phase) => {
          row.spacing = lerp(4, 46, wave(phase))
        },
      }
    })(),
    (() => {
      const content = visualLeaf('padding-content', { width: 154, height: 42 }, 'content', 'blue')
      const bg = visualLeaf('padding-bg', { width: 320, height: 118 }, 'background', 'yellow')
      const padded = new Padding({
        horizontal: 8,
        vertical: 6,
      }).append(content.node)
      const root = new Background().append(padded, bg.node)
      return {
        title: 'Padding insets',
        proposal: { width: 430, height: 150 },
        root,
        boxes: [content, bg],
        update: (phase) => {
          padded.insets = {
            horizontal: lerp(8, 56, wave(phase + 0.15)),
            vertical: lerp(6, 32, wave(phase + 0.55)),
          }
        },
      }
    })(),
    (() => {
      const child = visualLeaf('frame-child', { width: 96, height: 42 }, 'aligned', 'teal')
      const root = new Frame({
        width: 190,
        height: 82,
        alignment: 'topLeading',
      }).append(child.node)
      return {
        title: 'Frame size + alignment',
        proposal: { width: 430, height: 160 },
        root,
        boxes: [child],
        update: (phase) => {
          root.width = lerp(190, 340, wave(phase))
          root.height = lerp(82, 136, wave(phase + 0.3))
          root.alignment = wave(phase + 0.6) > 0.5 ? 'bottomTrailing' : 'topLeading'
        },
      }
    })(),
    (() => {
      const badge = new BadgeLeaf()
      const badgeBox: VisualBox = { node: badge, id: 'overlay-badge', label: 'badge', tone: 'red' }
      const card = visualLeaf('overlay-card', { width: 250, height: 96 }, 'card owns layout', 'gray')
      const overlayNode = new Overlay({ alignment: 'bottomLeading' }).append(card.node, badge)
      const root = new Frame({ width: 330, height: 130, alignment: 'center' }).append(overlayNode)
      return {
        title: 'Overlay badge',
        proposal: { width: 430, height: 160 },
        root,
        boxes: [card, badgeBox],
        update: (phase) => {
          badge.width = lerp(76, 132, wave(phase))
          badge.measureKey = Math.round(badge.width)
          overlayNode.alignment = wave(phase + 0.25) > 0.5 ? 'topTrailing' : 'bottomLeading'
        },
      }
    })(),
  ]
}
