import { useMemo, useState } from 'react'
import {
  defaultPerfConfig,
  profileP50,
  profileP95,
  runProfile,
} from '../lib/perf'
import type { PerfConfig, PerfResult } from '../lib/perf'
import {
  formatMs,
  formatPercent,
  visualDrawNodeIds,
  VisualLayoutView,
} from '../lib/visual'

export function PerfProfileTab() {
  const [config, setConfig] = useState(defaultPerfConfig)
  const [result, setResult] = useState<PerfResult>(() => runProfile(defaultPerfConfig()))
  const drawnIds = useMemo(
    () => (result.sample ? visualDrawNodeIds(result.sample.boxes, 120) : new Set<string>()),
    [result.sample],
  )

  const updateConfig = (patch: Partial<PerfConfig>) => {
    setConfig((current) => ({ ...current, ...patch }))
  }

  return (
    <article className="panel">
      <header className="panel-header">
        <div>
          <h2>Perf profile</h2>
          <p>Generate synthetic trees and compare cache reuse under proposal churn, dynamic reorders, and intrinsic invalidations.</p>
        </div>
        <button type="button" id="perf-run" onClick={() => setResult(runProfile(config))}>
          Run profile
        </button>
      </header>
      <form className="perf-controls">
        <label>
          <span>Depth</span>
          <input name="depth" type="number" min="1" max="6" value={config.depth} onChange={(event) => updateConfig({ depth: Number(event.currentTarget.value) })} />
        </label>
        <label>
          <span>Breadth</span>
          <input name="breadth" type="number" min="2" max="6" value={config.breadth} onChange={(event) => updateConfig({ breadth: Number(event.currentTarget.value) })} />
        </label>
        <label>
          <span>Iterations</span>
          <input name="iterations" type="number" min="10" max="1000" value={config.iterations} onChange={(event) => updateConfig({ iterations: Number(event.currentTarget.value) })} />
        </label>
        <label>
          <span>Invalidation rate</span>
          <input name="invalidationRate" type="number" min="0" max="1" step="0.05" value={config.invalidationRate} onChange={(event) => updateConfig({ invalidationRate: Number(event.currentTarget.value) })} />
        </label>
        <label className="check">
          <input name="proposalChurn" type="checkbox" checked={config.proposalChurn} onChange={(event) => updateConfig({ proposalChurn: event.currentTarget.checked })} />
          <span>Proposal churn</span>
        </label>
        <label className="check">
          <input name="dynamicReorder" type="checkbox" checked={config.dynamicReorder} onChange={(event) => updateConfig({ dynamicReorder: event.currentTarget.checked })} />
          <span>Dynamic reorder</span>
        </label>
      </form>
      <div className="perf-output">
        <Metric label="p50" value={formatMs(profileP50(result))} />
        <Metric label="p95" value={formatMs(profileP95(result))} />
        <Metric label="Nodes" value={result.nodes.toLocaleString()} />
        <Metric label="Measure calls" value={result.measureCalls.toLocaleString()} />
        <Metric label="Cache hit ratio" value={formatPercent(result.cacheHitRatio)} />
        <Metric label="Invalidations" value={result.invalidations.toLocaleString()} />
      </div>
      {result.sample ? (
        <VisualLayoutView
          root={result.sample.root}
          boxes={result.sample.boxes}
          proposal={{ width: 680, height: 360 }}
          className="layout-stage perf-stage"
          includeBox={(box) => drawnIds.has(box.node.id)}
        />
      ) : (
        <div className="layout-stage perf-stage" />
      )}
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
