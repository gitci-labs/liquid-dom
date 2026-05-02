import { useEffect, useRef, useState } from 'react'
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
} from '../layout'
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
import type { GlassOptions } from '../layout'
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
  spacing,
  blur,
  bezelWidth,
  thickness,
  displacementFactor,
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
  zIndex,
  transition,
}: GlassContainerProps) {
  const node = useStableNode(() => new LayoutGlassContainer({
    spacing,
    blur,
    bezelWidth,
    thickness,
    displacementFactor,
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
    zIndex,
  }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useAnimatedProps(node, {
    spacing,
    blur,
    bezelWidth,
    thickness,
    displacementFactor,
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
    zIndex,
  }, transition, { assignUndefined: false })

  return renderNodeChildren(useNodeParent(node), children)
}

function hasInteractionProps(props: Partial<GlassOptions> | undefined) {
  return Boolean(props && Object.keys(props).length > 0)
}

function hasOwnProp(props: Partial<GlassOptions> | undefined, key: keyof GlassOptions) {
  return Boolean(props && Object.prototype.hasOwnProperty.call(props, key))
}

function getGlassProp(node: LayoutGlass, key: keyof GlassOptions) {
  return (node as unknown as Record<string, unknown>)[key]
}

function resolveInteractiveGlassProps(
  node: LayoutGlass,
  base: GlassOptions,
  whileHover: Partial<GlassOptions> | undefined,
  whilePress: Partial<GlassOptions> | undefined,
  hovered: boolean,
  pressed: boolean,
  baseFallback: Partial<GlassOptions>,
) {
  const resolved = { ...base } as Record<string, unknown>
  const fallback = baseFallback as Record<string, unknown>
  const keys = new Set<keyof GlassOptions>([
    ...Object.keys(whileHover ?? {}) as Array<keyof GlassOptions>,
    ...Object.keys(whilePress ?? {}) as Array<keyof GlassOptions>,
  ])

  for (const key of keys) {
    if (!hasOwnProp(baseFallback, key)) {
      fallback[key] = hasOwnProp(base, key) ? (base as Record<string, unknown>)[key] : getGlassProp(node, key)
    }

    if (!hasOwnProp(base, key)) {
      resolved[key] = fallback[key]
    }
    if (hovered && hasOwnProp(whileHover, key)) {
      resolved[key] = (whileHover as Record<string, unknown> | undefined)?.[key]
    }
    if (pressed && hasOwnProp(whilePress, key)) {
      resolved[key] = (whilePress as Record<string, unknown> | undefined)?.[key]
    }
  }

  return resolved as GlassOptions
}

/** Liquid-glass shape component. */
export function Glass({
  ref,
  children,
  cornerRadius,
  cornerTransitionSpeed,
  pointerEvents,
  zIndex,
  onClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  transition,
  whileHover,
  whilePress,
}: GlassProps) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const baseFallbackRef = useRef<Partial<GlassOptions>>({})
  const hasInteraction = hasInteractionProps(whileHover) || hasInteractionProps(whilePress)
  const hasPointerHandler = Boolean(
    onClick ||
    onPointerEnter ||
    onPointerLeave ||
    onPointerMove ||
    onPointerDown ||
    onPointerUp ||
    onPointerCancel,
  )
  const effectivePointerEvents = pointerEvents ?? (hasPointerHandler || hasInteraction)
  const node = useStableNode(() => new LayoutGlass({
    cornerRadius,
    cornerTransitionSpeed,
    pointerEvents: effectivePointerEvents,
    zIndex,
  }))
  useExposeRef(ref, node)
  useAttachNode(node)
  const resolvedProps = resolveInteractiveGlassProps(node, {
    cornerRadius,
    cornerTransitionSpeed,
    pointerEvents: effectivePointerEvents,
    zIndex,
  }, whileHover, whilePress, hovered, pressed, baseFallbackRef.current)
  useAnimatedProps(node, resolvedProps, transition, { assignUndefined: false })

  useEffect(() => {
    const listeners: Array<[string, GlassPointerHandler | undefined]> = [
      ['click', onClick],
      ['pointerenter', hasInteraction || onPointerEnter ? (event) => {
        setHovered(true)
        onPointerEnter?.(event)
      } : undefined],
      ['pointerleave', hasInteraction || onPointerLeave ? (event) => {
        setHovered(false)
        setPressed(false)
        onPointerLeave?.(event)
      } : undefined],
      ['pointermove', onPointerMove],
      ['pointerdown', hasInteraction || onPointerDown ? (event) => {
        setPressed(true)
        onPointerDown?.(event)
      } : undefined],
      ['pointerup', hasInteraction || onPointerUp ? (event) => {
        setPressed(false)
        onPointerUp?.(event)
      } : undefined],
      ['pointercancel', hasInteraction || onPointerCancel ? (event) => {
        setPressed(false)
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
    hasInteraction,
    onClick,
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
  zIndex,
  sizing,
  transition,
}: HtmlProps) {
  const node = useStableNode(() => new LayoutHtml({
    zIndex,
    sizing,
  }))
  useExposeRef(ref, node)
  useAttachNode(node)

  useAnimatedProps(node, { sizing }, transition)
  useAnimatedProps(node, { zIndex }, transition, { assignUndefined: false })

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
