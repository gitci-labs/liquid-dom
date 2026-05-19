# @liquid-dom/r3f

## Description

`@liquid-dom/r3f` bridges React Three Fiber, Three's WebGPU renderer, and the retained React liquid-glass scene. It renders your R3F scene into an intermediate backdrop target, then composites liquid glass over it.

## Install

```sh
pnpm add @liquid-dom/r3f @liquid-dom/react @react-three/fiber react react-dom three
```

## Quick Start

```tsx
import * as THREE from 'three/webgpu'
import { Canvas, extend } from '@react-three/fiber'
import { LiquidGlassR3F } from '@liquid-dom/r3f'
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
} from '@liquid-dom/react'

extend(THREE as any)

export function App() {
  return (
    <LiquidGlassR3F.Root>
      <Canvas
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer(props as any)
          await renderer.init()
          return renderer
        }}
      >
        <mesh>
          <boxGeometry />
          <meshBasicNodeMaterial color="hotpink" />
        </mesh>

        <LiquidGlassR3F.Render />
      </Canvas>

      <LiquidGlassR3F.Scene>
        <GlassContainer blur={12} spacing={28}>
          <Frame width={280} height={160}>
            <Glass cornerRadius={44}>
              <Html sizing="fill">
                <button>Native content</button>
              </Html>
            </Glass>
          </Frame>
        </GlassContainer>
      </LiquidGlassR3F.Scene>
    </LiquidGlassR3F.Root>
  )
}
```

## API Overview

### Component API

```tsx
<LiquidGlassR3F.Root>
  <Canvas gl={createWebGpuRenderer}>
    <LiquidGlassR3F.Render renderPriority={1} />
  </Canvas>

  <LiquidGlassR3F.Scene>
    {/* @liquid-dom/react layout */}
  </LiquidGlassR3F.Scene>
</LiquidGlassR3F.Root>
```

- `LiquidGlassR3F.Root` shares the retained scene ref and invalidation bridge.
- `LiquidGlassR3F.Scene` creates a headless `LiquidScene` for liquid-glass React components.
- `LiquidGlassR3F.Render` runs inside the R3F canvas and takes over final rendering with a positive frame priority.
- `LiquidGlassR3F` is also callable as the render component, so `<LiquidGlassR3F />` is equivalent to `<LiquidGlassR3F.Render />`.

### Hook API

Use `useLiquidGlassR3F` when you want to own the `LiquidScene` placement yourself.

```tsx
import { Canvas } from '@react-three/fiber'
import { useRef, type RefObject } from 'react'
import { LiquidScene, type LiquidSceneRef } from '@liquid-dom/react'
import { useLiquidGlassR3F } from '@liquid-dom/r3f'

function Bridge() {
  const sceneRootRef = useRef<LiquidSceneRef | null>(null)

  return (
    <>
      <Canvas gl={createWebGpuRenderer}>
        <RenderBridge sceneRootRef={sceneRootRef} />
      </Canvas>

      <LiquidScene ref={sceneRootRef}>
        {/* @liquid-dom/react layout */}
      </LiquidScene>
    </>
  )
}

function RenderBridge({
  sceneRootRef,
}: {
  sceneRootRef: RefObject<LiquidSceneRef | null>
}) {
  useLiquidGlassR3F({ sceneRootRef, renderPriority: 1 })
  return null
}
```

### Render Options

`LiquidGlassR3F.Render` and `useLiquidGlassR3F` accept:

- `renderPriority`: positive R3F frame priority. Defaults to `1`.
- `enabled`: disables rendering without unmounting resources.
- `dpr`: number or function. Defaults to Three's pixel ratio.
- `outputTexture`: optional `GPUTexture` or function returning one.
- `renderTarget`: options for the internal Three backdrop target.
- `onError`: setup or render error handler.

The hook also accepts `sceneRootRef` and `deferUntilSceneRoot`.

## Integration Notes

- This package requires R3F with an initialized Three WebGPU renderer.
- DOM-backed `Html` content from `@liquid-dom/react` requires the experimental HTML-in-Canvas API, currently available only behind Chrome's Canvas Draw Element flag: `chrome://flags/#canvas-draw-element`.
- `renderPriority` must be positive so the bridge can take over final rendering.
- The component API wires retained-scene invalidations into R3F invalidation, including demand-driven frame loops.
- The hook API is lower-level. If you use it directly, make sure the supplied `LiquidScene` invalidates R3F when layout or frame state changes.
- The bridge renders the R3F scene into an internal target before compositing liquid glass.
- Reference: [WICG HTML-in-Canvas](https://wicg.github.io/html-in-canvas/).

## Local Development

```sh
pnpm --filter @liquid-dom/r3f build
pnpm --filter @liquid-dom/r3f watch
```
