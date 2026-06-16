import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Leva } from 'leva'
import { BlendingWebGpuCanvas, type StageSize } from './BlendingWebGpuCanvas'
import { BlendingGlassScene, ShapeInteractionLayer } from './BlendingScene'
import { BoundsOverlay } from './BoundsOverlay'
import {
  INITIAL_SHAPES,
  MAX_CONTAINER_SPACING,
  MIN_CONTAINER_SPACING,
  SAMPLE_VISUALIZATION_OPACITY,
} from './constants'
import { useBlendingControls } from './controls'
import { useStageInteraction } from './interaction'
import type { LiquidSceneRef } from '@liquid-dom/react'
import type { StagePoint } from './types'

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<LiquidSceneRef | null>(null)
  const requestRenderRef = useRef<() => void>(() => undefined)
  const { controls, setControls } = useBlendingControls()
  const [shapes, setShapes] = useState(INITIAL_SHAPES)
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 })
  const [hoverPoint, setHoverPoint] = useState<StagePoint | null>(null)
  const [interactionActive, setInteractionActive] = useState(false)
  const requestSceneRender = useCallback(() => {
    requestRenderRef.current()
  }, [])
  const improvedEnabled = controls.normalGatingEnabled && controls.blendSupportGatingEnabled
  const setImprovedEnabled = useCallback((enabled: boolean) => {
    setControls({
      normalGatingEnabled: enabled,
      blendSupportGatingEnabled: enabled,
    })
  }, [setControls])
  const {
    clearHoverPoint,
    endInteraction,
    startInteraction,
    updateHoverPoint,
    updateInteraction,
  } = useStageInteraction({
    boundsVisible: controls.boundsVisible,
    setInteractionActive,
    setHoverPoint,
    setShapes,
    stageRef,
  })

  useEffect(() => {
    const element = stageRef.current
    if (!element) {
      return
    }

    const updateStageSize = () => {
      const bounds = element.getBoundingClientRect()
      setStageSize({ width: bounds.width, height: bounds.height })
    }

    updateStageSize()
    const resizeObserver = new ResizeObserver(updateStageSize)
    resizeObserver.observe(element)

    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!controls.boundsVisible) {
      setHoverPoint(null)
    }
  }, [controls.boundsVisible])

  useEffect(() => {
    requestSceneRender()
  }, [
    controls.blendSupportCellSize,
    controls.blendSupportGatingEnabled,
    controls.blendingDistance,
    controls.cornerRadius,
    controls.normalGatingEnabled,
    controls.smoothUnionAcceleration,
    requestSceneRender,
    shapes,
  ])

  return (
    <main className="blending-app">
      <Leva
        collapsed
        oneLineLabels
        theme={{ sizes: { controlWidth: '190px', rootWidth: '360px' } }}
      />
      <div className="blending-demo">
        <section
          ref={stageRef}
          className={[
            'blending-stage',
            controls.boundsVisible ? 'visualizing' : '',
            interactionActive ? 'interacting' : '',
          ].filter(Boolean).join(' ')}
          onPointerMove={updateHoverPoint}
          onPointerLeave={clearHoverPoint}
        >
          <BlendingWebGpuCanvas
            requestRenderRef={requestRenderRef}
            sceneRef={sceneRef}
            stageSize={stageSize}
          />
          <div className="blending-stage-controls">
            <button
              aria-pressed={improvedEnabled}
              className={`blending-improved-toggle ${improvedEnabled ? 'active' : ''}`}
              type="button"
              onClick={() => setImprovedEnabled(!improvedEnabled)}
            >
              <span className="blending-improved-checkbox" aria-hidden="true" />
              Improved
            </button>
            <label className="blending-spacing-control">
              <span>Spacing</span>
              <input
                type="range"
                min={MIN_CONTAINER_SPACING}
                max={MAX_CONTAINER_SPACING}
                step={1}
                value={controls.blendingDistance}
                onChange={(event) => setControls({ blendingDistance: Number(event.currentTarget.value) })}
              />
            </label>
          </div>
          <BlendingGlassScene
            controls={controls}
            requestSceneRender={requestSceneRender}
            sceneRef={sceneRef}
            shapes={shapes}
          />
          {controls.boundsVisible && stageSize.width > 0 && stageSize.height > 0 && (
            <BoundsOverlay
              blendingDistance={controls.blendingDistance}
              cornerRadius={controls.cornerRadius}
              hoverPoint={hoverPoint}
              normalGateDetailsVisible={!interactionActive}
              normalGatingEnabled={controls.normalGatingEnabled}
              opacity={SAMPLE_VISUALIZATION_OPACITY}
              shapes={shapes}
              stageSize={stageSize}
              blendSupportGatingEnabled={controls.blendSupportGatingEnabled}
              blendSupportCellSize={controls.blendSupportCellSize}
            />
          )}

          <ShapeInteractionLayer
            shapes={shapes}
            onPointerDown={startInteraction}
            onPointerMove={updateInteraction}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
          />
        </section>
      </div>
      <footer className="blending-footer">
        <p>
          Made with ❤️ by{' '}
          <a href="https://x.com/AndrewPrifer" target="_blank" rel="noreferrer">
            Andrew Prifer
          </a>
        </p>
        <p>
          Check out the source code and the Liquid DOM library on{' '}
          <a href="https://github.com/AndrewPrifer/liquid-dom" target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>
      </footer>
    </main>
  )
}
