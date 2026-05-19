import type { CSSProperties, MutableRefObject, ReactNode, Ref } from 'react'
import type { GlassPointerEvent, Renderer } from '@liquid-dom/core'
import type {
  AnimateFunction,
  AnimationConfig,
  AnimationManager,
  AnimationTimeline,
  ComponentTransition,
} from './animation'
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
} from '@liquid-dom/core/layout'
import type {
  DecorationOptions,
  FrameOptions,
  PaddingOptions,
  ProposedSize,
  SpacerOptions,
  StackOptions,
  ZStackOptions,
} from '@liquid-dom/layout'

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
  animationManager: AnimationManager
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

/** Callback registered into a {@link LiquidCanvas} frame loop. */
export type FrameCallback = (state: FrameState) => void
/** Render-loop mode used by {@link LiquidCanvas}. */
export type FrameLoopMode = 'always' | 'demand'
/** Imperative handle exposed by {@link LiquidCanvas}. */
export type LiquidCanvasRef = {
  readonly layoutScene: LayoutScene
  readonly scene: LayoutScene['scene']
  readonly renderer: Renderer
  readonly canvas: HTMLCanvasElement
  invalidateLayout: () => void
  invalidateFrame: () => void
}

/** Imperative handle exposed by {@link LiquidScene}. */
export type LiquidSceneRef = {
  readonly layoutScene: LayoutScene
  readonly scene: LayoutScene['scene']
  update: (proposal: ProposedSize, delta?: number) => void
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

export type TransitionProp<T extends object = Record<string, unknown>> = {
  transition?: ComponentTransition<T>
}

export type LiquidCanvasProps = ChildrenProp & RefProp<LiquidCanvasRef> & {
  className?: string
  style?: CSSProperties
  canvasClassName?: string
  canvasStyle?: CSSProperties
  maxDpr?: number
  proposal?: ProposedSize
  frameloop?: FrameLoopMode
  onError?: (error: unknown) => void
}

export type LiquidSceneProps = ChildrenProp & RefProp<LiquidSceneRef> & {
  /** Called when the retained scene needs a new frame without a layout pass. */
  onInvalidateFrame?: () => void
  /** Called when the retained scene needs layout before the next frame. */
  onInvalidateLayout?: () => void
}

export type HStackProps = ChildrenProp & RefProp<HStackRef> & StackOptions & TransitionProp<StackOptions>
export type VStackProps = ChildrenProp & RefProp<VStackRef> & StackOptions & TransitionProp<StackOptions>
export type ZStackProps = ChildrenProp & RefProp<ZStackRef> & ZStackOptions & TransitionProp<ZStackOptions>
export type FrameProps = ChildrenProp & RefProp<FrameRef> & FrameOptions & TransitionProp<FrameOptions>
export type PaddingProps = ChildrenProp & RefProp<PaddingRef> & PaddingOptions & TransitionProp<PaddingOptions>
export type OverlayProps = ChildrenProp & RefProp<OverlayRef> & DecorationOptions & TransitionProp<DecorationOptions> & {
  overlay?: ReactNode
}
export type BackgroundProps = ChildrenProp & RefProp<BackgroundRef> & DecorationOptions & TransitionProp<DecorationOptions> & {
  background?: ReactNode
}
export type TransformProps = ChildrenProp & RefProp<TransformRef> & TransformOptions & TransitionProp<TransformOptions>
export type GlassContainerProps = ChildrenProp & RefProp<GlassContainerRef> & GlassContainerOptions & TransitionProp<GlassContainerOptions>
export type GlassStateHandler = (active: boolean) => void
export type GlassPointerHandler = (event: GlassPointerEvent) => void
export type GlassProps = ChildrenProp & RefProp<GlassRef> & GlassOptions & TransitionProp<GlassOptions> & {
  whileHover?: Partial<GlassOptions>
  whilePress?: Partial<GlassOptions>
  onHover?: GlassStateHandler
  onPress?: GlassStateHandler
  onClick?: GlassPointerHandler
  onPointerEnter?: GlassPointerHandler
  onPointerLeave?: GlassPointerHandler
  onPointerMove?: GlassPointerHandler
  onPointerDown?: GlassPointerHandler
  onPointerUp?: GlassPointerHandler
  onPointerCancel?: GlassPointerHandler
}
export type HtmlProps = ChildrenProp & RefProp<HtmlRef> & Omit<HtmlOptions, 'element'> & TransitionProp<Omit<HtmlOptions, 'element'>>
export type SpacerProps = RefProp<SpacerRef> & SpacerOptions & TransitionProp<SpacerOptions>

export type {
  AnimateFunction,
  AnimationConfig,
  AnimationTimeline,
  ComponentTransition,
}
