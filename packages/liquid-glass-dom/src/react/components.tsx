import { useEffect } from 'react'
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
import {
  renderNodeChildren,
  useAttachNode,
  useDecorationSlotRegistrar,
  useExposeRef,
  useNodeParent,
  useRetainedLayoutEffect,
  useStableNode,
} from './tree'

/** Horizontal stack layout component. */
export function HStack({ ref, children, spacing = 0, alignment = 'center' }: HStackProps) {
  const node = useStableNode(() => new LayoutHStack({ spacing, alignment }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useRetainedLayoutEffect(() => {
    node.spacing = spacing
    node.alignment = alignment
  }, [node, spacing, alignment])

  return renderNodeChildren(useNodeParent(node), children)
}

/** Vertical stack layout component. */
export function VStack({ ref, children, spacing = 0, alignment = 'center' }: VStackProps) {
  const node = useStableNode(() => new LayoutVStack({ spacing, alignment }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useRetainedLayoutEffect(() => {
    node.spacing = spacing
    node.alignment = alignment
  }, [node, spacing, alignment])

  return renderNodeChildren(useNodeParent(node), children)
}

/** Z-stack layout component. */
export function ZStack({ ref, children, alignment = 'center' }: ZStackProps) {
  const node = useStableNode(() => new LayoutZStack({ alignment }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useRetainedLayoutEffect(() => {
    node.alignment = alignment
  }, [node, alignment])

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
  useRetainedLayoutEffect(() => {
    node.width = width
    node.height = height
    node.minWidth = minWidth
    node.minHeight = minHeight
    node.idealWidth = idealWidth
    node.idealHeight = idealHeight
    node.maxWidth = maxWidth
    node.maxHeight = maxHeight
    node.alignment = alignment
  }, [node, width, height, minWidth, minHeight, idealWidth, idealHeight, maxWidth, maxHeight, alignment])

  return renderNodeChildren(useNodeParent(node), children)
}

/** Padding layout component. */
export function Padding({ ref, children, insets = 0 }: PaddingProps) {
  const node = useStableNode(() => new LayoutPadding({ insets }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useRetainedLayoutEffect(() => {
    node.insets = insets
  }, [node, insets])

  return renderNodeChildren(useNodeParent(node), children)
}

/** Overlay layout component with a dedicated overlay slot prop. */
export function Overlay({ ref, children, overlay, alignment = 'center' }: OverlayProps) {
  const node = useStableNode(() => new LayoutOverlay({ alignment }))
  const contentParent = useDecorationSlotRegistrar(node, 'content')
  const overlayParent = useDecorationSlotRegistrar(node, 'decoration')
  useExposeRef(ref, node)
  useAttachNode(node)
  useRetainedLayoutEffect(() => {
    node.alignment = alignment
  }, [node, alignment])

  return (
    <>
      {renderNodeChildren(contentParent, children)}
      {renderNodeChildren(overlayParent, overlay)}
    </>
  )
}

/** Background layout component with a dedicated background slot prop. */
export function Background({ ref, children, background, alignment = 'center' }: BackgroundProps) {
  const node = useStableNode(() => new LayoutBackground({ alignment }))
  const contentParent = useDecorationSlotRegistrar(node, 'content')
  const backgroundParent = useDecorationSlotRegistrar(node, 'decoration')
  useExposeRef(ref, node)
  useAttachNode(node)
  useRetainedLayoutEffect(() => {
    node.alignment = alignment
  }, [node, alignment])

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
}: TransformProps) {
  const node = useStableNode(() => new LayoutTransform({ x, y, scaleX, scaleY, rotation, origin }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useRetainedLayoutEffect(() => {
    node.x = x
    node.y = y
    node.scaleX = scaleX
    node.scaleY = scaleY
    node.rotation = rotation
    node.origin = origin ?? { x: 0, y: 0 }
  }, [node, x, y, scaleX, scaleY, rotation, origin])

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
  useRetainedLayoutEffect(() => {
    if (spacing !== undefined) node.spacing = spacing
    if (blur !== undefined) node.blur = blur
    if (bezelWidth !== undefined) node.bezelWidth = bezelWidth
    if (thickness !== undefined) node.thickness = thickness
    if (displacementFactor !== undefined) node.displacementFactor = displacementFactor
    if (ior !== undefined) node.ior = ior
    if (contentIor !== undefined) node.contentIor = contentIor
    if (contentDepth !== undefined) node.contentDepth = contentDepth
    if (dispersion !== undefined) node.dispersion = dispersion
    if (surfaceProfile !== undefined) node.surfaceProfile = surfaceProfile
    if (lightDirection !== undefined) node.lightDirection = lightDirection
    if (specularStrength !== undefined) node.specularStrength = specularStrength
    if (specularWidth !== undefined) node.specularWidth = specularWidth
    if (specularFalloff !== undefined) node.specularFalloff = specularFalloff
    if (oppositeSpecularStrength !== undefined) node.oppositeSpecularStrength = oppositeSpecularStrength
    if (specularSharpness !== undefined) node.specularSharpness = specularSharpness
    if (specularOpacity !== undefined) node.specularOpacity = specularOpacity
    if (reflectionOffset !== undefined) node.reflectionOffset = reflectionOffset
    if (tint !== undefined) node.tint = tint
    if (zIndex !== undefined) node.zIndex = zIndex
  }, [
    node,
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
  ])

  return renderNodeChildren(useNodeParent(node), children)
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
}: GlassProps) {
  const hasPointerHandler = Boolean(
    onClick ||
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
    cornerTransitionSpeed,
    pointerEvents: effectivePointerEvents,
    zIndex,
  }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useRetainedLayoutEffect(() => {
    if (cornerRadius !== undefined) node.cornerRadius = cornerRadius
    if (cornerTransitionSpeed !== undefined) node.cornerTransitionSpeed = cornerTransitionSpeed
    node.pointerEvents = effectivePointerEvents
    if (zIndex !== undefined) node.zIndex = zIndex
  }, [node, cornerRadius, cornerTransitionSpeed, effectivePointerEvents, zIndex])

  useEffect(() => {
    const listeners: Array<[string, GlassPointerHandler | undefined]> = [
      ['click', onClick],
      ['pointerenter', onPointerEnter],
      ['pointerleave', onPointerLeave],
      ['pointermove', onPointerMove],
      ['pointerdown', onPointerDown],
      ['pointerup', onPointerUp],
      ['pointercancel', onPointerCancel],
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
  }, [node, onClick, onPointerEnter, onPointerLeave, onPointerMove, onPointerDown, onPointerUp, onPointerCancel])

  return renderNodeChildren(useNodeParent(node), children)
}

/** DOM-backed HTML layout component. */
export function Html({
  ref,
  children,
  zIndex,
  sizing,
}: HtmlProps) {
  const node = useStableNode(() => new LayoutHtml({
    zIndex,
    sizing,
  }))
  useExposeRef(ref, node)
  useAttachNode(node)

  useRetainedLayoutEffect(() => {
    node.sizing = sizing
    if (zIndex !== undefined) {
      node.zIndex = zIndex
    }
  }, [
    node,
    zIndex,
    sizing,
  ])

  return node.element ? createPortal(children, node.element) : null
}

/** Layout-only spacer component. */
export function Spacer({ ref, minLength }: SpacerProps) {
  const node = useStableNode(() => new LayoutSpacer({ minLength }))
  useExposeRef(ref, node)
  useAttachNode(node)
  useRetainedLayoutEffect(() => {
    if (minLength !== undefined) node.minLength = minLength
  }, [node, minLength])

  return null
}
