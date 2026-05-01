import type { CSSProperties, MutableRefObject, ReactNode, Ref } from 'react'
import type { GlassPointerEvent } from '../events'
import type {
  Background as LayoutBackground,
  Frame as LayoutFrame,
  Glass as LayoutGlass,
  GlassContainer as LayoutGlassContainer,
  HStack as LayoutHStack,
  Html as LayoutHtml,
  LayoutScene,
  Overlay as LayoutOverlay,
  Padding as LayoutPadding,
  Spacer as LayoutSpacer,
  Transform as LayoutTransform,
  VStack as LayoutVStack,
  ZStack as LayoutZStack,
  GlassContainerOptions,
  GlassOptions,
  HtmlOptions,
  LayoutUiNode,
  TransformOptions,
} from '../layout'
import type { Renderer } from '../renderer'
import type {
  DecorationOptions,
  FrameOptions,
  PaddingOptions,
  ProposedSize,
  SpacerOptions,
  StackOptions,
  ZStackOptions,
} from 'laymeout'

export type LayoutParent = LayoutScene | LayoutUiNode

export type FrameLoopEntry = {
  callbackRef: MutableRefObject<FrameCallback>
  priority: number
  order: number
}

export type RegisteredChild = {
  node: LayoutUiNode
  order: number
  sequence: number
}

export type ChildRegistrar = {
  registerChild: (node: LayoutUiNode, order: number) => () => void
}

export type RootContextValue = {
  layoutScene: LayoutScene
  getRenderer: () => Renderer | null
  invalidateLayout: () => void
  invalidateFrame: () => void
  registerFrame: (callbackRef: MutableRefObject<FrameCallback>, priority: number) => () => void
}

export type FrameState = {
  layoutScene: LayoutScene
  renderer: Renderer
  scene: LayoutScene['scene']
  canvas: HTMLCanvasElement
  time: number
  delta: number
  invalidateLayout: () => void
  invalidateFrame: () => void
}

/** Callback registered into a {@link LayoutCanvas} frame loop. */
export type FrameCallback = (state: FrameState) => void
/** Render-loop mode used by {@link LayoutCanvas}. */
export type FrameLoopMode = 'always' | 'demand'
/** Imperative handle exposed by {@link LayoutCanvas}. */
export type LayoutCanvasRef = {
  readonly layoutScene: LayoutScene
  readonly scene: LayoutScene['scene']
  readonly renderer: Renderer
  readonly canvas: HTMLCanvasElement
  invalidateLayout: () => void
  invalidateFrame: () => void
}

export type HStackRef = LayoutHStack
export type VStackRef = LayoutVStack
export type FrameRef = LayoutFrame
export type PaddingRef = LayoutPadding
export type OverlayRef = LayoutOverlay
export type BackgroundRef = LayoutBackground
export type ZStackRef = LayoutZStack
export type TransformRef = LayoutTransform
export type GlassContainerRef = LayoutGlassContainer
export type GlassRef = LayoutGlass
export type HtmlRef = LayoutHtml
export type SpacerRef = LayoutSpacer

export type RefProp<T> = {
  ref?: Ref<T>
}

export type ChildrenProp = {
  children?: ReactNode
}

export type LayoutCanvasProps = ChildrenProp & RefProp<LayoutCanvasRef> & {
  className?: string
  style?: CSSProperties
  canvasClassName?: string
  canvasStyle?: CSSProperties
  maxDpr?: number
  proposal?: ProposedSize
  frameloop?: FrameLoopMode
  onError?: (error: unknown) => void
}

export type HStackProps = ChildrenProp & RefProp<HStackRef> & StackOptions
export type VStackProps = ChildrenProp & RefProp<VStackRef> & StackOptions
export type ZStackProps = ChildrenProp & RefProp<ZStackRef> & ZStackOptions
export type FrameProps = ChildrenProp & RefProp<FrameRef> & FrameOptions
export type PaddingProps = ChildrenProp & RefProp<PaddingRef> & PaddingOptions
export type OverlayProps = ChildrenProp & RefProp<OverlayRef> & DecorationOptions & {
  overlay?: ReactNode
}
export type BackgroundProps = ChildrenProp & RefProp<BackgroundRef> & DecorationOptions & {
  background?: ReactNode
}
export type TransformProps = ChildrenProp & RefProp<TransformRef> & TransformOptions
export type GlassContainerProps = ChildrenProp & RefProp<GlassContainerRef> & GlassContainerOptions
export type GlassPointerHandler = (event: GlassPointerEvent) => void
export type GlassProps = ChildrenProp & RefProp<GlassRef> & GlassOptions & {
  onClick?: GlassPointerHandler
  onPointerEnter?: GlassPointerHandler
  onPointerLeave?: GlassPointerHandler
  onPointerMove?: GlassPointerHandler
  onPointerDown?: GlassPointerHandler
  onPointerUp?: GlassPointerHandler
  onPointerCancel?: GlassPointerHandler
}
export type HtmlProps = ChildrenProp & RefProp<HtmlRef> & Omit<HtmlOptions, 'element'>
export type SpacerProps = RefProp<SpacerRef> & SpacerOptions
