import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  Container,
  Glass,
  Group,
  Renderer,
  Scene,
  type Point,
  type SurfaceProfile,
} from 'liquid-glass-dom'
import { EditorBackdrop } from './EditorBackdrop'

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
  dispersion: number
  surfaceProfile: SurfaceProfile
  lightDirection: number
  specularStrength: number
  specularWidth: number
  specularSharpness: number
  specularOpacity: number
  edgeSaturation: number
  reflectionOffset: number
  reflectionSaturation: number
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
    dispersion: overrides.dispersion ?? 0,
    surfaceProfile: overrides.surfaceProfile ?? 'convex',
    lightDirection: overrides.lightDirection ?? -0.9,
    specularStrength: overrides.specularStrength ?? 1.4,
    specularWidth: overrides.specularWidth ?? 0.3,
    specularSharpness: overrides.specularSharpness ?? 2,
    specularOpacity: overrides.specularOpacity ?? 0.15,
    edgeSaturation: overrides.edgeSaturation ?? 1.7,
    reflectionOffset: overrides.reflectionOffset ?? 18,
    reflectionSaturation: overrides.reflectionSaturation ?? 0.7,
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
            lightDirection: -0.8,
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
                edgeSaturation: 2.4,
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

function buildRuntimeNode(node: RootNode): Group | Container {
  if (node.type === 'group') {
    const group = new Group({
      x: node.x,
      y: node.y,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
      rotation: node.rotation,
      origin: node.origin,
    })

    for (const child of node.children) {
      group.add(buildRuntimeNode(child))
    }

    return group
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
    dispersion: node.dispersion,
    surfaceProfile: node.surfaceProfile,
    lightDirection: node.lightDirection,
    specularStrength: node.specularStrength,
    specularWidth: node.specularWidth,
    specularSharpness: node.specularSharpness,
    specularOpacity: node.specularOpacity,
    edgeSaturation: node.edgeSaturation,
    reflectionOffset: node.reflectionOffset,
    reflectionSaturation: node.reflectionSaturation,
    tint: node.tint,
    zIndex: node.zIndex,
  })

  for (const child of node.children) {
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
      }),
    )
  }

  return container
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

function toDisplayNumber(value: number, precision = 2) {
  return Number(value.toFixed(precision))
}

export function EditorDemo() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const htmlRootRef = useRef<Root | null>(null)
  const frameRef = useRef<number | null>(null)
  const topLevelRuntimeNodesRef = useRef<Array<Group | Container>>([])
  const [sceneState, setSceneState] = useState<SceneState>(() => createDefaultSceneState())
  const [selectedId, setSelectedId] = useState<string>(SCENE_ID)

  useEffect(() => {
    const host = canvasHostRef.current
    if (!host) {
      return
    }

    const scene = new Scene()
    const renderer = new Renderer({ scene })
    const htmlRoot = createRoot(renderer.htmlRoot)
    htmlRoot.render(<EditorBackdrop />)

    const canvas = renderer.canvas
    canvas.className = 'editor-preview__canvas'
    host.append(canvas)

    sceneRef.current = scene
    rendererRef.current = renderer
    htmlRootRef.current = htmlRoot

    function renderLoop() {
      renderer.render()
      frameRef.current = requestAnimationFrame(renderLoop)
    }

    frameRef.current = requestAnimationFrame(renderLoop)

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }

      for (const node of topLevelRuntimeNodesRef.current) {
        node.remove()
      }
      topLevelRuntimeNodesRef.current = []

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
    const scene = sceneRef.current
    if (!scene) {
      return
    }

    for (const node of topLevelRuntimeNodesRef.current) {
      node.remove()
    }

    const nextTopLevel = sceneState.children.map((child) => {
      const runtimeNode = buildRuntimeNode(child)
      scene.add(runtimeNode)
      return runtimeNode
    })

    topLevelRuntimeNodesRef.current = nextTopLevel
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
      <section className="editor-preview">
        <div ref={canvasHostRef} className="editor-preview__viewport" />
      </section>

      <aside className="editor-sidebar">
        <section className="editor-panel">
          <div className="editor-panel__header">
            <div>
              <p className="editor-panel__eyebrow">Hierarchy</p>
              <h2>Scene graph</h2>
            </div>
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

        <section className="editor-panel editor-panel--inspector">
          <div className="editor-panel__header">
            <div>
              <p className="editor-panel__eyebrow">Inspector</p>
              <h2>{selectedNode ? selectedNode.name : 'Scene'}</h2>
            </div>
            {selectedId !== SCENE_ID ? (
              <button type="button" className="editor-panel__danger" onClick={removeSelectedNode}>
                Remove
              </button>
            ) : null}
          </div>

          {selectedId === SCENE_ID ? (
            <div className="editor-empty">
              <p>
                The root scene can contain groups and containers. Use the tree toolbar or the
                buttons below to grow the graph.
              </p>
              <div className="editor-empty__actions">
                <button type="button" onClick={() => addRootChild('group')}>
                  Add root group
                </button>
                <button type="button" onClick={() => addRootChild('container')}>
                  Add root container
                </button>
              </div>
            </div>
          ) : null}

          {selectedNode ? (
            <>
              <InspectorSection title="Identity">
                <TextField
                  label="Name"
                  value={selectedNode.name}
                  onChange={(value) => updateSelectedNode((node) => ({ ...node, name: value }))}
                />
              </InspectorSection>

              <InspectorSection title="Transform">
                <NumberField
                  label="X"
                  value={selectedNode.x}
                  step={1}
                  onChange={(value) => updateSelectedNode((node) => ({ ...node, x: value }))}
                />
                <NumberField
                  label="Y"
                  value={selectedNode.y}
                  step={1}
                  onChange={(value) => updateSelectedNode((node) => ({ ...node, y: value }))}
                />
                <NumberField
                  label="Scale X"
                  value={selectedNode.scaleX}
                  step={0.05}
                  onChange={(value) => updateSelectedNode((node) => ({ ...node, scaleX: value }))}
                />
                <NumberField
                  label="Scale Y"
                  value={selectedNode.scaleY}
                  step={0.05}
                  onChange={(value) => updateSelectedNode((node) => ({ ...node, scaleY: value }))}
                />
                <NumberField
                  label="Rotation (rad)"
                  value={selectedNode.rotation}
                  step={0.01}
                  onChange={(value) => updateSelectedNode((node) => ({ ...node, rotation: value }))}
                />
                <NumberField
                  label="Origin X"
                  value={selectedNode.origin.x}
                  step={1}
                  onChange={(value) =>
                    updateSelectedNode((node) => ({
                      ...node,
                      origin: { ...node.origin, x: value },
                    }))
                  }
                />
                <NumberField
                  label="Origin Y"
                  value={selectedNode.origin.y}
                  step={1}
                  onChange={(value) =>
                    updateSelectedNode((node) => ({
                      ...node,
                      origin: { ...node.origin, y: value },
                    }))
                  }
                />
              </InspectorSection>

              {selectedNode.type === 'group' ? (
                <InspectorSection title="Children">
                  <ActionRow
                    actions={[
                      { label: 'Add group', onClick: () => addChild(selectedNode.id, 'group') },
                      { label: 'Add container', onClick: () => addChild(selectedNode.id, 'container') },
                    ]}
                  />
                </InspectorSection>
              ) : null}

              {selectedNode.type === 'container' ? (
                <>
                  <InspectorSection title="Children">
                    <ActionRow actions={[{ label: 'Add glass', onClick: () => addChild(selectedNode.id, 'glass') }]} />
                  </InspectorSection>
                  <InspectorSection title="Container">
                    <NumberField
                      label="Spacing"
                      value={selectedNode.spacing}
                      step={0.25}
                      onChange={(value) => updateSelectedNode((node) => ({ ...node, spacing: value }))}
                    />
                    <NumberField
                      label="Blur"
                      value={selectedNode.blur}
                      step={0.25}
                      onChange={(value) => updateSelectedNode((node) => ({ ...node, blur: value }))}
                    />
                    <NumberField
                      label="Bezel width"
                      value={selectedNode.bezelWidth}
                      step={0.25}
                      onChange={(value) => updateSelectedNode((node) => ({ ...node, bezelWidth: value }))}
                    />
                    <NumberField
                      label="Thickness"
                      value={selectedNode.thickness}
                      step={0.25}
                      onChange={(value) => updateSelectedNode((node) => ({ ...node, thickness: value }))}
                    />
                    <NumberField
                      label="Displacement factor"
                      value={selectedNode.displacementFactor}
                      step={0.05}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, displacementFactor: value }))
                      }
                    />
                    <NumberField
                      label="IOR"
                      value={selectedNode.ior}
                      step={0.01}
                      onChange={(value) => updateSelectedNode((node) => ({ ...node, ior: value }))}
                    />
                    <NumberField
                      label="Dispersion"
                      value={selectedNode.dispersion}
                      step={0.01}
                      onChange={(value) => updateSelectedNode((node) => ({ ...node, dispersion: value }))}
                    />
                    <SelectField
                      label="Surface profile"
                      value={selectedNode.surfaceProfile}
                      options={SURFACE_PROFILES}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, surfaceProfile: value as SurfaceProfile }))
                      }
                    />
                    <NumberField
                      label="Light direction (rad)"
                      value={selectedNode.lightDirection}
                      step={0.01}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, lightDirection: value }))
                      }
                    />
                    <NumberField
                      label="Specular strength"
                      value={selectedNode.specularStrength}
                      step={0.05}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, specularStrength: value }))
                      }
                    />
                    <NumberField
                      label="Specular width"
                      value={selectedNode.specularWidth}
                      step={0.05}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, specularWidth: value }))
                      }
                    />
                    <NumberField
                      label="Specular sharpness"
                      value={selectedNode.specularSharpness}
                      step={0.1}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, specularSharpness: value }))
                      }
                    />
                    <NumberField
                      label="Specular opacity"
                      value={selectedNode.specularOpacity}
                      step={0.01}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, specularOpacity: value }))
                      }
                    />
                    <NumberField
                      label="Edge saturation"
                      value={selectedNode.edgeSaturation}
                      step={0.05}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, edgeSaturation: value }))
                      }
                    />
                    <NumberField
                      label="Reflection offset"
                      value={selectedNode.reflectionOffset}
                      step={0.25}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, reflectionOffset: value }))
                      }
                    />
                    <NumberField
                      label="Reflection saturation"
                      value={selectedNode.reflectionSaturation}
                      step={0.05}
                      onChange={(value) =>
                        updateSelectedNode((node) => ({ ...node, reflectionSaturation: value }))
                      }
                    />
                    <ColorField
                      label="Tint color"
                      value={selectedNode.tint}
                      onChange={(value) =>
                        updateSelectedNode((node) =>
                          node.type === 'container' ? { ...node, tint: hexToTint(value, node.tint.a) } : node,
                        )
                      }
                    />
                    <NumberField
                      label="Tint alpha"
                      value={selectedNode.tint.a}
                      step={0.01}
                      onChange={(value) =>
                        updateSelectedNode((node) =>
                          node.type === 'container' ? { ...node, tint: { ...node.tint, a: value } } : node,
                        )
                      }
                    />
                    <NumberField
                      label="Z-index"
                      value={selectedNode.zIndex}
                      step={1}
                      onChange={(value) => updateSelectedNode((node) => ({ ...node, zIndex: value }))}
                    />
                  </InspectorSection>
                </>
              ) : null}

              {selectedNode.type === 'glass' ? (
                <InspectorSection title="Geometry">
                  <NumberField
                    label="Width"
                    value={selectedNode.width}
                    step={1}
                    onChange={(value) => updateSelectedNode((node) => ({ ...node, width: value }))}
                  />
                  <NumberField
                    label="Height"
                    value={selectedNode.height}
                    step={1}
                    onChange={(value) => updateSelectedNode((node) => ({ ...node, height: value }))}
                  />
                  <NumberField
                    label="Corner radius"
                    value={selectedNode.cornerRadius}
                    step={1}
                    onChange={(value) =>
                      updateSelectedNode((node) => ({ ...node, cornerRadius: value }))
                    }
                  />
                  <NumberField
                    label="Corner transition speed"
                    value={selectedNode.cornerTransitionSpeed}
                    step={0.25}
                    onChange={(value) =>
                      updateSelectedNode((node) => ({ ...node, cornerTransitionSpeed: value }))
                    }
                  />
                </InspectorSection>
              ) : null}
            </>
          ) : null}
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

type InspectorSectionProps = {
  title: string
  children: ReactNode
}

function InspectorSection({ title, children }: InspectorSectionProps) {
  return (
    <section className="editor-section">
      <h3>{title}</h3>
      <div className="editor-fields">{children}</div>
    </section>
  )
}

type NumberFieldProps = {
  label: string
  value: number
  step: number
  onChange: (value: number) => void
}

function NumberField({ label, value, step, onChange }: NumberFieldProps) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <input
        type="number"
        value={toDisplayNumber(value, 3)}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

type TextFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
}

function TextField({ label, value, onChange }: TextFieldProps) {
  return (
    <label className="editor-field editor-field--wide">
      <span>{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

type SelectFieldProps = {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}

function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return (
    <label className="editor-field editor-field--wide">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

type ColorFieldProps = {
  label: string
  value: TintColor
  onChange: (value: string) => void
}

function ColorField({ label, value, onChange }: ColorFieldProps) {
  return (
    <label className="editor-field editor-field--wide">
      <span>{label}</span>
      <input type="color" value={tintToHex(value)} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

type ActionRowProps = {
  actions: Array<{ label: string; onClick: () => void }>
}

function ActionRow({ actions }: ActionRowProps) {
  return (
    <div className="editor-actions">
      {actions.map((action) => (
        <button key={action.label} type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </div>
  )
}
