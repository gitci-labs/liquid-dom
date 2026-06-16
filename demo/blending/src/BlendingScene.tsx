import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import {
  Frame,
  Glass,
  GlassContainer,
  LiquidScene,
  Transform,
  ZStack,
  type LiquidSceneRef,
} from '@liquid-dom/react'
import {
  CORNER_HIT_RADIUS,
  GLASS_ORIGIN,
} from './constants'
import type { BlendingControls, ShapeState } from './types'

type BlendingGlassSceneProps = {
  controls: BlendingControls
  requestSceneRender: () => void
  sceneRef: RefObject<LiquidSceneRef | null>
  shapes: ShapeState[]
}

export function BlendingGlassScene({
  controls,
  requestSceneRender,
  sceneRef,
  shapes,
}: BlendingGlassSceneProps) {
  return (
    <LiquidScene
      ref={sceneRef}
      onInvalidateFrame={requestSceneRender}
      onInvalidateLayout={requestSceneRender}
    >
      <ZStack alignment="center">
        <Frame maxWidth={Infinity} maxHeight={Infinity}>
          <GlassContainer
            blur={4}
            displacementBlur={30}
            spacing={controls.blendingDistance}
            tint={{ r: 0.73, g: 0.73, b: 0.73, a: 0.45 }}
            normalGating={{
              enabled: controls.normalGatingEnabled,
            }}
            blendSupportGating={{
              enabled: controls.blendSupportGatingEnabled,
              cellSize: controls.blendSupportCellSize,
            }}
            smoothUnion={{
              acceleration: controls.smoothUnionAcceleration,
            }}
            bezelWidth={4}
          >
            <ZStack alignment="center">
              {shapes.map((shape) => (
                <Transform
                  key={shape.id}
                  x={shape.x}
                  y={shape.y}
                  rotation={shape.rotation}
                  origin={GLASS_ORIGIN}
                >
                  <Glass cornerRadius={controls.cornerRadius}>
                    <Frame width={shape.width} height={shape.height} />
                  </Glass>
                </Transform>
              ))}
            </ZStack>
          </GlassContainer>
        </Frame>
      </ZStack>
    </LiquidScene>
  )
}

type ShapeInteractionLayerProps = {
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, shape: ShapeState) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  shapes: ShapeState[]
}

export function ShapeInteractionLayer({
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  shapes,
}: ShapeInteractionLayerProps) {
  return (
    <div className="blending-interaction-layer" aria-hidden="true">
      {shapes.map((shape) => (
        <div
          key={shape.id}
          className="blending-shape-hitbox"
          style={{
            width: shape.width + CORNER_HIT_RADIUS * 2,
            height: shape.height + CORNER_HIT_RADIUS * 2,
            transform: `translate(-50%, -50%) translate(${shape.x}px, ${shape.y}px) rotate(${shape.rotation}rad)`,
          }}
          onPointerDown={(event) => onPointerDown(event, shape)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <span className="blending-edge-hit top" />
          <span className="blending-edge-hit right" />
          <span className="blending-edge-hit bottom" />
          <span className="blending-edge-hit left" />
          <span className="blending-corner-hit top-left" />
          <span className="blending-corner-hit top-right" />
          <span className="blending-corner-hit bottom-right" />
          <span className="blending-corner-hit bottom-left" />
        </div>
      ))}
    </div>
  )
}
