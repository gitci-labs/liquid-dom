import { button, folder, LevaPanel, useControls, useCreateStore } from 'leva'
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  type BackdropMetrics,
  Container,
  Glass,
  Group,
  Renderer,
  Scene,
  type Point,
  type SurfaceProfile,
} from 'liquid-glass-dom'
import {
  EditorBackdrop,
  type AdaptiveTintSettings,
  type BackdropMode,
  type SteppedGradientSettings,
} from './EditorBackdrop'

type TintColor = {
  r: number
  g: number
  b: number
  a: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function channelToHex(value: number) {
  return Math.round(clamp(value, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0')
}

function tintToHex(tint: TintColor) {
  return `#${channelToHex(tint.r)}${channelToHex(tint.g)}${channelToHex(tint.b)}`
}

function hexToTint(hex: string, alpha: number): TintColor {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
    a: alpha,
  }
}

const SCENE_ID = 'scene'

type TransformState = {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  origin: Point
}

type BaseNode = {
  id: string
  name: string
} & TransformState

type GlassNode = BaseNode & {
  type: 'glass'
  width: number
  height: number
  cornerRadius: number
  cornerTransitionSpeed: number
}

type ContainerNode = BaseNode & {
  type: 'container'
  spacing: number
  blur: number
  bezelWidth: number
  thickness: number
  displacementFactor: number
  ior: number
  contentIor: number
  contentDepth: number
  dispersion: number
  surfaceProfile: SurfaceProfile
  lightDirection: number
  specularStrength: number
  specularWidth: number
  specularFalloff: number
  oppositeSpecularStrength: number
  specularSharpness: number
  specularOpacity: number
  reflectionOffset: number
  tint: TintColor
  zIndex: number
  children: GlassNode[]
}

type GroupNode = BaseNode & {
  type: 'group'
  children: Array<GroupNode | ContainerNode>
}

type RootNode = GroupNode | ContainerNode
type EditorNode = GroupNode | ContainerNode | GlassNode

type SceneState = {
  children: RootNode[]
}

type NodeLocation = {
  node: EditorNode | null
  parentId: string | null
}

type RuntimeContainerEntry = {
  id: string
  tint: TintColor
  node: Container
  contentBindings: DemoGlassContentBinding[]
}

type RuntimeBuildResult = {
  node: Group | Container
  containers: RuntimeContainerEntry[]
}

type DemoGlassContentBinding = {
  applyBackdropMetrics: (metrics: BackdropMetrics | null) => void
}

type AdaptiveTintState = {
  alpha: number
  currentBrightness: number
  targetBrightness: number
  pendingBrightness: number | null
  observedBrightness: number | null
  settleAt: number
}

type BackdropSettings = {
  mode: BackdropMode
  steppedGradient: SteppedGradientSettings
  adaptiveTint: AdaptiveTintSettings
}

const BACKDROP_SETTINGS_STORAGE_KEY = 'liquid-glass-demo.backdrop-settings'
const DEFAULT_BACKDROP_SETTINGS: BackdropSettings = {
  mode: 'editor',
  steppedGradient: {
    steps: 8,
    stepHeight: 120,
    contentWidth: 500,
  },
  adaptiveTint: {
    easingDurationMs: 500,
    easingDelayMs: 300,
  },
}

const SURFACE_PROFILES: Array<{ value: SurfaceProfile; label: string }> = [
  { value: 'convex', label: 'Convex squircle' },
  { value: 'concave', label: 'Concave' },
  { value: 'lip', label: 'Lip' },
]

const nodeCounts = {
  group: 1,
  container: 1,
  glass: 1,
}

function nextId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function nextName(type: keyof typeof nodeCounts) {
  const value = nodeCounts[type]
  nodeCounts[type] += 1
  return `${type[0].toUpperCase()}${type.slice(1)} ${value}`
}

function createTransformState(overrides: Partial<TransformState> = {}): TransformState {
  return {
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    scaleX: overrides.scaleX ?? 1,
    scaleY: overrides.scaleY ?? 1,
    rotation: overrides.rotation ?? 0,
    origin: overrides.origin ?? { x: 0, y: 0 },
  }
}

function createGlassNode(overrides: Partial<GlassNode> = {}): GlassNode {
  return {
    id: overrides.id ?? nextId('glass'),
    name: overrides.name ?? nextName('glass'),
    type: 'glass',
    width: overrides.width ?? 260,
    height: overrides.height ?? 120,
    cornerRadius: overrides.cornerRadius ?? 48,
    cornerTransitionSpeed: overrides.cornerTransitionSpeed ?? 120,
    ...createTransformState(overrides),
  }
}

function createContainerNode(overrides: Partial<ContainerNode> = {}): ContainerNode {
  return {
    id: overrides.id ?? nextId('container'),
    name: overrides.name ?? nextName('container'),
    type: 'container',
    spacing: overrides.spacing ?? 42.5,
    blur: overrides.blur ?? 3.75,
    bezelWidth: overrides.bezelWidth ?? 13.75,
    thickness: overrides.thickness ?? 90,
    displacementFactor: overrides.displacementFactor ?? 1,
    ior: overrides.ior ?? 1.5,
    contentIor: overrides.contentIor ?? 1,
    contentDepth: overrides.contentDepth ?? 0,
    dispersion: overrides.dispersion ?? 0,
    surfaceProfile: overrides.surfaceProfile ?? 'convex',
    lightDirection: overrides.lightDirection ?? -Math.PI / 4,
    specularStrength: overrides.specularStrength ?? 1.4,
    specularWidth: overrides.specularWidth ?? 0.3,
    specularFalloff: overrides.specularFalloff ?? 0,
    oppositeSpecularStrength: overrides.oppositeSpecularStrength ?? overrides.specularStrength ?? 1.4,
    specularSharpness: overrides.specularSharpness ?? 2,
    specularOpacity: overrides.specularOpacity ?? 0.15,
    reflectionOffset: overrides.reflectionOffset ?? 18,
    tint: overrides.tint ?? { r: 0.15, g: 0.15, b: 0.15, a: 0.7 },
    zIndex: overrides.zIndex ?? 0,
    children: overrides.children ?? [],
    ...createTransformState(overrides),
  }
}

function createGroupNode(overrides: Partial<GroupNode> = {}): GroupNode {
  return {
    id: overrides.id ?? nextId('group'),
    name: overrides.name ?? nextName('group'),
    type: 'group',
    children: overrides.children ?? [],
    ...createTransformState(overrides),
  }
}

function createDefaultSceneState(): SceneState {
  return {
    children: [
      createGroupNode({
        name: 'Hero cluster',
        x: 120,
        y: 88,
        children: [
          createContainerNode({
            name: 'Primary container',
            zIndex: 1,
            tint: { r: 0.18, g: 0.18, b: 0.18, a: 0.7 },
            blur: 4,
            lightDirection: -Math.PI / 4,
            children: [
              createGlassNode({
                name: 'Header slab',
                x: 40,
                y: 34,
                width: 520,
                height: 88,
                cornerRadius: 320,
              }),
              createGlassNode({
                name: 'Capsule orb',
                x: 14,
                y: 28,
                width: 84,
                height: 84,
                cornerRadius: 220,
              }),
            ],
          }),
          createGroupNode({
            name: 'Offset subgroup',
            x: 420,
            y: 300,
            rotation: 0.08,
            children: [
              createContainerNode({
                name: 'Accent container',
                zIndex: 3,
                spacing: 22,
                blur: 6,
                tint: { r: 0.24, g: 0.24, b: 0.24, a: 0.7 },
                specularStrength: 2.2,
                children: [
                  createGlassNode({
                    name: 'Bridge',
                    x: 0,
                    y: 0,
                    width: 340,
                    height: 124,
                    cornerRadius: 78,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      createContainerNode({
        name: 'Floating strip',
        x: 180,
        y: 540,
        zIndex: 2,
        spacing: 18,
        blur: 2.25,
        tint: { r: 0.28, g: 0.28, b: 0.28, a: 0.7 },
        specularWidth: 0.55,
        reflectionOffset: 28,
        children: [
          createGlassNode({
            name: 'Ribbon',
            x: 0,
            y: 0,
            width: 720,
            height: 112,
            cornerRadius: 56,
          }),
        ],
      }),
    ],
  }
}

function findNodeLocation(children: Array<RootNode | GlassNode>, id: string, parentId: string): NodeLocation {
  for (const child of children) {
    if (child.id === id) {
      return {
        node: child,
        parentId,
      }
    }

    if (child.type === 'group') {
      const nested = findNodeLocation(child.children, id, child.id)
      if (nested.node) {
        return nested
      }
    }

    if (child.type === 'container') {
      const nested = findNodeLocation(child.children, id, child.id)
      if (nested.node) {
        return nested
      }
    }
  }

  return {
    node: null,
    parentId: null,
  }
}

function updateNodeInList(
  children: Array<RootNode | GlassNode>,
  id: string,
  update: (node: EditorNode) => EditorNode,
): Array<RootNode | GlassNode> {
  return children.map((child) => {
    if (child.id === id) {
      return update(child)
    }

    if (child.type === 'group') {
      return {
        ...child,
        children: updateNodeInList(child.children, id, update) as Array<GroupNode | ContainerNode>,
      }
    }

    if (child.type === 'container') {
      return {
        ...child,
        children: updateNodeInList(child.children, id, update) as GlassNode[],
      }
    }

    return child
  })
}

function removeNodeFromList(children: Array<RootNode | GlassNode>, id: string): Array<RootNode | GlassNode> {
  return children
    .filter((child) => child.id !== id)
    .map((child) => {
      if (child.type === 'group') {
        return {
          ...child,
          children: removeNodeFromList(child.children, id) as Array<GroupNode | ContainerNode>,
        }
      }

      if (child.type === 'container') {
        return {
          ...child,
          children: removeNodeFromList(child.children, id) as GlassNode[],
        }
      }

      return child
    })
}

function insertNode(
  children: Array<RootNode | GlassNode>,
  parentId: string,
  childToInsert: EditorNode,
): Array<RootNode | GlassNode> {
  return children.map((child) => {
    if (child.id === parentId) {
      if (child.type === 'group' && childToInsert.type !== 'glass') {
        return {
          ...child,
          children: [...child.children, childToInsert],
        }
      }

      if (child.type === 'container' && childToInsert.type === 'glass') {
        return {
          ...child,
          children: [...child.children, childToInsert],
        }
      }
    }

    if (child.type === 'group') {
      return {
        ...child,
        children: insertNode(child.children, parentId, childToInsert) as Array<GroupNode | ContainerNode>,
      }
    }

    return child
  })
}

function buildRuntimeNode(node: RootNode): RuntimeBuildResult {
  if (node.type === 'group') {
    const group = new Group({
      x: node.x,
      y: node.y,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
      rotation: node.rotation,
      origin: node.origin,
    })

    const containers: RuntimeContainerEntry[] = []

    for (const child of node.children) {
      const result = buildRuntimeNode(child)
      group.add(result.node)
      containers.push(...result.containers)
    }

    return {
      node: group,
      containers,
    }
  }

  const container = new Container({
    x: node.x,
    y: node.y,
    scaleX: node.scaleX,
    scaleY: node.scaleY,
    rotation: node.rotation,
    origin: node.origin,
    spacing: node.spacing,
    blur: node.blur,
    bezelWidth: node.bezelWidth,
    thickness: node.thickness,
    displacementFactor: node.displacementFactor,
    ior: node.ior,
    contentIor: node.contentIor,
    contentDepth: node.contentDepth,
    dispersion: node.dispersion,
    surfaceProfile: node.surfaceProfile,
    lightDirection: node.lightDirection,
    specularStrength: node.specularStrength,
    specularWidth: node.specularWidth,
    specularFalloff: node.specularFalloff,
    oppositeSpecularStrength: node.oppositeSpecularStrength,
    specularSharpness: node.specularSharpness,
    specularOpacity: node.specularOpacity,
    reflectionOffset: node.reflectionOffset,
    tint: node.tint,
    zIndex: node.zIndex,
  })

  const contentBindings: DemoGlassContentBinding[] = []
  for (const child of node.children) {
    const content = createDemoGlassContent(child)
    contentBindings.push(content.binding)
    container.add(
      new Glass({
        x: child.x,
        y: child.y,
        scaleX: child.scaleX,
        scaleY: child.scaleY,
        rotation: child.rotation,
        origin: child.origin,
        width: child.width,
        height: child.height,
        cornerRadius: child.cornerRadius,
        cornerTransitionSpeed: child.cornerTransitionSpeed,
        content: content.element,
      }),
    )
  }

  return {
    node: container,
    containers: [
      {
        id: node.id,
        tint: node.tint,
        node: container,
        contentBindings,
      },
    ],
  }
}

function createDemoGlassContent(node: GlassNode) {
  const linearToSrgb = (value: number) => {
    const clamped = clamp(value, 0, 1)
    if (clamped <= 0.0031308) {
      return clamped * 12.92
    }
    return 1.055 * clamped ** (1 / 2.4) - 0.055
  }

  const color = (r: number, g: number, b: number, alpha = 1) =>
    `rgba(${Math.round(clamp(r, 0, 1) * 255)}, ${Math.round(clamp(g, 0, 1) * 255)}, ${Math.round(
      clamp(b, 0, 1) * 255,
    )}, ${clamp(alpha, 0, 1)})`

  const compact = node.width < 180 || node.height < 80
  const root = document.createElement('div')
  root.style.width = '100%'
  root.style.height = '100%'
  root.style.boxSizing = 'border-box'
  root.style.display = 'flex'
  root.style.flexDirection = compact ? 'row' : 'column'
  root.style.alignItems = compact ? 'center' : 'stretch'
  root.style.justifyContent = compact ? 'center' : 'space-between'
  root.style.gap = compact ? '10px' : '12px'
  root.style.padding = compact ? '12px 16px' : '18px 20px'
  root.style.borderRadius = `${Math.max(16, Math.min(node.height * 0.38, 28))}px`
  root.style.border = '1px solid rgba(18, 21, 31, 0.08)'
  root.style.transition = 'color 220ms ease, border-color 220ms ease'
  root.style.fontFamily =
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

  const eyebrow = document.createElement('div')
  eyebrow.textContent = compact ? 'HTML' : 'DOM CONTENT'
  eyebrow.style.fontSize = compact ? '10px' : '11px'
  eyebrow.style.fontWeight = '700'
  eyebrow.style.letterSpacing = '0.12em'
  eyebrow.style.textTransform = 'uppercase'
  eyebrow.style.opacity = '0.55'
  eyebrow.style.transition = 'color 220ms ease'

  const title = document.createElement('div')
  title.textContent = compact ? 'Live' : node.name
  title.style.fontSize = compact ? '16px' : '26px'
  title.style.fontWeight = '700'
  title.style.lineHeight = '1'
  title.style.transition = 'color 220ms ease'

  const subtitle = document.createElement('div')
  subtitle.textContent = compact ? 'Canvas child' : `${Math.round(node.width)} × ${Math.round(node.height)}`
  subtitle.style.fontSize = compact ? '11px' : '13px'
  subtitle.style.fontWeight = '500'
  subtitle.style.opacity = '0.6'
  subtitle.style.transition = 'color 220ms ease'

  const badge = document.createElement('div')
  badge.textContent = compact ? 'LG' : 'HTML'
  badge.style.alignSelf = compact ? 'auto' : 'flex-start'
  badge.style.padding = compact ? '6px 10px' : '8px 12px'
  badge.style.borderRadius = '999px'
  badge.style.fontSize = compact ? '11px' : '12px'
  badge.style.fontWeight = '700'
  badge.style.letterSpacing = '0.08em'
  badge.style.textTransform = 'uppercase'
  badge.style.transition = 'color 220ms ease, background-color 220ms ease'

  const chips: HTMLDivElement[] = []

  const applyBackdropMetrics = (metrics: BackdropMetrics | null) => {
    const luminance = metrics?.luminanceP50 ?? 0.5
    const average = metrics?.averageLinearColor ?? { r: 0.5, g: 0.5, b: 0.5 }
    const accent = {
      r: linearToSrgb(average.r),
      g: linearToSrgb(average.g),
      b: linearToSrgb(average.b),
    }
    const brightBackdrop = luminance >= 0.5
    const primary = brightBackdrop ? 0.08 : 0.96
    const secondary = brightBackdrop ? 0.42 : 0.7
    const tertiary = brightBackdrop ? 0.54 : 0.8

    root.style.color = color(primary, primary, primary)
    root.style.borderColor = color(primary, primary, primary, brightBackdrop ? 0.08 : 0.16)
    eyebrow.style.color = color(tertiary, tertiary, tertiary)
    title.style.color = color(primary, primary, primary)
    subtitle.style.color = color(secondary, secondary, secondary)
    badge.style.color = color(primary, primary, primary)
    badge.style.background = color(accent.r, accent.g, accent.b, brightBackdrop ? 0.18 : 0.28)

    for (const chip of chips) {
      chip.style.color = color(primary, primary, primary)
      chip.style.background = color(primary, primary, primary, brightBackdrop ? 0.06 : 0.14)
    }
  }

  applyBackdropMetrics(null)

  if (compact) {
    const stack = document.createElement('div')
    stack.style.display = 'flex'
    stack.style.flexDirection = 'column'
    stack.style.gap = '2px'
    stack.append(eyebrow, title, subtitle)
    root.append(stack, badge)
    return {
      element: root,
      binding: {
        applyBackdropMetrics,
      },
    }
  }

  const header = document.createElement('div')
  header.style.display = 'flex'
  header.style.justifyContent = 'space-between'
  header.style.alignItems = 'flex-start'
  header.style.gap = '12px'

  const copy = document.createElement('div')
  copy.style.display = 'flex'
  copy.style.flexDirection = 'column'
  copy.style.gap = '6px'
  copy.append(eyebrow, title, subtitle)
  header.append(copy, badge)

  const footer = document.createElement('div')
  footer.style.display = 'grid'
  footer.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))'
  footer.style.gap = '8px'

  for (const label of ['Refracted', 'Sharp', 'Untinted']) {
    const chip = document.createElement('div')
    chip.textContent = label
    chip.style.padding = '10px 12px'
    chip.style.borderRadius = '14px'
    chip.style.background = 'rgba(24, 27, 34, 0.05)'
    chip.style.fontSize = '12px'
    chip.style.fontWeight = '600'
    chip.style.textAlign = 'center'
    chip.style.transition = 'color 220ms ease, background-color 220ms ease'
    chips.push(chip)
    footer.append(chip)
  }

  root.append(header, footer)
  return {
    element: root,
    binding: {
      applyBackdropMetrics,
    },
  }
}

function nodeTypeLabel(type: EditorNode['type'] | 'scene') {
  if (type === 'scene') {
    return 'Scene'
  }
  if (type === 'group') {
    return 'Group'
  }
  if (type === 'container') {
    return 'Container'
  }
  return 'Glass'
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, Number.EPSILON), 0, 1)
  return t * t * (3 - 2 * t)
}

function tintBrightness(tint: TintColor) {
  return tint.r * 0.2126 + tint.g * 0.7152 + tint.b * 0.0722
}

function targetTintBrightness(luminance: number) {
  const normalized = smoothstep(0.08, 0.92, luminance)
  const mappedBrightness = 0.1 + normalized * 0.75
  return luminance >= 0.5 ? Math.max(mappedBrightness, luminance) : mappedBrightness
}

function shouldUpdateAdaptiveBrightness(current: number | null, next: number, epsilon = 0.01) {
  return current === null || Math.abs(current - next) > epsilon
}

function loadBackdropSettings(): BackdropSettings {
  const stored = localStorage.getItem(BACKDROP_SETTINGS_STORAGE_KEY)
  if (!stored) {
    return DEFAULT_BACKDROP_SETTINGS
  }

  const parsed = JSON.parse(stored) as Partial<BackdropSettings> & {
    adaptiveTint?: Partial<AdaptiveTintSettings> & { easingSpeed?: number }
  }
  const storedAdaptiveTint: Partial<AdaptiveTintSettings> & { easingSpeed?: number } =
    parsed.adaptiveTint ?? {}

  return {
    ...DEFAULT_BACKDROP_SETTINGS,
    ...parsed,
    steppedGradient: {
      ...DEFAULT_BACKDROP_SETTINGS.steppedGradient,
      ...(parsed.steppedGradient ?? {}),
    },
    adaptiveTint: {
      ...DEFAULT_BACKDROP_SETTINGS.adaptiveTint,
      ...storedAdaptiveTint,
      easingDurationMs:
        storedAdaptiveTint.easingDurationMs ??
        (storedAdaptiveTint.easingSpeed ? Math.round(1000 / storedAdaptiveTint.easingSpeed) : DEFAULT_BACKDROP_SETTINGS.adaptiveTint.easingDurationMs),
    },
  }
}

type InspectorControlsProps = {
  selectedId: string
  selectedNode: EditorNode | null
  removeSelectedNode: () => void
  addRootChild: (type: 'group' | 'container') => void
  addChild: (parentId: string, type: 'group' | 'container' | 'glass') => void
  updateSelectedNode: (update: (node: EditorNode) => EditorNode) => void
}

function InspectorControls({
  selectedId,
  selectedNode,
  removeSelectedNode,
  addRootChild,
  addChild,
  updateSelectedNode,
}: InspectorControlsProps) {
  const store = useCreateStore()

  useControls(
    () => {
      if (selectedId === SCENE_ID || !selectedNode) {
        return {
          scene: folder(
            {
              selection: {
                value: 'Scene root',
                disabled: true,
              },
              addRootGroup: button(() => addRootChild('group')),
              addRootContainer: button(() => addRootChild('container')),
            },
            { collapsed: false },
          ),
        } as any
      }

      const baseSchema = {
        actions: folder(
          {
            remove: button(removeSelectedNode),
          },
          { collapsed: false },
        ),
        identity: folder(
          {
            name: {
              value: selectedNode.name,
              onChange: (value: string) => updateSelectedNode((node) => ({ ...node, name: value })),
            },
            type: {
              value: nodeTypeLabel(selectedNode.type),
              disabled: true,
            },
          },
          { collapsed: false },
        ),
        transform: folder(
          {
            x: {
              value: selectedNode.x,
              step: 1,
              onChange: (value: number) => updateSelectedNode((node) => ({ ...node, x: value })),
            },
            y: {
              value: selectedNode.y,
              step: 1,
              onChange: (value: number) => updateSelectedNode((node) => ({ ...node, y: value })),
            },
            scaleX: {
              value: selectedNode.scaleX,
              step: 0.05,
              onChange: (value: number) => updateSelectedNode((node) => ({ ...node, scaleX: value })),
            },
            scaleY: {
              value: selectedNode.scaleY,
              step: 0.05,
              onChange: (value: number) => updateSelectedNode((node) => ({ ...node, scaleY: value })),
            },
            rotation: {
              value: selectedNode.rotation,
              step: 0.01,
              onChange: (value: number) => updateSelectedNode((node) => ({ ...node, rotation: value })),
            },
            originX: {
              value: selectedNode.origin.x,
              step: 1,
              onChange: (value: number) =>
                updateSelectedNode((node) => ({
                  ...node,
                  origin: { ...node.origin, x: value },
                })),
            },
            originY: {
              value: selectedNode.origin.y,
              step: 1,
              onChange: (value: number) =>
                updateSelectedNode((node) => ({
                  ...node,
                  origin: { ...node.origin, y: value },
                })),
            },
          },
          { collapsed: false },
        ),
      }

      if (selectedNode.type === 'group') {
        return {
          ...baseSchema,
          children: folder(
            {
              addGroup: button(() => addChild(selectedNode.id, 'group')),
              addContainer: button(() => addChild(selectedNode.id, 'container')),
            },
            { collapsed: false },
          ),
        } as any
      }

      if (selectedNode.type === 'container') {
        return {
          ...baseSchema,
          children: folder(
            {
              addGlass: button(() => addChild(selectedNode.id, 'glass')),
            },
            { collapsed: false },
          ),
          container: folder(
            {
              spacing: {
                value: selectedNode.spacing,
                step: 0.25,
                onChange: (value: number) => updateSelectedNode((node) => ({ ...node, spacing: value })),
              },
              blur: {
                value: selectedNode.blur,
                step: 0.25,
                onChange: (value: number) => updateSelectedNode((node) => ({ ...node, blur: value })),
              },
              bezelWidth: {
                value: selectedNode.bezelWidth,
                step: 0.25,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, bezelWidth: value })),
              },
              thickness: {
                value: selectedNode.thickness,
                step: 0.25,
                onChange: (value: number) => updateSelectedNode((node) => ({ ...node, thickness: value })),
              },
              displacementFactor: {
                value: selectedNode.displacementFactor,
                step: 0.05,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, displacementFactor: value })),
              },
              ior: {
                value: selectedNode.ior,
                step: 0.01,
                onChange: (value: number) => updateSelectedNode((node) => ({ ...node, ior: value })),
              },
              contentIor: {
                value: selectedNode.contentIor,
                step: 0.01,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, contentIor: value })),
              },
              contentDepth: {
                value: selectedNode.contentDepth,
                step: 0.25,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, contentDepth: value })),
              },
              dispersion: {
                value: selectedNode.dispersion,
                step: 0.01,
                onChange: (value: number) => updateSelectedNode((node) => ({ ...node, dispersion: value })),
              },
              surfaceProfile: {
                value: selectedNode.surfaceProfile,
                options: SURFACE_PROFILES.reduce<Record<string, SurfaceProfile>>((profiles, option) => {
                  profiles[option.label] = option.value
                  return profiles
                }, {}),
                onChange: (value: SurfaceProfile) =>
                  updateSelectedNode((node) => ({ ...node, surfaceProfile: value })),
              },
              lightDirection: {
                value: selectedNode.lightDirection,
                step: 0.01,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, lightDirection: value })),
              },
              specularStrength: {
                value: selectedNode.specularStrength,
                step: 0.05,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, specularStrength: value })),
              },
              specularWidth: {
                value: selectedNode.specularWidth,
                step: 0.05,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, specularWidth: value })),
              },
              specularFalloff: {
                value: selectedNode.specularFalloff,
                step: 0.05,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, specularFalloff: value })),
              },
              oppositeSpecularStrength: {
                value: selectedNode.oppositeSpecularStrength,
                step: 0.05,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, oppositeSpecularStrength: value })),
              },
              specularSharpness: {
                value: selectedNode.specularSharpness,
                step: 0.1,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, specularSharpness: value })),
              },
              specularOpacity: {
                value: selectedNode.specularOpacity,
                step: 0.01,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, specularOpacity: value })),
              },
              reflectionOffset: {
                value: selectedNode.reflectionOffset,
                step: 0.25,
                onChange: (value: number) =>
                  updateSelectedNode((node) => ({ ...node, reflectionOffset: value })),
              },
              tintColor: {
                value: tintToHex(selectedNode.tint),
                onChange: (value: string) =>
                  updateSelectedNode((node) =>
                    node.type === 'container' ? { ...node, tint: hexToTint(value, node.tint.a) } : node,
                  ),
              },
              tintAlpha: {
                value: selectedNode.tint.a,
                min: 0,
                max: 1,
                step: 0.01,
                onChange: (value: number) =>
                  updateSelectedNode((node) =>
                    node.type === 'container' ? { ...node, tint: { ...node.tint, a: value } } : node,
                  ),
              },
              zIndex: {
                value: selectedNode.zIndex,
                step: 1,
                onChange: (value: number) => updateSelectedNode((node) => ({ ...node, zIndex: value })),
              },
            },
            { collapsed: false },
          ),
        } as any
      }

      return {
        ...baseSchema,
        geometry: folder(
          {
            width: {
              value: selectedNode.width,
              step: 1,
              onChange: (value: number) => updateSelectedNode((node) => ({ ...node, width: value })),
            },
            height: {
              value: selectedNode.height,
              step: 1,
              onChange: (value: number) => updateSelectedNode((node) => ({ ...node, height: value })),
            },
            cornerRadius: {
              value: selectedNode.cornerRadius,
              step: 1,
              onChange: (value: number) =>
                updateSelectedNode((node) => ({ ...node, cornerRadius: value })),
            },
            cornerTransitionSpeed: {
              value: selectedNode.cornerTransitionSpeed,
              step: 0.25,
              onChange: (value: number) =>
                updateSelectedNode((node) => ({ ...node, cornerTransitionSpeed: value })),
            },
          },
          { collapsed: false },
        ),
      } as any
    },
    { store },
  )

  return (
    <LevaPanel
      store={store}
      fill
      flat
      neverHide
      hideCopyButton
      titleBar={{ title: 'Properties', drag: false, filter: false }}
    />
  )
}

export function EditorDemo() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const htmlRootRef = useRef<Root | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const topLevelRuntimeNodesRef = useRef<Array<Group | Container>>([])
  const runtimeContainersRef = useRef<Map<string, RuntimeContainerEntry>>(new Map())
  const adaptiveTintStatesRef = useRef<Map<string, AdaptiveTintState>>(new Map())
  const backdropSettingsRef = useRef<BackdropSettings>(DEFAULT_BACKDROP_SETTINGS)
  const [sceneState, setSceneState] = useState<SceneState>(() => createDefaultSceneState())
  const [backdropSettings, setBackdropSettings] = useState<BackdropSettings>(() => loadBackdropSettings())
  const [selectedId, setSelectedId] = useState<string>(SCENE_ID)

  backdropSettingsRef.current = backdropSettings

  useEffect(() => {
    const host = canvasHostRef.current
    if (!host) {
      return
    }

    const scene = new Scene()
    const renderer = new Renderer({ scene })
    const htmlRoot = createRoot(renderer.htmlRoot)

    const canvas = renderer.canvas
    canvas.className = 'editor-preview__canvas'
    host.append(canvas)

    sceneRef.current = scene
    rendererRef.current = renderer
    htmlRootRef.current = htmlRoot

    function renderLoop(now: number) {
      const lastFrameTime = lastFrameTimeRef.current
      const deltaSeconds = lastFrameTime === null ? 1 / 60 : Math.max((now - lastFrameTime) / 1000, 0)
      const deltaMs = deltaSeconds * 1000
      lastFrameTimeRef.current = now

      for (const [id, entry] of runtimeContainersRef.current) {
        const adaptiveTintState = adaptiveTintStatesRef.current.get(id)
        if (!adaptiveTintState) {
          continue
        }

        const metrics = renderer.getBackdropMetrics(entry.node)
        for (const binding of entry.contentBindings) {
          binding.applyBackdropMetrics(metrics)
        }
        if (metrics) {
          const nextObservedBrightness = targetTintBrightness(metrics.luminanceP50)
          if (shouldUpdateAdaptiveBrightness(adaptiveTintState.observedBrightness, nextObservedBrightness)) {
            adaptiveTintState.pendingBrightness = nextObservedBrightness
            adaptiveTintState.observedBrightness = nextObservedBrightness
            adaptiveTintState.settleAt = now + backdropSettingsRef.current.adaptiveTint.easingDelayMs
          }
        }

        if (adaptiveTintState.pendingBrightness !== null && now >= adaptiveTintState.settleAt) {
          adaptiveTintState.targetBrightness = adaptiveTintState.pendingBrightness
          adaptiveTintState.pendingBrightness = null
        }

        const blend =
          1 - Math.exp(-deltaMs / backdropSettingsRef.current.adaptiveTint.easingDurationMs)
        adaptiveTintState.currentBrightness +=
          (adaptiveTintState.targetBrightness - adaptiveTintState.currentBrightness) * blend

        entry.node.tint = {
          r: adaptiveTintState.currentBrightness,
          g: adaptiveTintState.currentBrightness,
          b: adaptiveTintState.currentBrightness,
          a: adaptiveTintState.alpha,
        }
      }

      renderer.render()
      frameRef.current = requestAnimationFrame(renderLoop)
    }

    frameRef.current = requestAnimationFrame(renderLoop)

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      lastFrameTimeRef.current = null

      for (const node of topLevelRuntimeNodesRef.current) {
        node.remove()
      }
      topLevelRuntimeNodesRef.current = []
      for (const entry of runtimeContainersRef.current.values()) {
        renderer.setBackdropMetricsTracking(entry.node, false)
      }
      runtimeContainersRef.current.clear()
      adaptiveTintStatesRef.current.clear()

      queueMicrotask(() => {
        htmlRoot.unmount()
      })

      renderer.destroy()
      rendererRef.current = null
      sceneRef.current = null
      htmlRootRef.current = null
      canvas.remove()
    }
  }, [])

  useEffect(() => {
    htmlRootRef.current?.render(
      <EditorBackdrop
        mode={backdropSettings.mode}
        steppedGradientSettings={backdropSettings.steppedGradient}
        adaptiveTintSettings={backdropSettings.adaptiveTint}
        onModeChange={(mode) =>
          setBackdropSettings((current) => ({
            ...current,
            mode,
          }))
        }
        onSteppedGradientSettingsChange={(steppedGradient) =>
          setBackdropSettings((current) => ({
            ...current,
            steppedGradient,
          }))
        }
        onAdaptiveTintSettingsChange={(adaptiveTint) =>
          setBackdropSettings((current) => ({
            ...current,
            adaptiveTint,
          }))
        }
      />,
    )
  }, [backdropSettings])

  useEffect(() => {
    localStorage.setItem(BACKDROP_SETTINGS_STORAGE_KEY, JSON.stringify(backdropSettings))
  }, [backdropSettings])

  useEffect(() => {
    const scene = sceneRef.current
    const renderer = rendererRef.current
    if (!scene) {
      return
    }

    for (const entry of runtimeContainersRef.current.values()) {
      renderer?.setBackdropMetricsTracking(entry.node, false)
    }

    for (const node of topLevelRuntimeNodesRef.current) {
      node.remove()
    }

    const previousAdaptiveTintStates = adaptiveTintStatesRef.current
    const nextAdaptiveTintStates = new Map<string, AdaptiveTintState>()
    const nextRuntimeContainers = new Map<string, RuntimeContainerEntry>()
    const nextTopLevel = sceneState.children.map((child) => {
      const result = buildRuntimeNode(child)
      scene.add(result.node)

      for (const entry of result.containers) {
        const previousAdaptiveTintState = previousAdaptiveTintStates.get(entry.id)
        const nextAdaptiveTintState =
          previousAdaptiveTintState ?? {
            alpha: entry.tint.a,
            currentBrightness: tintBrightness(entry.tint),
            targetBrightness: tintBrightness(entry.tint),
            pendingBrightness: null,
            observedBrightness: null,
            settleAt: 0,
          }

        nextAdaptiveTintState.alpha = entry.tint.a
        nextAdaptiveTintStates.set(entry.id, nextAdaptiveTintState)
        nextRuntimeContainers.set(entry.id, entry)
        entry.node.tint = {
          r: nextAdaptiveTintState.currentBrightness,
          g: nextAdaptiveTintState.currentBrightness,
          b: nextAdaptiveTintState.currentBrightness,
          a: nextAdaptiveTintState.alpha,
        }
        renderer?.setBackdropMetricsTracking(entry.node, true)
      }

      return result.node
    })

    topLevelRuntimeNodesRef.current = nextTopLevel
    runtimeContainersRef.current = nextRuntimeContainers
    adaptiveTintStatesRef.current = nextAdaptiveTintStates
  }, [sceneState])

  const selectedLocation =
    selectedId === SCENE_ID
      ? {
          node: null,
          parentId: null,
        }
      : findNodeLocation(sceneState.children, selectedId, SCENE_ID)
  const selectedNode = selectedLocation.node

  function updateSelectedNode(update: (node: EditorNode) => EditorNode) {
    if (selectedId === SCENE_ID) {
      return
    }

    setSceneState((current) => ({
      children: updateNodeInList(current.children, selectedId, update) as RootNode[],
    }))
  }

  function addRootChild(type: 'group' | 'container') {
    const node = type === 'group' ? createGroupNode() : createContainerNode({ children: [createGlassNode()] })
    setSceneState((current) => ({
      children: [...current.children, node],
    }))
    setSelectedId(node.id)
  }

  function addChild(parentId: string, type: 'group' | 'container' | 'glass') {
    const node =
      type === 'group'
        ? createGroupNode()
        : type === 'container'
          ? createContainerNode({ children: [createGlassNode()] })
          : createGlassNode()

    setSceneState((current) => ({
      children:
        parentId === SCENE_ID
          ? ([...current.children, node] as RootNode[])
          : (insertNode(current.children, parentId, node) as RootNode[]),
    }))
    setSelectedId(node.id)
  }

  function removeSelectedNode() {
    if (selectedId === SCENE_ID || !selectedNode) {
      return
    }

    setSceneState((current) => ({
      children: removeNodeFromList(current.children, selectedId) as RootNode[],
    }))
    setSelectedId(selectedLocation.parentId ?? SCENE_ID)
  }

  return (
    <div className="editor-layout">
      <aside className="editor-sidebar editor-sidebar--left">
        <section className="editor-panel">
          <div className="editor-panel__header">
            <div className="editor-panel__toolbar">
              <button type="button" onClick={() => addRootChild('group')}>
                + Group
              </button>
              <button type="button" onClick={() => addRootChild('container')}>
                + Container
              </button>
            </div>
          </div>

          <div className="editor-tree">
            <button
              type="button"
              className={selectedId === SCENE_ID ? 'editor-tree__node editor-tree__node--active' : 'editor-tree__node'}
              onClick={() => setSelectedId(SCENE_ID)}
            >
              <span>Scene</span>
              <small>root</small>
            </button>
            {sceneState.children.map((child) => (
              <TreeNodeView
                key={child.id}
                node={child}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAddChild={addChild}
              />
            ))}
          </div>
        </section>
      </aside>

      <section className="editor-preview">
        <div ref={canvasHostRef} className="editor-preview__viewport" />
      </section>

      <aside className="editor-sidebar editor-sidebar--right">
        <section className="editor-panel editor-panel--leva">
          <InspectorControls
            key={selectedId}
            selectedId={selectedId}
            selectedNode={selectedNode}
            removeSelectedNode={removeSelectedNode}
            addRootChild={addRootChild}
            addChild={addChild}
            updateSelectedNode={updateSelectedNode}
          />
        </section>
      </aside>
    </div>
  )
}

type TreeNodeViewProps = {
  node: RootNode
  selectedId: string
  onSelect: (id: string) => void
  onAddChild: (parentId: string, type: 'group' | 'container' | 'glass') => void
}

function TreeNodeView({ node, selectedId, onSelect, onAddChild }: TreeNodeViewProps) {
  return (
    <div className="editor-tree__branch">
      <div className="editor-tree__row">
        <button
          type="button"
          className={selectedId === node.id ? 'editor-tree__node editor-tree__node--active' : 'editor-tree__node'}
          onClick={() => onSelect(node.id)}
        >
          <span>{node.name}</span>
          <small>{nodeTypeLabel(node.type)}</small>
        </button>
        <div className="editor-tree__actions">
          {node.type === 'group' ? (
            <>
              <button type="button" onClick={() => onAddChild(node.id, 'group')}>
                +G
              </button>
              <button type="button" onClick={() => onAddChild(node.id, 'container')}>
                +C
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onAddChild(node.id, 'glass')}>
              +S
            </button>
          )}
        </div>
      </div>

      <div className="editor-tree__children">
        {node.children.map((child) => {
          if (child.type === 'glass') {
            return (
              <div key={child.id} className="editor-tree__row editor-tree__row--leaf">
                <button
                  type="button"
                  className={
                    selectedId === child.id ? 'editor-tree__node editor-tree__node--active' : 'editor-tree__node'
                  }
                  onClick={() => onSelect(child.id)}
                >
                  <span>{child.name}</span>
                  <small>{nodeTypeLabel(child.type)}</small>
                </button>
              </div>
            )
          }

          return (
            <TreeNodeView
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
            />
          )
        })}
      </div>
    </div>
  )
}
