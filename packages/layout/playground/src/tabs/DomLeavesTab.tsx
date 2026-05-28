import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { LayoutEngine, Frame, HStack, Padding, Spacer, VStack } from '@liquid-dom/layout'
import type { FrameNode, LayoutDebugStats } from '@liquid-dom/layout'
import { DomLeaf } from '@liquid-dom/layout/dom'
import { formatStats } from '../lib/visual'

type DomLayoutState = {
  stats: LayoutDebugStats | undefined
  stageHeight: number
}

export function DomLeavesTab() {
  const stageRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const engineRef = useRef<LayoutEngine | undefined>(undefined)
  const rootFrameRef = useRef<FrameNode | undefined>(undefined)
  const bodyNodeRef = useRef<DomLeaf | undefined>(undefined)
  const titleNodeRef = useRef<DomLeaf | undefined>(undefined)
  const actionNodeRef = useRef<DomLeaf | undefined>(undefined)
  const frameIdRef = useRef(0)
  const scheduledRef = useRef(false)
  const disposedRef = useRef(false)
  const [expanded, setExpanded] = useState(false)
  const [layoutState, setLayoutState] = useState<DomLayoutState>({
    stats: undefined,
    stageHeight: 180,
  })

  const runLayout = useCallback(() => {
    if (disposedRef.current) return
    const stage = stageRef.current
    const rootFrame = rootFrameRef.current
    const engine = engineRef.current
    if (!stage || !rootFrame || !engine) return

    const width = Math.max(320, stage.clientWidth - 24)
    rootFrame.width = width
    const stats = engine.layout({ width })
    const rootHeight = rootFrame.layout?.rect.height ?? 156
    setLayoutState({
      stats,
      stageHeight: Math.round(rootHeight + 24),
    })
  }, [])

  const scheduleLayout = useCallback(() => {
    if (scheduledRef.current || disposedRef.current) return
    scheduledRef.current = true
    frameIdRef.current = requestAnimationFrame(() => {
      scheduledRef.current = false
      runLayout()
    })
  }, [runLayout])

  useLayoutEffect(() => {
    const title = titleRef.current
    const body = bodyRef.current
    const action = actionRef.current
    const stage = stageRef.current
    if (!title || !body || !action || !stage) return undefined

    disposedRef.current = false
    const titleNode = new DomLeaf({ element: title, sizing: 'constrained-width' })
    const bodyNode = new DomLeaf({ element: body, sizing: 'constrained-width' })
    const actionNode = new DomLeaf({ element: action })
    const rootFrame = new Frame({
      width: Math.max(320, stage.clientWidth - 24),
      alignment: 'topLeading',
    }).append(
      new Padding({ horizontal: 18, vertical: 16 }).append(
        new VStack({ spacing: 12, alignment: 'leading' }).append(
          titleNode,
          bodyNode,
          new HStack({ spacing: 10, alignment: 'center' }).append(new Spacer(), actionNode),
        ),
      ),
    )
    const engine = new LayoutEngine({
      root: rootFrame,
      onInvalidate: scheduleLayout,
    })

    titleNodeRef.current = titleNode
    bodyNodeRef.current = bodyNode
    actionNodeRef.current = actionNode
    rootFrameRef.current = rootFrame
    engineRef.current = engine
    scheduleLayout()

    return () => {
      disposedRef.current = true
      cancelAnimationFrame(frameIdRef.current)
      engine.dispose()
      titleNodeRef.current = undefined
      bodyNodeRef.current = undefined
      actionNodeRef.current = undefined
      rootFrameRef.current = undefined
      engineRef.current = undefined
    }
  }, [scheduleLayout])

  useEffect(() => {
    bodyNodeRef.current?.invalidateMeasure('content')
    scheduleLayout()
  }, [expanded, scheduleLayout])

  return (
    <article className="panel">
      <header className="panel-header">
        <div>
          <h2>DOM intrinsic leaves</h2>
          <p>Real HTML elements are measured as leaves, then positioned from their layout tree.</p>
        </div>
        <button type="button" id="dom-toggle" onClick={() => setExpanded((value) => !value)}>
          Toggle content
        </button>
      </header>
      <div className="dom-stage" ref={stageRef} style={{ height: layoutState.stageHeight }}>
        <div
          className="dom-leaf title-leaf"
          ref={titleRef}
          style={domNodeStyle(titleNodeRef.current)}
        >
          DOM measured title
        </div>
        <div
          className={`dom-leaf body-leaf${expanded ? ' expanded' : ''}`}
          ref={bodyRef}
          style={domNodeStyle(bodyNodeRef.current)}
        >
          {expanded
            ? 'This expanded DOM leaf contains substantially more text. The adapter observes intrinsic changes and the engine reuses cached measurements until the element reports a change.'
            : 'The paragraph leaf measures against the proposed width, so wrapping changes its intrinsic height.'}
        </div>
        <button
          type="button"
          className="dom-leaf action-leaf"
          ref={actionRef}
          style={domNodeStyle(actionNodeRef.current)}
        >
          Action
        </button>
      </div>
      <pre>{layoutState.stats ? formatStats(layoutState.stats) : ''}</pre>
    </article>
  )
}

function domNodeStyle(node: DomLeaf | undefined): CSSProperties {
  const rect = node ? accumulatedRect(node) : undefined
  if (!rect) return {}

  return {
    position: 'absolute',
    left: 0,
    top: 0,
    transform: `translate3d(${Math.round(rect.x)}px, ${Math.round(rect.y)}px, 0)`,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    boxSizing: 'border-box',
  }
}

function accumulatedRect(node: DomLeaf) {
  const layout = node.layout
  if (!layout) return undefined

  let x = layout.rect.x
  let y = layout.rect.y
  let parent = node.parent

  while (parent) {
    const parentLayout = parent.layout
    if (!parentLayout) return undefined
    x += parentLayout.rect.x
    y += parentLayout.rect.y
    parent = parent.parent
  }

  return {
    x,
    y,
    width: layout.rect.width,
    height: layout.rect.height,
  }
}
