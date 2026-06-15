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
    controls.normalGatingHermiteCap,
    controls.normalGatingHermiteKnee,
    controls.smoothUnionAcceleration,
    requestSceneRender,
    shapes,
  ])

  return (
    <main className="blending-app">
      <Leva
        collapsed={false}
        oneLineLabels
        theme={{ sizes: { controlWidth: '190px', rootWidth: '360px' } }}
      />
      <div className="blending-demo">
        <section
          ref={stageRef}
          className={`blending-stage ${controls.boundsVisible ? 'visualizing' : ''}`}
          onPointerMove={updateHoverPoint}
          onPointerLeave={clearHoverPoint}
        >
          <BlendingWebGpuCanvas
            requestRenderRef={requestRenderRef}
            sceneRef={sceneRef}
            stageSize={stageSize}
          />
          <button
            aria-pressed={improvedEnabled}
            className={`blending-improved-toggle ${improvedEnabled ? 'active' : ''}`}
            type="button"
            onClick={() => setImprovedEnabled(!improvedEnabled)}
          >
            <span className="blending-improved-checkbox" aria-hidden="true" />
            Improved
          </button>
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
              hermiteCap={controls.normalGatingHermiteCap}
              hermiteKnee={controls.normalGatingHermiteKnee}
              hoverPoint={hoverPoint}
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
    </main>
  )
}
