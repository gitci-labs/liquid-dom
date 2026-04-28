import { useEffect, useRef, useState } from 'react'
import { Container, Glass, Html, Renderer, Scene } from 'liquid-glass-dom'

const INITIAL_GLASS_WIDTH = 320
const INITIAL_SCENE_HTML_WIDTH = 260
const INITIAL_SHARED_HEIGHT = 188

export default function TinyGlassDemo() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const glassRef = useRef<Glass | null>(null)
  const glassContentRef = useRef<Html | null>(null)
  const sceneHtmlRef = useRef<Html | null>(null)
  const [glassWidth, setGlassWidth] = useState(INITIAL_GLASS_WIDTH)
  const [sceneHtmlWidth, setSceneHtmlWidth] = useState(INITIAL_SCENE_HTML_WIDTH)
  const [sharedHeight, setSharedHeight] = useState(INITIAL_SHARED_HEIGHT)

  useEffect(() => {
    const glass = glassRef.current
    const glassContent = glassContentRef.current
    if (!glass || !glassContent) {
      return
    }

    glass.width = glassWidth
    glassContent.width = glassWidth
  }, [glassWidth])

  useEffect(() => {
    const sceneHtml = sceneHtmlRef.current
    if (!sceneHtml) {
      return
    }

    sceneHtml.width = sceneHtmlWidth
  }, [sceneHtmlWidth])

  useEffect(() => {
    const glass = glassRef.current
    const glassContent = glassContentRef.current
    const sceneHtml = sceneHtmlRef.current
    if (!glass || !glassContent || !sceneHtml) {
      return
    }

    glass.height = sharedHeight
    glassContent.height = sharedHeight
    sceneHtml.height = sharedHeight
  }, [sharedHeight])

  useEffect(() => {
    const mount = stageRef.current
    if (!mount) {
      return
    }

    const scene = new Scene()

    const backdropElement = document.createElement('div')
    backdropElement.className = 'tiny-backdrop'
    backdropElement.innerHTML = `
      <div class="tiny-backdrop-copy">
        <span class="eyebrow">html backdrop</span>
        <h1>Liquid glass</h1>
        <p>Scene-level HTML sits behind one glass panel.</p>
      </div>
    `
    const backdrop = scene.add(new Html({
      zIndex: -1,
      element: backdropElement,
    }))

    const sceneHtmlElement = document.createElement('div')
    sceneHtmlElement.className = 'tiny-scene-card'
    sceneHtmlElement.innerHTML = `
      <span>second scene html</span>
      <strong>Adjustable layer</strong>
    `
    const sceneHtml = scene.add(new Html({
      x: 330,
      y: 276,
      width: sceneHtmlWidth,
      height: sharedHeight,
      zIndex: 1,
      element: sceneHtmlElement,
    }))

    const container = new Container({
      x: 116,
      y: 196,
      blur: 9,
      spacing: 24,
      bezelWidth: 17,
      thickness: 86,
      contentDepth: 18,
      tint: { r: 0.12, g: 0.16, b: 0.18, a: 0.62 },
      zIndex: 2,
    })

    const glass = new Glass({
      width: glassWidth,
      height: sharedHeight,
      cornerRadius: 54,
    })

    const glassContentElement = document.createElement('div')
    glassContentElement.className = 'tiny-glass-content'
    glassContentElement.innerHTML = `
      <span>html inside glass</span>
      <strong>Resizable content panel</strong>
      <p>The slider changes the glass width and this HTML layer follows it.</p>
    `
    const glassContent = new Html({
      width: glassWidth,
      height: sharedHeight,
      element: glassContentElement,
    })

    glass.add(glassContent)
    container.add(glass)
    scene.add(container)

    glassRef.current = glass
    glassContentRef.current = glassContent
    sceneHtmlRef.current = sceneHtml

    const renderer = new Renderer({ scene })
    renderer.canvas.className = 'demo-canvas'
    mount.append(renderer.canvas)

    const syncBackdropSize = () => {
      const bounds = mount.getBoundingClientRect()
      backdrop.width = bounds.width
      backdrop.height = bounds.height
    }
    const resizeObserver = new ResizeObserver(syncBackdropSize)
    resizeObserver.observe(mount)
    syncBackdropSize()

    let frameId = 0
    const frame = () => {
      renderer.render()
      frameId = requestAnimationFrame(frame)
    }
    frame()

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      renderer.destroy()
      glassRef.current = null
      glassContentRef.current = null
      sceneHtmlRef.current = null
    }
  }, [])

  return (
    <section className="tiny-demo">
      <div ref={stageRef} className="canvas-shell tiny-canvas-shell" />

      <aside className="panel tiny-controls">
        <label htmlFor="tiny-glass-width">Glass width</label>
        <div className="tiny-width-readout">{glassWidth}px</div>
        <input
          id="tiny-glass-width"
          type="range"
          min="220"
          max="520"
          step="1"
          value={glassWidth}
          onChange={(event) => setGlassWidth(Number(event.currentTarget.value))}
        />

        <label htmlFor="tiny-scene-html-width">Scene HTML width</label>
        <div className="tiny-width-readout">{sceneHtmlWidth}px</div>
        <input
          id="tiny-scene-html-width"
          type="range"
          min="180"
          max="420"
          step="1"
          value={sceneHtmlWidth}
          onChange={(event) => setSceneHtmlWidth(Number(event.currentTarget.value))}
        />

        <label htmlFor="tiny-shared-height">Shared height</label>
        <div className="tiny-width-readout">{sharedHeight}px</div>
        <input
          id="tiny-shared-height"
          type="range"
          min="120"
          max="220"
          step="1"
          value={sharedHeight}
          onChange={(event) => setSharedHeight(Number(event.currentTarget.value))}
        />
      </aside>
    </section>
  )
}
