# @liquid-dom/hyperframes

HyperFrames adapter for Liquid DOM.

HyperFrames captures HTML at deterministic timeline times. This package keeps Liquid DOM in that model:

- no internal `requestAnimationFrame` loop by default
- fixed composition-sized canvas mounting
- explicit `renderAt(time)` calls for seeked frames
- optional GSAP timeline binding
- `ready` promise for WebGPU initialization
- CSS fallback when WebGPU is unavailable in headless capture

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
  onFrame: (time) => {
    // Mutate scene graph from HyperFrames time here.
  },
})

window.__lessonLiquidReady = liquid.ready
```

Use `renderAt(time)` from GSAP callbacks or HyperFrames seek hooks. If you use a GSAP timeline, the adapter wraps `onUpdate`, `onStart`, and `onComplete` so the WebGPU canvas updates when HyperFrames seeks or plays the timeline.
