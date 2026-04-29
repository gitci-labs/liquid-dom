# liquid-glass-dom

`liquid-glass-dom` renders a small scene graph of DOM-backed HTML layers and liquid-glass containers into a WebGPU canvas.

The core API is imperative:

```ts
import { Container, Glass, Html, Renderer, Scene } from 'liquid-glass-dom'

const scene = new Scene()

const backgroundElement = document.createElement('div')
backgroundElement.className = 'background'
const background = new Html({
  width: 800,
  height: 600,
  zIndex: -1,
  element: backgroundElement,
})
scene.add(background)

const container = new Container({
  x: 120,
  y: 120,
  blur: 8,
  spacing: 28,
  thickness: 90,
  zIndex: 0,
})

const glass = new Glass({
  width: 280,
  height: 180,
  cornerRadius: 48,
  pointerEvents: true,
})

const button = document.createElement('button')
button.textContent = 'Native button'
glass.add(new Html({
  x: 24,
  y: 24,
  width: 180,
  height: 56,
  element: button,
}))

container.add(glass)
scene.add(container)

const renderer = new Renderer({ scene })
document.body.append(renderer.canvas)

function frame() {
  renderer.render()
  requestAnimationFrame(frame)
}
frame()
```

## Exports

```ts
import {
  Container,
  Glass,
  GlassPointerEvent,
  Html,
  Renderer,
  Scene,
  type BackdropMetrics,
  type GlassPointerEventType,
  type Point,
  type RgbaColor,
  type SurfaceProfile,
  type Transform,
} from 'liquid-glass-dom'
```

## Scene Graph

`Scene` is the root. It accepts `Container` and `Html` children:

```ts
scene.add(new Html({ width: 800, height: 600, zIndex: -1, element }))
scene.add(new Container({ zIndex: 0 }))
```

Scene children are rendered by `zIndex`, then by entry order. A scene-level `Html` layer below a `Container` becomes backdrop content for that container. A scene-level `Html` layer above a `Container` covers it and becomes backdrop content for later containers.

`Container` accepts `Glass` children. A container's glass children are fused into one liquid-glass SDF field and share optical settings.

`Glass` accepts any number of `Html` children. Each child is copied independently and sampled through the owning glass using the child `Html` transform.

## `Html`

`Html` is a DOM-backed leaf node:

```ts
new Html(options?: Partial<Transform> & {
  width?: number
  height?: number
  zIndex?: number
  element?: HTMLElement | null
})
```

Properties:

- `x`, `y`, `scaleX`, `scaleY`, `rotation`, `origin`
- `width`, `height`
- `zIndex`
- `element`
- `host: HTMLDivElement`

Methods:

- `setElement(element: HTMLElement | null): void`
- `remove(): void`

Each `Html` creates and owns its own `host` element. The host is sized from `width` and `height`. `setElement(element)` replaces the host's single child with `element`; `setElement(null)` leaves the host empty. The renderer mounts, transforms, orders, copies, and unmounts the host while the `Html` node is attached to a scene or glass.

The renderer does not assign CSS `pointer-events` properties. Browser interaction is left to normal DOM hit testing for the hosted elements.

## `Glass`

```ts
new Glass(options?: Partial<Transform> & {
  width?: number
  height?: number
  cornerRadius?: number
  cornerTransitionSpeed?: number
  pointerEvents?: boolean
  zIndex?: number
})
```

Properties:

- `x`, `y`, `scaleX`, `scaleY`, `rotation`, `origin`
- `width`, `height`
- `cornerRadius`
- `cornerTransitionSpeed`
- `pointerEvents`
- `zIndex`

Methods:

- `add(child: Html): Html`
- `remove(): void`
- `addEventListener(...)`
- `removeEventListener(...)`

Glass pointer events are renderer-side SDF hit tests. Enable them per glass with `pointerEvents: true`.

Supported event names:

- `click`
- `pointerenter`
- `pointerleave`
- `pointermove`
- `pointerdown`
- `pointerup`
- `pointercancel`

`GlassPointerEvent` exposes:

- `glass`
- `renderer`
- `nativeEvent`
- `pointerId`, `pointerType`, `isPrimary`, `button`, `buttons`
- `clientX`, `clientY`
- `canvasX`, `canvasY`
- `localX`, `localY`
- `inside`

Calling `preventDefault()` on a `GlassPointerEvent` forwards to the native pointer event after dispatch.

Glass pointer hits are based on the individual glass SDF, not fused bridge regions between neighboring glasses. Hosted DOM elements inside a glass can still receive normal browser pointer events, and glass listeners still fire from the renderer's hit-testing path.

Within one container, glass pointer targeting uses higher `glass.zIndex`; ties use later entry order. Across containers, the visually later container layer wins.

## `Container`

```ts
new Container(options?: Partial<Transform> & {
  spacing?: number
  blur?: number
  bezelWidth?: number
  thickness?: number
  displacementFactor?: number
  ior?: number
  contentIor?: number
  contentDepth?: number
  dispersion?: number
  surfaceProfile?: 'convex' | 'concave' | 'lip'
  lightDirection?: number
  specularStrength?: number
  specularWidth?: number
  specularFalloff?: number
  oppositeSpecularStrength?: number
  specularSharpness?: number
  specularOpacity?: number
  reflectionOffset?: number
  tint?: RgbaColor
  zIndex?: number
})
```

When `oppositeSpecularStrength` is omitted, it defaults to the resolved `specularStrength`.

Methods:

- `add(child: Glass): Glass`
- `remove(): void`

`contentIor` and `contentDepth` affect refraction of `Html` children rendered inside glass nodes.

## `Renderer`

```ts
new Renderer(options?: {
  scene?: Scene
  maxDpr?: number
})
```

Properties:

- `scene`
- `canvas`
- `maxDpr`

Methods:

- `render(): void`
- `destroy(): void`
- `setBackdropMetricsTracking(container: Container, enabled: boolean): void`
- `getBackdropMetrics(container: Container): BackdropMetrics | null`

`Renderer` creates a `<canvas layoutsubtree="true">`. Append `renderer.canvas` to the page, size it with CSS, and call `renderer.render()` from your own render loop.

## Development

```sh
pnpm --filter liquid-glass-dom build
pnpm --filter minimal build
```
