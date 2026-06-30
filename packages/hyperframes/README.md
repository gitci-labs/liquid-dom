# @liquid-dom/hyperframes

HyperFrames adapter for Liquid DOM.

HyperFrames captures HTML at deterministic timeline times. This package keeps Liquid DOM in that model:

- no internal `requestAnimationFrame` loop by default
- fixed composition-sized canvas mounting
- explicit `renderAt(time)` calls for seeked frames
- renderer resize synchronization before each deterministic frame
- optional GSAP timeline binding
- `ready` promise for WebGPU initialization
- CSS fallback when WebGPU is unavailable or initialization fails in headless capture

## Usage

```ts
import { Container, Glass, Scene } from '@liquid-dom/core'
import { createHyperFramesLiquidRenderer } from '@liquid-dom/hyperframes'

const scene = new Scene()
const container = new Container({ x: 64, y: 1480, blur: 16 })
container.add(new Glass({ width: 520, height: 124, cornerRadius: 36 }))
scene.add(container)

const liquid = createHyperFramesLiquidRenderer({
  scene,
  mount: document.querySelector('#liquid-layer')!,
  width: 1080,
  height: 1920,
  timeline: window.__timelines?.['lesson'],
  fallback: true,
  onFrame: ({ time, mode }) => {
    // Mutate scene graph from HyperFrames time here.
  },
  onFallback: (error) => {
    // Optional: record that WebGPU was unavailable and CSS fallback is active.
  },
})

window.__lessonLiquidReady = liquid.ready
```

Use `renderAt(time)` from GSAP callbacks or HyperFrames seek hooks. Each render re-reads the mounted canvas bounds before drawing, so captures do not keep a stale temporary canvas size. If you use a GSAP timeline, the adapter wraps `onUpdate`, `onStart`, and `onComplete` so the WebGPU canvas updates when HyperFrames seeks or plays the timeline.

When `fallback !== false`, the adapter downgrades to a deterministic DOM fallback in two cases:

- `navigator.gpu` is not available before construction.
- WebGPU is present but adapter/device/canvas initialization rejects after construction.

That second case is common in automated video capture environments, so `ready` resolves with `mode === 'fallback'` instead of rejecting.
