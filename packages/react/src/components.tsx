import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Background as LayoutBackground,
  Frame as LayoutFrame,
  Glass as LayoutGlass,
  GlassContainer as LayoutGlassContainer,
  HStack as LayoutHStack,
  Html as LayoutHtml,
  Overlay as LayoutOverlay,
  Padding as LayoutPadding,
  Spacer as LayoutSpacer,
  Transform as LayoutTransform,
  VStack as LayoutVStack,
  ZStack as LayoutZStack,
} from '@liquid-dom/core/layout'
import type {
  BackgroundProps,
  GlassPointerHandler,
  GlassContainerProps,
  GlassProps,
  FrameProps,
  HStackProps,
  HtmlProps,
  OverlayProps,
  PaddingProps,
  SpacerProps,
  TransformProps,
  VStackProps,
  ZStackProps,
} from './types'
import type { GlassOptions } from '@liquid-dom/core/layout'
import { useAnimatedProps } from './animatedProps'
import {
  renderNodeChildren,
  useAttachNode,
  useDecorationSlotRegistrar,
  useExposeRef,
  useNodeParent,
  useStableNode,
} from './tree'

/** Horizontal stack layout component. */
export function HStack({ ref, children, spacing = 0, alignment = 'center', transition }: HStackProps) {
  const node = useStableNode(() => new LayoutHStack({ spacing, alignment }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, { spacing, alignment }, transition)

  return renderNodeChildren(useNodeParent(node), children)
}

/** Vertical stack layout component. */
export function VStack({ ref, children, spacing = 0, alignment = 'center', transition }: VStackProps) {
  const node = useStableNode(() => new LayoutVStack({ spacing, alignment }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, { spacing, alignment }, transition)

  return renderNodeChildren(useNodeParent(node), children)
}

/** Z-stack layout component. */
export function ZStack({ ref, children, alignment = 'center', transition }: ZStackProps) {
  const node = useStableNode(() => new LayoutZStack({ alignment }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, { alignment }, transition)

  return renderNodeChildren(useNodeParent(node), children)
}

/** Fixed, constrained, or aligned frame layout component. */
export function Frame({
  ref,
  children,
  width,
  height,
  minWidth,
  minHeight,
  idealWidth,
  idealHeight,
  maxWidth,
  maxHeight,
  alignment = 'center',
  transition,
}: FrameProps) {
  const node = useStableNode(() => new LayoutFrame({
    width,
    height,
    minWidth,
    minHeight,
    idealWidth,
    idealHeight,
    maxWidth,
    maxHeight,
    alignment,
  }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, {
    width,
    height,
    minWidth,
    minHeight,
    idealWidth,
    idealHeight,
    maxWidth,
    maxHeight,
    alignment,
  }, transition)

  return renderNodeChildren(useNodeParent(node), children)
}

/** Padding layout component. */
export function Padding({ ref, children, insets = 0, transition }: PaddingProps) {
  const node = useStableNode(() => new LayoutPadding({ insets }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, { insets }, transition)

  return renderNodeChildren(useNodeParent(node), children)
}

/** Overlay layout component with a dedicated overlay slot prop. */
export function Overlay({ ref, children, overlay, alignment = 'center', transition }: OverlayProps) {
  const node = useStableNode(() => new LayoutOverlay({ alignment }))
  const contentParent = useDecorationSlotRegistrar(node, 'content')
  const overlayParent = useDecorationSlotRegistrar(node, 'decoration')
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, { alignment }, transition)

  return (
    <>
      {renderNodeChildren(contentParent, children)}
      {renderNodeChildren(overlayParent, overlay)}
    </>
  )
}

/** Background layout component with a dedicated background slot prop. */
export function Background({ ref, children, background, alignment = 'center', transition }: BackgroundProps) {
  const node = useStableNode(() => new LayoutBackground({ alignment }))
  const contentParent = useDecorationSlotRegistrar(node, 'content')
  const backgroundParent = useDecorationSlotRegistrar(node, 'decoration')
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, { alignment }, transition)

  return (
    <>
      {renderNodeChildren(contentParent, children)}
      {renderNodeChildren(backgroundParent, background)}
    </>
  )
}

/** Transform-only layout component. */
export function Transform({
  ref,
  children,
  x = 0,
  y = 0,
  scaleX = 1,
  scaleY = 1,
  rotation = 0,
  origin,
  transition,
}: TransformProps) {
  const node = useStableNode(() => new LayoutTransform({ x, y, scaleX, scaleY, rotation, origin }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, {
    x,
    y,
    scaleX,
    scaleY,
    rotation,
    origin: origin ?? { x: 0, y: 0 },
  }, transition)

  return renderNodeChildren(useNodeParent(node), children)
}

/** Liquid-glass container component. */
export function GlassContainer({
  ref,
  children,
  opacity,
  spacing,
  blur,
  bezelWidth,
  thickness,
  displacementFactor,
  displacementBlur,
  normalGating,
  blendSupportGating,
  smoothUnion,
  ior,
  contentIor,
  contentDepth,
  dispersion,
  surfaceProfile,
  lightDirection,
  specularStrength,
  specularWidth,
  specularFalloff,
  oppositeSpecularStrength,
  specularSharpness,
  specularOpacity,
  reflectionOffset,
  tint,
  shadowColor,
  shadowOffsetX,
  shadowOffsetY,
  shadowBlur,
  shadowSpread,
  debugDisplacement,
  zIndex,
  transition,
}: GlassContainerProps) {
  const node = useStableNode(() => new LayoutGlassContainer({
    spacing,
    opacity,
    blur,
    bezelWidth,
    thickness,
    displacementFactor,
    displacementBlur,
    normalGating,
    blendSupportGating,
    smoothUnion,
    ior,
    contentIor,
    contentDepth,
    dispersion,
    surfaceProfile,
    lightDirection,
    specularStrength,
    specularWidth,
    specularFalloff,
    oppositeSpecularStrength,
    specularSharpness,
    specularOpacity,
    reflectionOffset,
    tint,
    shadowColor,
    shadowOffsetX,
    shadowOffsetY,
    shadowBlur,
    shadowSpread,
    debugDisplacement,
    zIndex,
  }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, {
    spacing,
    opacity,
    blur,
    bezelWidth,
    thickness,
    displacementFactor,
    displacementBlur,
    normalGating,
    blendSupportGating,
    smoothUnion,
    ior,
    contentIor,
    contentDepth,
    dispersion,
    surfaceProfile,
    lightDirection,
    specularStrength,
    specularWidth,
    specularFalloff,
    oppositeSpecularStrength,
    specularSharpness,
    specularOpacity,
    reflectionOffset,
    tint,
    shadowColor,
    shadowOffsetX,
    shadowOffsetY,
    shadowBlur,
    shadowSpread,
    debugDisplacement,
    zIndex,
  }, transition, { assignUndefined: false })

  return renderNodeChildren(useNodeParent(node), children)
}

/** Liquid-glass shape component. */
export function Glass({
  ref,
  children,
  cornerRadius,
  cornerSmoothing,
  pointerEvents,
  zIndex,
  onClick,
  onHover,
  onPress,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  transition,
}: GlassProps) {
  const hoveredRef = useRef(false)
  const pressedRef = useRef(false)
  const hasPointerHandler = Boolean(
    onClick ||
    onHover ||
    onPress ||
    onPointerEnter ||
    onPointerLeave ||
    onPointerMove ||
    onPointerDown ||
    onPointerUp ||
    onPointerCancel,
  )
  const effectivePointerEvents = pointerEvents ?? hasPointerHandler
  const node = useStableNode(() => new LayoutGlass({
    cornerRadius,
    cornerSmoothing,
    pointerEvents: effectivePointerEvents,
    zIndex,
  }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, {
    cornerRadius,
    cornerSmoothing,
    pointerEvents: effectivePointerEvents,
    zIndex,
  }, transition, { assignUndefined: false })

  useEffect(() => {
    const setHoverState = (nextHovered: boolean) => {
      if (hoveredRef.current === nextHovered) {
        return
      }

      hoveredRef.current = nextHovered
      onHover?.(nextHovered)
    }

    const setPressState = (nextPressed: boolean) => {
      if (pressedRef.current === nextPressed) {
        return
      }

      pressedRef.current = nextPressed
      onPress?.(nextPressed)
    }

    const listeners: Array<[string, GlassPointerHandler | undefined]> = [
      ['click', onClick],
      ['pointerenter', onHover || onPointerEnter ? (event) => {
        setHoverState(true)
        onPointerEnter?.(event)
      } : undefined],
      ['pointerleave', onHover || onPress || onPointerLeave ? (event) => {
        setHoverState(false)
        setPressState(false)
        onPointerLeave?.(event)
      } : undefined],
      ['pointermove', onPointerMove],
      ['pointerdown', onPress || onPointerDown ? (event) => {
        setPressState(true)
        onPointerDown?.(event)
      } : undefined],
      ['pointerup', onPress || onPointerUp ? (event) => {
        setPressState(false)
        onPointerUp?.(event)
      } : undefined],
      ['pointercancel', onPress || onPointerCancel ? (event) => {
        setPressState(false)
        onPointerCancel?.(event)
      } : undefined],
    ]

    for (const [type, listener] of listeners) {
      if (listener) {
        node.sceneNode.addEventListener(type, listener as EventListener)
      }
    }

    return () => {
      for (const [type, listener] of listeners) {
        if (listener) {
          node.sceneNode.removeEventListener(type, listener as EventListener)
        }
      }
    }
  }, [
    node,
    onClick,
    onHover,
    onPress,
    onPointerEnter,
    onPointerLeave,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
  ])

  return renderNodeChildren(useNodeParent(node), children)
}

/** DOM-backed HTML layout component. */
export function Html({
  ref,
  children,
  opacity,
  blur,
  zIndex,
  sizing,
  transition,
}: HtmlProps) {
  const node = useStableNode(() => new LayoutHtml({
    opacity,
    blur,
    zIndex,
    sizing,
  }))
  useExposeRef(ref, node)
  useAttachNode(node)

  useAnimatedProps(node, { sizing }, transition)
  useAnimatedProps(node, { opacity, blur, zIndex }, transition, { assignUndefined: false })

  return node.element ? createPortal(children, node.element) : null
}

/** Layout-only spacer component. */
export function Spacer({ ref, minLength, transition }: SpacerProps) {
  const node = useStableNode(() => new LayoutSpacer({ minLength }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, { minLength }, transition, { assignUndefined: false })

  return null
}
