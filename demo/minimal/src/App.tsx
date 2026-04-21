import { startTransition, useEffect, useRef, useState } from 'react'
import {
  Container,
  Glass,
  type GlassPointerEvent,
  Renderer,
  Scene,
} from 'liquid-glass-dom'
import './App.css'

type EventRow = {
  id: number
  message: string
}

type LiveState = {
  glass: string
  type: string
  localX: number
  localY: number
  inside: boolean
}

const MAX_LOG_ROWS = 10

function formatPointerEvent(label: string, event: GlassPointerEvent) {
  return `${label} ${event.type} local(${event.localX.toFixed(1)}, ${event.localY.toFixed(1)}) inside=${event.inside}`
}

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [latestEvent, setLatestEvent] = useState<LiveState | null>(null)
  const [eventLog, setEventLog] = useState<EventRow[]>([])
  const [buttonClicks, setButtonClicks] = useState(0)

  useEffect(() => {
    const mount = stageRef.current
    if (!mount) {
      return
    }

    const scene = new Scene()

    const baseContainer = new Container({
      x: 72,
      y: 76,
      blur: 7,
      spacing: 24,
      bezelWidth: 18,
      thickness: 90,
      zIndex: 0,
    })

    const leftGlass = new Glass({
      x: 0,
      y: 0,
      width: 240,
      height: 160,
      cornerRadius: 52,
      zIndex: 0,
    })

    const rightGlass = new Glass({
      x: 150,
      y: 92,
      width: 260,
      height: 180,
      cornerRadius: 58,
      zIndex: 1,
    })

    baseContainer.add(leftGlass)
    baseContainer.add(rightGlass)

    const topContainer = new Container({
      x: 280,
      y: 90,
      blur: 6,
      spacing: 18,
      bezelWidth: 16,
      thickness: 70,
      tint: { r: 0.11, g: 0.18, b: 0.18, a: 0.64 },
      zIndex: 1,
    })

    const topGlass = new Glass({
      x: 0,
      y: 0,
      width: 220,
      height: 132,
      cornerRadius: 42,
      zIndex: 0,
    })
    topContainer.add(topGlass)

    scene.add(baseContainer)
    scene.add(topContainer)

    const renderer = new Renderer({ scene })
    renderer.canvas.className = 'demo-canvas'
    mount.append(renderer.canvas)

    renderer.htmlRoot.innerHTML = `
      <div class="backdrop-grid">
        <section class="backdrop-card">
          <span class="eyebrow">minimal demo</span>
          <h1>Glass Pointer Events</h1>
          <p>Move through the overlapping shapes to verify per-glass hit testing and container-layer precedence.</p>
        </section>
        <section class="backdrop-card alt">
          <p>Expected checks:</p>
          <ul>
            <li>Same-container overlap resolves via glass z-index.</li>
            <li>Higher container layers win across containers.</li>
            <li>Glass events still fire over DOM content hosted inside a glass.</li>
          </ul>
        </section>
      </div>
    `

    const glassButton = document.createElement('button')
    glassButton.className = 'glass-button'
    glassButton.type = 'button'
    glassButton.textContent = 'Native button inside glass'
    glassButton.addEventListener('click', () => {
      startTransition(() => {
        setButtonClicks((count) => count + 1)
        setEventLog((rows) => [
          { id: Date.now(), message: 'native button click' },
          ...rows,
        ].slice(0, MAX_LOG_ROWS))
      })
    })
    topGlass.setContent(glassButton)

    let nextLogId = 1
    const trackedGlasses = [
      { glass: leftGlass, label: 'left' },
      { glass: rightGlass, label: 'right' },
      { glass: topGlass, label: 'top' },
    ] as const

    const removeListeners = trackedGlasses.flatMap(({ glass, label }) => {
      return [
        'click',
        'pointerenter',
        'pointerleave',
        'pointermove',
        'pointerdown',
        'pointerup',
        'pointercancel',
      ].map((type) => {
        const listener = (event: Event) => {
          const pointerEvent = event as GlassPointerEvent
          startTransition(() => {
            setLatestEvent({
              glass: label,
              type: pointerEvent.type,
              localX: pointerEvent.localX,
              localY: pointerEvent.localY,
              inside: pointerEvent.inside,
            })

            if (pointerEvent.type !== 'pointermove') {
              setEventLog((rows) => [
                { id: nextLogId++, message: formatPointerEvent(label, pointerEvent) },
                ...rows,
              ].slice(0, MAX_LOG_ROWS))
            }
          })
        }

        glass.addEventListener(type, listener)
        return () => glass.removeEventListener(type, listener)
      })
    })

    let frameId = 0
    const frame = () => {
      renderer.render()
      frameId = requestAnimationFrame(frame)
    }
    frame()

    return () => {
      cancelAnimationFrame(frameId)
      for (const removeListener of removeListeners) {
        removeListener()
      }
      renderer.destroy()
      glassButton.remove()
    }
  }, [])

  return (
    <main className="minimal-app">
      <section className="hero">
        <div>
          <p className="eyebrow">demo/minimal</p>
          <h1>Pointer Event Harness</h1>
          <p className="hero-copy">
            Hover, press, and release on the glass shapes below. The top glass also hosts a native button so
            you can verify browser DOM interaction and renderer hit testing happen together.
          </p>
        </div>
        <div className="status-card">
          <span>Native button clicks</span>
          <strong>{buttonClicks}</strong>
        </div>
      </section>

      <section className="demo-layout">
        <div ref={stageRef} className="canvas-shell" />

        <aside className="inspector">
          <div className="panel">
            <h2>Latest event</h2>
            {latestEvent ? (
              <dl className="metric-grid">
                <div>
                  <dt>glass</dt>
                  <dd>{latestEvent.glass}</dd>
                </div>
                <div>
                  <dt>type</dt>
                  <dd>{latestEvent.type}</dd>
                </div>
                <div>
                  <dt>local x</dt>
                  <dd>{latestEvent.localX.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>local y</dt>
                  <dd>{latestEvent.localY.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>inside</dt>
                  <dd>{String(latestEvent.inside)}</dd>
                </div>
              </dl>
            ) : (
              <p className="muted">Interact with a glass shape to populate this panel.</p>
            )}
          </div>

          <div className="panel">
            <h2>Recent events</h2>
            <ol className="event-log">
              {eventLog.length > 0 ? (
                eventLog.map((row) => <li key={row.id}>{row.message}</li>)
              ) : (
                <li className="muted">No events yet.</li>
              )}
            </ol>
          </div>
        </aside>
      </section>
    </main>
  )
}
