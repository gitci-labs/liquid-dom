# liquid-glass-dom

`liquid-glass-dom` is an imperative WebGPU renderer for layered liquid-glass effects.

It exposes a small scene graph API:

- `Scene` is the root.
- `Group` is a transform-only hierarchy node.
- `Container` is a rendering layer whose child shapes are blended into a single SDF field.
- `Glass` is an individual rounded shape inside a container.
- `Renderer` owns the `<canvas>` and the DOM subtree that gets painted into the canvas as the backdrop.

The package is WebGPU-only and assumes the experimental html-in-canvas APIs used by the demos are available.

## Installation

```bash
pnpm add liquid-glass-dom
```

## Exports

```ts
import {
  Glass,
  Container,
  Group,
  Renderer,
  Scene,
  type Point,
  type RgbaColor,
  type SurfaceProfile,
  type Transform,
} from 'liquid-glass-dom'
```

## Quick Start

```ts
import {
  Glass,
  Container,
  Renderer,
  Scene,
} from 'liquid-glass-dom'

const scene = new Scene()

const container = new Container({
  x: 120,
  y: 140,
  blur: 6,
  spacing: 28,
  bezelWidth: 18,
  thickness: 90,
  surfaceProfile: 'convex',
  zIndex: 1,
})

container.add(
  new Glass({
    x: 0,
    y: 0,
    width: 360,
    height: 120,
    cornerRadius: 56,
  }),
)

scene.add(container)

const renderer = new Renderer({ scene })
document.body.append(renderer.canvas)

renderer.htmlRoot.innerHTML = `
  <div style="height: 100%; overflow: auto; padding: 32px;">
    <h1>Backdrop content</h1>
    <p>This DOM subtree is painted into the canvas and used as the glass backdrop.</p>
  </div>
`

function frame() {
  renderer.render()
  requestAnimationFrame(frame)
}

frame()
```

## Rendering Model

The scene graph has two different roles:

- hierarchy and transforms
- rendering and optical layering

The important rule is:

- `Glass` instances only exist inside a `Container`
- a `Container` renders all of its child `Glass` instances as one blended SDF field
- different containers do not blend SDFs with each other
- different containers do stack visually according to `zIndex`
- later containers see previously rendered containers as part of their backdrop

This lets you build fused shapes within a layer while still stacking multiple glass layers on top of each other.

## Coordinate System

The public API uses the same coordinate system as normal HTML/CSS layout:

- origin is at the top-left corner
- `x` increases to the right
- `y` increases downward
- all positions, sizes, and origins are expressed in CSS pixels
- `rotation` is in radians

`origin` is a local-space pivot point, also in CSS pixels.

## DOM / Backdrop Model

`Renderer` creates two DOM nodes:

- `canvas`
- `htmlRoot`

`htmlRoot` is appended as an immediate child of the canvas. You do not create it yourself. Instead, append your own DOM content inside `renderer.htmlRoot`.

That DOM subtree is copied into a GPU texture during the canvas `paint` event and becomes the source backdrop for blur, refraction, reflection, and glass tint.

The renderer does not start its own render loop. You are responsible for calling `render()`.

## Types

### `Point`

```ts
type Point = {
  x: number
  y: number
}
```

### `Transform`

```ts
interface Transform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  origin: Point
}
```

All scene-graph nodes implement `Transform`.

Default transform values:

- `x = 0`
- `y = 0`
- `scaleX = 1`
- `scaleY = 1`
- `rotation = 0`
- `origin = { x: 0, y: 0 }`

### `SurfaceProfile`

```ts
type SurfaceProfile = 'convex' | 'concave' | 'lip'
```

Profile meanings:

- `convex`: convex squircle bevel
- `concave`: concave variant derived from the convex profile
- `lip`: blends between convex and concave for a lip-like edge

## Scene Graph API

### `class Glass`

An individual rounded shape inside a container.

Constructor:

```ts
new Glass(options?: Partial<Transform> & {
  width?: number
  height?: number
  cornerRadius?: number
  cornerTransitionSpeed?: number
})
```

Properties:

- `x`
- `y`
- `scaleX`
- `scaleY`
- `rotation`
- `origin`
- `width`
- `height`
- `cornerRadius`
- `cornerTransitionSpeed`

Behavior notes:

- `x` and `y` refer to the top-left corner of the local shape bounds
- `width` and `height` are full dimensions, not half extents
- `cornerTransitionSpeed` controls the blend from squircle-like corners to circular corners when the radius becomes large relative to the shape size

Methods:

- `remove(): void`
  - detaches the glass from its parent container if attached
  - no-op if unattached

### `class Container`

A rendering layer. Its child `Glass` instances are fused into one SDF field and rendered together.

Constructor:

```ts
new Container(options?: Partial<Transform> & {
  spacing?: number
  blur?: number
  bezelWidth?: number
  thickness?: number
  displacementFactor?: number
  ior?: number
  dispersion?: number
  surfaceProfile?: SurfaceProfile
  lightDirection?: number
  specularStrength?: number
  specularWidth?: number
  specularSharpness?: number
  specularOpacity?: number
  edgeSaturation?: number
  reflectionOffset?: number
  reflectionSaturation?: number
  tint?: RgbaColor
  zIndex?: number
})
```

Transform properties:

- `x`
- `y`
- `scaleX`
- `scaleY`
- `rotation`
- `origin`

Rendering properties:

- `spacing`
  - soft union distance used when blending child shapes together
- `blur`
  - blur radius used for the blurred backdrop sample
- `bezelWidth`
  - thickness of the beveled edge zone
- `thickness`
  - base glass thickness used by the displacement model
- `displacementFactor`
  - overall scale applied to the refractive displacement
- `ior`
  - base index of refraction
- `dispersion`
  - chromatic dispersion amount
- `surfaceProfile`
  - bevel profile, one of `'convex' | 'concave' | 'lip'`
- `lightDirection`
  - 2D light direction in radians
- `specularStrength`
  - scales rim highlight intensity before opacity
- `specularWidth`
  - rim band width in CSS pixels
- `specularSharpness`
  - highlight falloff exponent
- `specularOpacity`
  - final white specular opacity
- `edgeSaturation`
  - saturation boost for the refracted colored edge component
- `reflectionOffset`
  - offset distance for the reflected edge sample
- `reflectionSaturation`
  - saturation boost for the reflection sample
- `tint`
  - RGBA color layered over the refracted glass interior
- `zIndex`
  - draw order between containers

Defaults:

- `spacing = 42.5`
- `blur = 3.75`
- `bezelWidth = 13.75`
- `thickness = 90`
- `displacementFactor = 1`
- `ior = 1.5`
- `dispersion = 0`
- `surfaceProfile = 'convex'`
- `lightDirection = -52°` expressed in radians
- `specularStrength = 1.4`
- `specularWidth = 0.3`
- `specularSharpness = 2`
- `specularOpacity = 0.15`
- `edgeSaturation = 1.7`
- `reflectionOffset = 18`
- `reflectionSaturation = 0.7`
- `tint = { r: 0.15, g: 0.15, b: 0.15, a: 0.7 }`
- `zIndex = 0`

Methods:

- `add(child: Glass): Glass`
  - reparents `child` if it already belongs to another container
  - appends it to this container
- `remove(): void`
  - detaches the container from its parent group or scene
  - no-op if unattached

### `class Group`

A transform-only hierarchy node for grouping containers or nested groups.

Constructor:

```ts
new Group(options?: Partial<Transform>)
```

Properties:

- `x`
- `y`
- `scaleX`
- `scaleY`
- `rotation`
- `origin`

Methods:

- `add(child: Container | Group): Container | Group`
  - reparents `child` if needed
  - throws if adding the group to itself or to one of its descendants
- `remove(): void`
  - detaches the group from its parent group or scene
  - no-op if unattached

### `class Scene`

The scene root.

Constructor:

```ts
new Scene()
```

Methods:

- `add(child: Container | Group): Container | Group`
  - reparents `child` if needed
  - throws if doing so would create a group cycle

Constraints:

- `Glass` instances cannot be added directly to a `Scene`
- `Glass` instances cannot be added to a `Group`

## Renderer API

### `class Renderer`

Owns the WebGPU renderer, the canvas, and the HTML backdrop subtree.

Constructor:

```ts
new Renderer(options?: {
  scene?: Scene
  maxDpr?: number
})
```

Properties:

- `scene: Scene`
  - the scene being rendered
- `canvas: HTMLCanvasElement`
  - the canvas element you mount in the DOM
- `htmlRoot: HTMLDivElement`
  - the immediate child of the canvas that serves as the backdrop DOM root
- `maxDpr: number`
  - the maximum device-pixel ratio the renderer will use when sizing its internal render targets
  - defaults to `2`

Methods:

- `render(): void`
  - renders one frame
  - does not start or schedule a persistent loop
- `destroy(): void`
  - disconnects observers
  - removes internal listeners
  - destroys GPU resources

Behavior notes:

- the renderer sets `layoutsubtree` on its canvas
- the renderer listens to the canvas `paint` event via `addEventListener('paint', ...)`
- the renderer resizes its GPU targets from a `ResizeObserver`
- the renderer uses the DOM subtree under `htmlRoot` as the copied backdrop
- internal render resolution uses `min(window.devicePixelRatio, maxDpr)`

## Transform Composition

Transforms compose hierarchically:

- `Scene`
- `Group`
- `Container`
- `Glass`

In practice:

- a group transform affects every descendant group and container
- a container transform affects the container’s glass shapes as a whole
- a glass transform applies on top of the container transform

The transform order is:

1. translate by `x`/`y`
2. move to `origin`
3. apply rotation
4. apply scale
5. move back from `origin`

## Layering Semantics

Containers are flattened each frame and sorted by:

1. ascending `zIndex`
2. insertion order as a tie-breaker

That means:

- lower `zIndex` renders first
- higher `zIndex` renders later
- later containers can refract and reflect the already-rendered result below them

## Limits and Performance

There is no fixed hard cap on the number of `Glass` instances in a container, but performance is not unlimited.

Important performance characteristics:

- each additional glass shape adds more SDF work per fragment
- large containers are more expensive than small ones because the shader runs across more pixels
- blur cost scales with render target size and blur radius
- many containers cost more than one container because each container is rendered as a separate layer

If you need many shapes, prefer:

- keeping container count low when possible
- keeping large full-screen layers to a minimum
- using only as much blur as you actually need

## Usage Patterns

### Use one container for fused shapes

If you want multiple shapes to melt into each other, put them in the same `Container`.

### Use multiple containers for stacked glass layers

If you want separate optical layers that do not union together, use multiple containers and control order with `zIndex`.

### Keep your own render loop

The package deliberately does not own a RAF loop. This keeps it usable in:

- React apps
- imperative apps
- editors
- render-on-demand tools

## Environment Requirements

This package currently assumes:

- WebGPU is available
- the browser supports the experimental html-in-canvas APIs used by the demos
- the `paint` event and `copyElementImageToTexture()` path are enabled

No fallback renderer is included.

## Minimal Checklist

To use the package successfully:

1. Create a `Scene`
2. Create one or more `Container` or `Group` instances
3. Add `Glass` instances to containers
4. Add top-level containers or groups to the scene
5. Create a `Renderer`
6. Append `renderer.canvas` to the document
7. Append your own DOM nodes into `renderer.htmlRoot`
8. Call `renderer.render()` whenever you want a new frame
