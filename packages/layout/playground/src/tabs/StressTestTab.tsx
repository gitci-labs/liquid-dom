import { useEffect, useRef, useState } from 'react'
import { LayoutEngine } from '@liquid-dom/layout'
import type { LayoutDebugStats } from '@liquid-dom/layout'
import {
  buildStressTree,
  defaultStressConfig,
  normalizeStressConfig,
  stressStructuralKey,
  updateStressTree,
} from '../lib/stress'
import type { StressConfig, StressTreeState } from '../lib/stress'
import {
  formatMs,
  lerp,
  stressDrawNodeIds,
  syncVisualLayout,
  wave,
} from '../lib/visual'

type StressViewState = {
  fps: number
  frameInterval: number
  layoutMs: number
  drawn: number
  stats: LayoutDebugStats | undefined
}

export function StressTestTab() {
  const [config, setConfig] = useState(defaultStressConfig)
  const configRef = useRef(config)
  const stageRef = useRef<HTMLDivElement>(null)
  const stressStateRef = useRef<StressTreeState | undefined>(undefined)
  const engineRef = useRef<LayoutEngine | undefined>(undefined)
  const cacheEnabledRef = useRef(config.useCache)
  const [viewState, setViewState] = useState<StressViewState>({
    fps: 0,
    frameInterval: 0,
    layoutMs: 0,
    drawn: 0,
    stats: undefined,
  })

  useEffect(() => {
    configRef.current = config
    const nextKey = stressStructuralKey(config)
    const currentState = stressStateRef.current
    let nextState = currentState

    if (!nextState || nextState.structuralKey !== nextKey) {
      engineRef.current?.dispose()
      currentState?.root.dispose()
      nextState = buildStressTree(config)
      stressStateRef.current = nextState
      engineRef.current = new LayoutEngine({
        root: nextState.root,
        maxCachedMeasurements: config.useCache ? undefined : 0,
      })
      cacheEnabledRef.current = config.useCache
      return
    }

    if (config.useCache !== cacheEnabledRef.current) {
      engineRef.current?.dispose()
      engineRef.current = new LayoutEngine({
        root: nextState.root,
        maxCachedMeasurements: config.useCache ? undefined : 0,
      })
      cacheEnabledRef.current = config.useCache
    }
  }, [config])

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
      const currentConfig = configRef.current
      const stressState = stressStateRef.current
      const engine = engineRef.current

      if (stressState && engine) {
        framesSinceFps += 1
        if (now - lastFpsAt >= 300) {
          fps = (framesSinceFps / (now - lastFpsAt)) * 1000
          framesSinceFps = 0
          lastFpsAt = now
        }

        const phase = now / 4200
        const startedAt = performance.now()
        updateStressTree(stressState, currentConfig, phase)
        const proposal = {
          width: 1180,
          height: currentConfig.animateFrame ? lerp(650, 720, wave(phase + 0.18)) : 680,
        }
        const stats = engine.layout(proposal)
        const drawnIds = stressDrawNodeIds(stressState.boxes, currentConfig.drawCap)
        const drawn = stressState.boxes.filter((box) => box.role !== 'group' && drawnIds.has(box.node.id)).length
        const stage = stageRef.current
        if (stage) {
          syncVisualLayout(stage, stressState.root, stressState.boxes, { width: 1180, height: 680 }, {
            includeBox: (box) => drawnIds.has(box.node.id),
          })
        }
        if (now - lastUiAt >= 300) {
          setViewState({
            fps,
            frameInterval: now - lastFrameAt,
            layoutMs: performance.now() - startedAt,
            drawn,
            stats,
          })
          lastUiAt = now
        }
      }

      lastFrameAt = now
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)

    return () => {
      running = false
      cancelAnimationFrame(frameId)
      engineRef.current?.dispose()
      stressStateRef.current?.root.dispose()
      engineRef.current = undefined
      stressStateRef.current = undefined
    }
  }, [])

  const updateConfig = (patch: Partial<StressConfig>) => {
    setConfig((current) => normalizeStressConfig({ ...current, ...patch }))
  }

  return (
    <article className="panel stress-panel">
      <header className="panel-header">
        <div>
          <h2>Large animated layout stress test</h2>
          <p>Generate many nested stack leaves, animate layout parameters, and choose how many renderable nodes to draw.</p>
        </div>
        <div className="fps-meter">
          <span>FPS</span>
          <strong>{Math.round(viewState.fps)}</strong>
        </div>
      </header>
      <form className="stress-controls">
        <label>
          <span>Elements</span>
          <input name="elements" type="number" min="25" max="5000" step="25" value={config.elements} onChange={(event) => updateConfig({ elements: Number(event.currentTarget.value) })} />
        </label>
        <label>
          <span>Group size</span>
          <input name="groupSize" type="number" min="2" max="16" value={config.groupSize} onChange={(event) => updateConfig({ groupSize: Number(event.currentTarget.value) })} />
        </label>
        <label>
          <span>Depth cap</span>
          <input name="depth" type="number" min="2" max="8" value={config.depth} onChange={(event) => updateConfig({ depth: Number(event.currentTarget.value) })} />
        </label>
        <label>
          <span>Draw cap</span>
          <input name="drawCap" type="number" min="0" max="1500" step="25" value={config.drawCap} onChange={(event) => updateConfig({ drawCap: Number(event.currentTarget.value) })} />
        </label>
        <label>
          <span>Motion</span>
          <input name="motion" type="range" min="0" max="1" step="0.05" value={config.motion} onChange={(event) => updateConfig({ motion: Number(event.currentTarget.value) })} />
        </label>
        <label className="check">
          <input name="useCache" type="checkbox" checked={config.useCache} onChange={(event) => updateConfig({ useCache: event.currentTarget.checked })} />
          <span>Use cache</span>
        </label>
        <label className="check">
          <input name="animateFrame" type="checkbox" checked={config.animateFrame} onChange={(event) => updateConfig({ animateFrame: event.currentTarget.checked })} />
          <span>Animate frame</span>
        </label>
      </form>
      <div className="stress-legend">
        <span><i className="tone-teal" /> HStack bands</span>
        <span><i className="tone-blue" /> VStack bands</span>
        <span><i className="tone-yellow" /> ZStack groups</span>
        <span><i className="tone-red" /> Deep leaves</span>
      </div>
      <div className="stress-output">
        <Metric label="Elements" value={config.elements.toLocaleString()} />
        <Metric label="Drawn" value={viewState.drawn.toLocaleString()} />
        <Metric label="Layout" value={formatMs(viewState.layoutMs)} />
        <Metric label="Frame" value={formatMs(viewState.frameInterval)} />
        <Metric label="Cache" value={config.useCache ? 'on' : 'off'} />
        <Metric label="Measure calls" value={(viewState.stats?.measureCalls ?? 0).toLocaleString()} />
        <Metric label="Cache hits" value={(viewState.stats?.cacheHits ?? 0).toLocaleString()} />
        <Metric label="Cache misses" value={(viewState.stats?.cacheMisses ?? 0).toLocaleString()} />
        <Metric label="Nodes" value={(viewState.stats?.nodes ?? 0).toLocaleString()} />
      </div>
      <div ref={stageRef} className="layout-stage stress-stage" />
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
