import {
  Background as LayoutBackground,
  LayoutEngine,
  Frame as LayoutFrame,
  HStack as LayoutHStack,
  Noop as LayoutNoop,
  Overlay as LayoutOverlay,
  Padding as LayoutPadding,
  Spacer as LayoutSpacer,
  VStack as LayoutVStack,
  ZStack as LayoutZStack,
} from '@liquid-dom/layout'
import {
  DomLeaf,
  type DomLeafOptions,
  type DomLeafSizing,
} from '@liquid-dom/layout/dom'
import {
  Container as SceneContainer,
  Glass as SceneGlass,
  Group as SceneGroup,
  Html as SceneHtml,
  Scene as GlassScene,
  StackingContext as SceneStackingContext,
  type ContainerInit,
  type GlassInit,
} from './scene'
import {
  resolveBlendSupportGating,
  resolveNormalGating,
  resolveSmoothUnionOptions,
  sameBlendSupportGating,
  sameNormalGating,
  sameSmoothUnionOptions,
  type BlendSupportGating,
  type NormalGating,
  type ResolvedBlendSupportGating,
  type ResolvedNormalGating,
  type SmoothUnionOptions,
} from './sdf'
import type {
  Alignment,
  DecorationOptions,
  FrameNode,
  FrameOptions,
  InsetsInput,
  LayoutDebugStats,
  LayoutEngineOptions,
  LayoutInvalidation,
  LayoutNode,
  PaddingNode,
  PaddingOptions,
  ProposedSize,
  Rect,
  SpacerNode,
  SpacerOptions,
  StackAlignment,
  StackNode,
  StackOptions,
  ZStackNode,
  ZStackOptions,
} from '@liquid-dom/layout'
import type {
  Point,
  RgbaColor,
  SpecularWidth,
  SurfaceProfile,
  Transform as SceneTransform,
} from './types'

type SceneNode = SceneContainer | SceneGlass | SceneGroup | SceneStackingContext | SceneHtml
type SceneParent = GlassScene | SceneNode
type UiParent = LayoutScene | UiNode

/** Any node accepted by the layout UI tree. */
export type LayoutUiNode =
  | HStack
  | VStack
  | Frame
  | Padding
  | Overlay
  | Background
  | ZStack
  | Transform
  | GlassContainer
  | Glass
  | Html
  | Spacer

/** Constructor options for {@link LayoutScene}. */
export type LayoutSceneOptions = Omit<LayoutEngineOptions, 'root'> & {
  /** Optional root node to attach immediately. */
  root?: LayoutUiNode
}

/** Kind of layout UI invalidation emitted by {@link LayoutScene}. */
export type LayoutSceneInvalidationKind = 'layout' | 'frame'

/** Invalidation emitted when layout UI nodes are mutated imperatively. */
export type LayoutSceneInvalidation = {
  /** Whether the mutation requires a layout pass or only a new frame. */
  kind: LayoutSceneInvalidationKind
  /** Optional source node for mutations that came from the layout UI tree. */
  node?: LayoutUiNode
  /** Optional low-level invalidation detail. */
  cause?: unknown
}

/** Listener registered with {@link LayoutScene.addInvalidationListener}. */
export type LayoutSceneInvalidationListener = (invalidation: LayoutSceneInvalidation) => void

/** Constructor options for {@link GlassContainer}. */
export type GlassContainerOptions = Omit<ContainerInit, keyof SceneTransform>

/** Constructor options for {@link Glass}. */
export type GlassOptions = Omit<GlassInit, keyof SceneTransform | 'width' | 'height'>

/** Constructor options for {@link Html}. */
export type HtmlOptions = {
  /** Final opacity used when compositing this HTML node into the rendered scene. */
  opacity?: number
  /** Content blur radius in CSS pixels applied when compositing this HTML node. */
  blur?: number
  /** Scene draw order among sibling scene or glass HTML nodes. */
  zIndex?: number
  /** Measured content element rendered inside the layout-owned scene HTML host. */
  element?: HTMLElement | null
  /** DOM measurement mode used by the default DOM measurement path. */
  sizing?: DomLeafSizing
}

/** Unit-space origin for a layout transform. `{ x: 0, y: 0 }` is top-left and `{ x: 0.5, y: 0.5 }` is center. */
export type UnitPoint = {
  x: number
  y: number
}

/** Constructor options for {@link Transform}. */
export type TransformOptions = Omit<Partial<SceneTransform>, 'origin'> & {
  /** Transform origin as a unit point in the layout node's measured bounds. */
  origin?: UnitPoint
}

function clonePoint(point?: Point): Point {
  return point ? { x: point.x, y: point.y } : { x: 0, y: 0 }
}

function cloneUnitPoint(point?: UnitPoint): UnitPoint {
  return point ? { x: point.x, y: point.y } : { x: 0, y: 0 }
}

function resetLayoutTransform(node: SceneTransform, rect: Rect) {
  node.x = rect.x
  node.y = rect.y
  node.scaleX = 1
  node.scaleY = 1
  node.rotation = 0
  node.origin = { x: 0, y: 0 }
}

function syncOwnedHtmlElementSizing(element: HTMLElement, sizing: DomLeafSizing) {
  if (sizing === 'fill') {
    element.style.display = 'block'
    element.style.width = '100%'
    element.style.height = '100%'
    element.style.boxSizing = 'border-box'
    return
  }

  element.style.display = ''
  element.style.width = ''
  element.style.height = ''
  element.style.boxSizing = ''
}

function setProperty<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): boolean {
  const previous = target[key]
  target[key] = value
  return !Object.is(target[key], previous)
}

function attachSceneChild(parent: SceneParent, child: SceneNode) {
  if (parent instanceof GlassScene) {
    if (child instanceof SceneContainer || child instanceof SceneHtml || child instanceof SceneGroup) {
      parent.add(child)
      return
    }
  } else if (parent instanceof SceneContainer) {
    if (child instanceof SceneGlass || child instanceof SceneGroup) {
      parent.add(child)
      return
    }
  } else if (parent instanceof SceneGlass) {
    if (child instanceof SceneHtml || child instanceof SceneGroup) {
      parent.add(child)
      return
    }
  } else if (parent instanceof SceneGroup) {
    parent.add(child)
    return
  }

  throw new Error('This layout child cannot be attached to the nearest liquid-glass scene parent.')
}

function assertNoUiCycle(parent: UiNode, child: UiNode) {
  if (parent === child) {
    throw new Error('A layout UI node cannot be inserted into itself.')
  }

  let current: UiParent | null = parent
  while (current instanceof UiNode) {
    if (current === child) {
      throw new Error('A layout UI node cannot be inserted into one of its descendants.')
    }
    current = current._parent
  }
}

/**
 * Base class for nodes in the liquid-glass layout UI tree.
 */
abstract class UiNode<
  Layout extends LayoutNode = LayoutNode,
  SceneRef extends SceneNode | null = SceneNode | null,
> {
  /** Node owned by the @liquid-dom/layout engine. */
  readonly layoutNode: Layout
  /** Scene graph node owned by the liquid-glass renderer, when this node has one. */
  readonly sceneNode: SceneRef

  _parent: UiParent | null = null
  protected readonly _children: LayoutUiNode[] = []

  protected constructor(layoutNode: Layout, sceneNode: SceneRef) {
    this.layoutNode = layoutNode
    this.sceneNode = sceneNode
  }

  /** UI children in layout order. */
  get children(): readonly LayoutUiNode[] {
    return this._children
  }

  /** Adds a child node, reparenting it from any previous UI parent. */
  add<T extends LayoutUiNode>(child: T): T {
    return this.addChild(child)
  }

  /** Detaches this node from its current UI parent. */
  remove() {
    this._parent?._detachChild(this as unknown as LayoutUiNode)
  }

  _detachChild(child: LayoutUiNode) {
    const index = this._children.indexOf(child)
    if (index === -1) {
      return
    }

    this._children.splice(index, 1)
    child.layoutNode.remove()
    child.sceneNode?.remove()
    child._parent = null
  }

  _applyLayoutTree() {
    const rect = this.layoutNode.layout?.rect
    if (rect) {
      this.applyLayoutRect(rect)
    }

    for (const child of this._children) {
      child._applyLayoutTree()
    }
  }

  protected addChild<T extends LayoutUiNode>(child: T): T {
    if (child._parent === this && this._children.includes(child)) {
      return child
    }

    assertNoUiCycle(this, child)
    this.assertCanAddChild(child)
    child._parent?._detachChild(child)

    this._children.push(child)
    child._parent = this
    this.layoutNode.append(child.layoutNode)
    this.attachChildScene(child)
    return child
  }

  _emitInvalidation(invalidation: LayoutSceneInvalidation) {
    this._parent?._emitInvalidation(invalidation)
  }

  protected invalidateLayout(cause?: unknown) {
    this._emitInvalidation({
      kind: 'layout',
      node: this as unknown as LayoutUiNode,
      cause,
    })
  }

  protected invalidateFrame(cause?: unknown) {
    this._emitInvalidation({
      kind: 'frame',
      node: this as unknown as LayoutUiNode,
      cause,
    })
  }

  protected assertCanAddChild(_child: LayoutUiNode) {
    return
  }

  protected attachChildScene(child: LayoutUiNode) {
    if (!this.sceneNode || !child.sceneNode) {
      return
    }

    attachSceneChild(this.sceneNode, child.sceneNode)
  }

  protected applyLayoutRect(rect: Rect) {
    if (this.sceneNode) {
      resetLayoutTransform(this.sceneNode, rect)
    }
  }
}

/**
 * Base class for layout nodes that accept exactly one child.
 */
abstract class SingleChildUiNode<
  Layout extends LayoutNode = LayoutNode,
  SceneRef extends SceneNode | null = SceneNode | null,
> extends UiNode<Layout, SceneRef> {
  override add<T extends LayoutUiNode>(child: T): T {
    return this.addChild(child)
  }

  protected override assertCanAddChild(child: LayoutUiNode) {
    if (this._children.length > 0 && this._children[0] !== child) {
      throw new Error(`${this.constructor.name} accepts exactly one child.`)
    }
  }
}

/**
 * Root owner for a layout UI tree, @liquid-dom/layout engine, and raw liquid-glass scene.
 */
export class LayoutScene {
  /** Raw scene consumed by {@link import('./renderer').Renderer}. */
  readonly scene = new GlassScene()
  /** Layout engine used to measure and place the UI tree. */
  readonly engine: LayoutEngine

  private _root: LayoutUiNode | null = null
  private readonly invalidationListeners = new Set<LayoutSceneInvalidationListener>()

  constructor(options: LayoutSceneOptions = {}) {
    const { root, onInvalidate, ...engineOptions } = options
    this.engine = new LayoutEngine({
      ...engineOptions,
      onInvalidate: (invalidation: LayoutInvalidation) => {
        onInvalidate?.(invalidation)
        this._emitInvalidation({ kind: 'layout', cause: invalidation })
      },
    })
    if (root) {
      this.add(root)
    }
  }

  /** Current root UI node, if one is attached. */
  get root(): LayoutUiNode | null {
    return this._root
  }

  /** Adds a listener for UI mutations that require layout or rendering work. */
  addInvalidationListener(listener: LayoutSceneInvalidationListener): () => void {
    this.invalidationListeners.add(listener)
    return () => {
      this.invalidationListeners.delete(listener)
    }
  }

  /** Adds the root UI node, replacing no existing root. */
  add<T extends LayoutUiNode>(child: T): T {
    if (this._root === child) {
      return child
    }
    if (this._root) {
      throw new Error('LayoutScene accepts exactly one root node.')
    }

    child._parent?._detachChild(child)
    this._root = child
    child._parent = this
    this.engine.root = child.layoutNode
    if (child.sceneNode) {
      attachSceneChild(this.scene, child.sceneNode)
    }

    this._emitInvalidation({ kind: 'layout', node: child, cause: 'root' })
    return child
  }

  /** Runs layout and applies the resulting geometry to the mirrored scene graph. */
  layout(proposal: ProposedSize): LayoutDebugStats {
    const stats = this.engine.layout(proposal)
    this._root?._applyLayoutTree()
    return stats
  }

  /** Returns the @liquid-dom/layout engine's most recent debug stats. */
  getDebugStats(): LayoutDebugStats {
    return this.engine.getDebugStats()
  }

  /** Detaches the root and disposes the layout engine. */
  dispose() {
    if (this._root) {
      this._detachChild(this._root)
    }
    this.engine.dispose()
  }

  _detachChild(child: LayoutUiNode) {
    if (this._root !== child) {
      return
    }

    child.layoutNode.remove()
    child.sceneNode?.remove()
    child._parent = null
    this._root = null
    this.engine.root = undefined
    this._emitInvalidation({ kind: 'layout', node: child, cause: 'root' })
  }

  _emitInvalidation(invalidation: LayoutSceneInvalidation) {
    for (const listener of this.invalidationListeners) {
      listener(invalidation)
    }
  }
}

/**
 * Horizontal stack layout backed by a transform-only scene group.
 */
export class HStack extends UiNode<StackNode, SceneGroup> {
  constructor(options: StackOptions = {}) {
    super(new LayoutHStack(options), new SceneGroup())
  }

  get spacing(): number {
    return this.layoutNode.spacing
  }

  set spacing(value: number) {
    this.layoutNode.spacing = value
  }

  get alignment(): StackAlignment {
    return this.layoutNode.alignment
  }

  set alignment(value: StackAlignment) {
    this.layoutNode.alignment = value
  }
}

/**
 * Vertical stack layout backed by a transform-only scene group.
 */
export class VStack extends UiNode<StackNode, SceneGroup> {
  constructor(options: StackOptions = {}) {
    super(new LayoutVStack(options), new SceneGroup())
  }

  get spacing(): number {
    return this.layoutNode.spacing
  }

  set spacing(value: number) {
    this.layoutNode.spacing = value
  }

  get alignment(): StackAlignment {
    return this.layoutNode.alignment
  }

  set alignment(value: StackAlignment) {
    this.layoutNode.alignment = value
  }
}

/**
 * Z-stack layout backed by a local stacking context.
 */
export class ZStack extends UiNode<ZStackNode, SceneStackingContext> {
  private readonly sceneSlots = new Map<LayoutUiNode, SceneStackingContext>()

  constructor(options: ZStackOptions = {}) {
    super(new LayoutZStack(options), new SceneStackingContext())
  }

  get alignment(): Alignment {
    return this.layoutNode.alignment
  }

  set alignment(value: Alignment) {
    this.layoutNode.alignment = value
  }

  override _detachChild(child: LayoutUiNode) {
    const slot = this.sceneSlots.get(child)
    super._detachChild(child)
    slot?.remove()
    this.sceneSlots.delete(child)
    this.syncSlotZIndices()
  }

  protected override addChild<T extends LayoutUiNode>(child: T): T {
    const added = super.addChild(child)
    this.syncSlotZIndices()
    return added
  }

  protected override attachChildScene(child: LayoutUiNode) {
    if (!child.sceneNode) {
      return
    }

    const slot = new SceneStackingContext()
    this.sceneSlots.set(child, slot)
    attachSceneChild(this.sceneNode, slot)
    attachSceneChild(slot, child.sceneNode)
  }

  private syncSlotZIndices() {
    for (const [index, child] of this._children.entries()) {
      const slot = this.sceneSlots.get(child)
      if (slot) {
        slot.zIndex = index
      }
    }
  }
}

/**
 * Frame layout backed by a transform-only scene group.
 */
export class Frame extends SingleChildUiNode<FrameNode, SceneGroup> {
  constructor(options: FrameOptions = {}) {
    super(new LayoutFrame(options), new SceneGroup())
  }

  get width(): number | undefined {
    return this.layoutNode.width
  }

  set width(value: number | undefined) {
    this.layoutNode.width = value
  }

  get height(): number | undefined {
    return this.layoutNode.height
  }

  set height(value: number | undefined) {
    this.layoutNode.height = value
  }

  get minWidth(): number | undefined {
    return this.layoutNode.minWidth
  }

  set minWidth(value: number | undefined) {
    this.layoutNode.minWidth = value
  }

  get minHeight(): number | undefined {
    return this.layoutNode.minHeight
  }

  set minHeight(value: number | undefined) {
    this.layoutNode.minHeight = value
  }

  get idealWidth(): number | undefined {
    return this.layoutNode.idealWidth
  }

  set idealWidth(value: number | undefined) {
    this.layoutNode.idealWidth = value
  }

  get idealHeight(): number | undefined {
    return this.layoutNode.idealHeight
  }

  set idealHeight(value: number | undefined) {
    this.layoutNode.idealHeight = value
  }

  get maxWidth(): FrameNode['maxWidth'] {
    return this.layoutNode.maxWidth
  }

  set maxWidth(value: FrameNode['maxWidth']) {
    this.layoutNode.maxWidth = value
  }

  get maxHeight(): FrameNode['maxHeight'] {
    return this.layoutNode.maxHeight
  }

  set maxHeight(value: FrameNode['maxHeight']) {
    this.layoutNode.maxHeight = value
  }

  get alignment(): Alignment {
    return this.layoutNode.alignment
  }

  set alignment(value: Alignment) {
    this.layoutNode.alignment = value
  }
}

/**
 * Padding layout backed by a transform-only scene group.
 */
export class Padding extends SingleChildUiNode<PaddingNode, SceneGroup> {
  constructor(options: PaddingOptions = {}) {
    super(new LayoutPadding(options), new SceneGroup())
  }

  get insets(): InsetsInput {
    return this.layoutNode.insets
  }

  set insets(value: InsetsInput) {
    this.layoutNode.insets = value
  }
}

abstract class DecorationUiNode extends UiNode<LayoutNode, SceneStackingContext> {
  private readonly emptyContent = new LayoutNoop()
  private readonly emptyDecoration = new LayoutNoop()
  private readonly contentSlot = new SceneStackingContext()
  private readonly decorationSlot = new SceneStackingContext()
  private content: LayoutUiNode | null = null
  private decoration: LayoutUiNode | null = null

  protected constructor(
    layoutNode: LayoutNode,
    private readonly sceneOrder: 'background' | 'overlay',
  ) {
    super(layoutNode, new SceneStackingContext())
    this.syncSlotZIndices()
    attachSceneChild(this.sceneNode, this.contentSlot)
    attachSceneChild(this.sceneNode, this.decorationSlot)
  }

  override add<T extends LayoutUiNode>(child: T): T {
    if (!this.content) {
      return this.setContent(child)
    }
    if (!this.decoration) {
      return this.setDecoration(child)
    }

    throw new Error(`${this.constructor.name} accepts content and decoration children only.`)
  }

  /** Replaces the content child. */
  setContent<T extends LayoutUiNode>(child: T): T {
    this.replaceSlot('content', child)
    return child
  }

  /** Replaces the decoration child. */
  setDecoration<T extends LayoutUiNode>(child: T): T {
    this.replaceSlot('decoration', child)
    return child
  }

  get alignment(): Alignment {
    return (this.layoutNode as unknown as { alignment: Alignment }).alignment
  }

  set alignment(value: Alignment) {
    const layoutNode = this.layoutNode as unknown as { alignment: Alignment }
    layoutNode.alignment = value
  }

  override _detachChild(child: LayoutUiNode) {
    if (this.content !== child && this.decoration !== child) {
      return
    }

    if (this.content === child) {
      this.content = null
    } else {
      this.decoration = null
    }

    this._children.splice(this._children.indexOf(child), 1)
    child.layoutNode.remove()
    child.sceneNode?.remove()
    child._parent = null
    this.syncLayoutSlots()
  }

  private replaceSlot(slot: 'content' | 'decoration', child: LayoutUiNode) {
    assertNoUiCycle(this, child)

    const current = slot === 'content' ? this.content : this.decoration
    if (current === child) {
      return
    }
    if (current) {
      this._detachChild(current)
    }

    child._parent?._detachChild(child)
    if (slot === 'content') {
      this.content = child
    } else {
      this.decoration = child
    }

    this._children.push(child)
    child._parent = this
    this.syncLayoutSlots()
    this.syncSceneSlots()
  }

  private syncLayoutSlots() {
    this.layoutNode.replaceChildren(
      this.content?.layoutNode ?? this.emptyContent,
      this.decoration?.layoutNode ?? this.emptyDecoration,
    )
  }

  private syncSceneSlots() {
    this.content?.sceneNode?.remove()
    this.decoration?.sceneNode?.remove()

    if (this.content?.sceneNode) {
      attachSceneChild(this.contentSlot, this.content.sceneNode)
    }
    if (this.decoration?.sceneNode) {
      attachSceneChild(this.decorationSlot, this.decoration.sceneNode)
    }
  }

  private syncSlotZIndices() {
    this.contentSlot.zIndex = this.sceneOrder === 'background' ? 1 : 0
    this.decorationSlot.zIndex = this.sceneOrder === 'background' ? 0 : 1
  }
}

/**
 * Background decoration layout backed by a local stacking context.
 */
export class Background extends DecorationUiNode {
  constructor(options: DecorationOptions = {}) {
    const emptyContent = new LayoutNoop()
    const emptyDecoration = new LayoutNoop()
    super(new LayoutBackground(options).append(emptyContent, emptyDecoration), 'background')
  }
}

/**
 * Overlay decoration layout backed by a local stacking context.
 */
export class Overlay extends DecorationUiNode {
  constructor(options: DecorationOptions = {}) {
    const emptyContent = new LayoutNoop()
    const emptyDecoration = new LayoutNoop()
    super(new LayoutOverlay(options).append(emptyContent, emptyDecoration), 'overlay')
  }
}

/**
 * Layout pass-through node that contributes an explicit scene transform.
 */
export class Transform extends SingleChildUiNode<LayoutNode, SceneGroup> {
  private _x = 0
  private _y = 0
  private _scaleX = 1
  private _scaleY = 1
  private _rotation = 0
  private _origin: UnitPoint = { x: 0, y: 0 }

  constructor(options: TransformOptions = {}) {
    super(new LayoutNoop(), new SceneGroup())
    this._x = options.x ?? 0
    this._y = options.y ?? 0
    this._scaleX = options.scaleX ?? 1
    this._scaleY = options.scaleY ?? 1
    this._rotation = options.rotation ?? 0
    this._origin = cloneUnitPoint(options.origin)
  }

  get x(): number {
    return this._x
  }

  set x(value: number) {
    if (Object.is(this._x, value)) {
      return
    }

    this._x = value
    this.syncSceneTransform()
    this.invalidateFrame('x')
  }

  get y(): number {
    return this._y
  }

  set y(value: number) {
    if (Object.is(this._y, value)) {
      return
    }

    this._y = value
    this.syncSceneTransform()
    this.invalidateFrame('y')
  }

  get scaleX(): number {
    return this._scaleX
  }

  set scaleX(value: number) {
    if (Object.is(this._scaleX, value)) {
      return
    }

    this._scaleX = value
    this.syncSceneTransform()
    this.invalidateFrame('scaleX')
  }

  get scaleY(): number {
    return this._scaleY
  }

  set scaleY(value: number) {
    if (Object.is(this._scaleY, value)) {
      return
    }

    this._scaleY = value
    this.syncSceneTransform()
    this.invalidateFrame('scaleY')
  }

  get rotation(): number {
    return this._rotation
  }

  set rotation(value: number) {
    if (Object.is(this._rotation, value)) {
      return
    }

    this._rotation = value
    this.syncSceneTransform()
    this.invalidateFrame('rotation')
  }

  get origin(): UnitPoint {
    return this._origin
  }

  set origin(value: UnitPoint) {
    if (this._origin.x === value.x && this._origin.y === value.y) {
      return
    }

    this._origin = cloneUnitPoint(value)
    this.syncSceneTransform()
    this.invalidateFrame('origin')
  }

  protected override applyLayoutRect(rect: Rect) {
    this.syncSceneTransform(rect)
  }

  private syncSceneTransform(rect = this.layoutNode.layout?.rect) {
    const layoutX = rect?.x ?? 0
    const layoutY = rect?.y ?? 0
    this.sceneNode.x = layoutX + this._x
    this.sceneNode.y = layoutY + this._y
    this.sceneNode.scaleX = this._scaleX
    this.sceneNode.scaleY = this._scaleY
    this.sceneNode.rotation = this._rotation
    this.sceneNode.origin = {
      x: this._origin.x * (rect?.width ?? 0),
      y: this._origin.y * (rect?.height ?? 0),
    }
  }
}

/**
 * Liquid-glass container view backed by a scene {@link SceneContainer}.
 */
export class GlassContainer extends SingleChildUiNode<LayoutNode, SceneContainer> {
  constructor(options: GlassContainerOptions = {}) {
    super(new LayoutNoop(), new SceneContainer(options))
  }

  get opacity(): number {
    return this.sceneNode.opacity
  }

  set opacity(value: number) {
    if (setProperty(this.sceneNode, 'opacity', value)) {
      this.invalidateFrame('opacity')
    }
  }

  get spacing(): number {
    return this.sceneNode.spacing
  }

  set spacing(value: number) {
    if (setProperty(this.sceneNode, 'spacing', value)) {
      this.invalidateFrame('spacing')
    }
  }

  get blur(): number {
    return this.sceneNode.blur
  }

  set blur(value: number) {
    if (setProperty(this.sceneNode, 'blur', value)) {
      this.invalidateFrame('blur')
    }
  }

  get bezelWidth(): number {
    return this.sceneNode.bezelWidth
  }

  set bezelWidth(value: number) {
    if (setProperty(this.sceneNode, 'bezelWidth', value)) {
      this.invalidateFrame('bezelWidth')
    }
  }

  get thickness(): number {
    return this.sceneNode.thickness
  }

  set thickness(value: number) {
    if (setProperty(this.sceneNode, 'thickness', value)) {
      this.invalidateFrame('thickness')
    }
  }

  get displacementFactor(): number {
    return this.sceneNode.displacementFactor
  }

  set displacementFactor(value: number) {
    if (setProperty(this.sceneNode, 'displacementFactor', value)) {
      this.invalidateFrame('displacementFactor')
    }
  }

  get displacementBlur(): number {
    return this.sceneNode.displacementBlur
  }

  set displacementBlur(value: number) {
    if (setProperty(this.sceneNode, 'displacementBlur', value)) {
      this.invalidateFrame('displacementBlur')
    }
  }

  get normalGating(): ResolvedNormalGating {
    return this.sceneNode.normalGating
  }

  set normalGating(value: NormalGating) {
    const next = resolveNormalGating(value)
    if (!sameNormalGating(this.sceneNode.normalGating, next)) {
      this.sceneNode.normalGating = next
      this.invalidateFrame('normalGating')
    }
  }

  get blendSupportGating(): ResolvedBlendSupportGating {
    return this.sceneNode.blendSupportGating
  }

  set blendSupportGating(value: BlendSupportGating | undefined) {
    const next = resolveBlendSupportGating(value)
    if (!sameBlendSupportGating(this.sceneNode.blendSupportGating, next)) {
      this.sceneNode.blendSupportGating = next
      this.invalidateFrame('blendSupportGating')
    }
  }

  get smoothUnion(): SceneContainer['smoothUnion'] {
    return this.sceneNode.smoothUnion
  }

  set smoothUnion(value: SmoothUnionOptions | undefined) {
    const next = resolveSmoothUnionOptions(value)
    if (!sameSmoothUnionOptions(this.sceneNode.smoothUnion, next)) {
      this.sceneNode.smoothUnion = next
      this.invalidateFrame('smoothUnion')
    }
  }

  get ior(): number {
    return this.sceneNode.ior
  }

  set ior(value: number) {
    if (setProperty(this.sceneNode, 'ior', value)) {
      this.invalidateFrame('ior')
    }
  }

  get contentIor(): number {
    return this.sceneNode.contentIor
  }

  set contentIor(value: number) {
    if (setProperty(this.sceneNode, 'contentIor', value)) {
      this.invalidateFrame('contentIor')
    }
  }

  get contentDepth(): number {
    return this.sceneNode.contentDepth
  }

  set contentDepth(value: number) {
    if (setProperty(this.sceneNode, 'contentDepth', value)) {
      this.invalidateFrame('contentDepth')
    }
  }

  get dispersion(): number {
    return this.sceneNode.dispersion
  }

  set dispersion(value: number) {
    if (setProperty(this.sceneNode, 'dispersion', value)) {
      this.invalidateFrame('dispersion')
    }
  }

  get surfaceProfile(): SurfaceProfile {
    return this.sceneNode.surfaceProfile
  }

  set surfaceProfile(value: SurfaceProfile) {
    if (setProperty(this.sceneNode, 'surfaceProfile', value)) {
      this.invalidateFrame('surfaceProfile')
    }
  }

  get lightDirection(): number {
    return this.sceneNode.lightDirection
  }

  set lightDirection(value: number) {
    if (setProperty(this.sceneNode, 'lightDirection', value)) {
      this.invalidateFrame('lightDirection')
    }
  }

  get specularStrength(): number {
    return this.sceneNode.specularStrength
  }

  set specularStrength(value: number) {
    if (setProperty(this.sceneNode, 'specularStrength', value)) {
      this.invalidateFrame('specularStrength')
    }
  }

  get specularWidth(): SpecularWidth {
    return this.sceneNode.specularWidth
  }

  set specularWidth(value: SpecularWidth) {
    if (setProperty(this.sceneNode, 'specularWidth', value)) {
      this.invalidateFrame('specularWidth')
    }
  }

  get specularFalloff(): number {
    return this.sceneNode.specularFalloff
  }

  set specularFalloff(value: number) {
    if (setProperty(this.sceneNode, 'specularFalloff', value)) {
      this.invalidateFrame('specularFalloff')
    }
  }

  get oppositeSpecularStrength(): number {
    return this.sceneNode.oppositeSpecularStrength
  }

  set oppositeSpecularStrength(value: number) {
    if (setProperty(this.sceneNode, 'oppositeSpecularStrength', value)) {
      this.invalidateFrame('oppositeSpecularStrength')
    }
  }

  get specularSharpness(): number {
    return this.sceneNode.specularSharpness
  }

  set specularSharpness(value: number) {
    if (setProperty(this.sceneNode, 'specularSharpness', value)) {
      this.invalidateFrame('specularSharpness')
    }
  }

  get specularOpacity(): number {
    return this.sceneNode.specularOpacity
  }

  set specularOpacity(value: number) {
    if (setProperty(this.sceneNode, 'specularOpacity', value)) {
      this.invalidateFrame('specularOpacity')
    }
  }

  get reflectionOffset(): number {
    return this.sceneNode.reflectionOffset
  }

  set reflectionOffset(value: number) {
    if (setProperty(this.sceneNode, 'reflectionOffset', value)) {
      this.invalidateFrame('reflectionOffset')
    }
  }

  get tint(): RgbaColor {
    return this.sceneNode.tint
  }

  set tint(value: RgbaColor) {
    if (setProperty(this.sceneNode, 'tint', value)) {
      this.invalidateFrame('tint')
    }
  }

  get shadowColor(): RgbaColor {
    return this.sceneNode.shadowColor
  }

  set shadowColor(value: RgbaColor) {
    if (setProperty(this.sceneNode, 'shadowColor', value)) {
      this.invalidateFrame('shadowColor')
    }
  }

  get shadowOffsetX(): number {
    return this.sceneNode.shadowOffsetX
  }

  set shadowOffsetX(value: number) {
    if (setProperty(this.sceneNode, 'shadowOffsetX', value)) {
      this.invalidateFrame('shadowOffsetX')
    }
  }

  get shadowOffsetY(): number {
    return this.sceneNode.shadowOffsetY
  }

  set shadowOffsetY(value: number) {
    if (setProperty(this.sceneNode, 'shadowOffsetY', value)) {
      this.invalidateFrame('shadowOffsetY')
    }
  }

  get shadowBlur(): number {
    return this.sceneNode.shadowBlur
  }

  set shadowBlur(value: number) {
    if (setProperty(this.sceneNode, 'shadowBlur', value)) {
      this.invalidateFrame('shadowBlur')
    }
  }

  get shadowSpread(): number {
    return this.sceneNode.shadowSpread
  }

  set shadowSpread(value: number) {
    if (setProperty(this.sceneNode, 'shadowSpread', value)) {
      this.invalidateFrame('shadowSpread')
    }
  }

  get debugDisplacement(): boolean {
    return this.sceneNode.debugDisplacement
  }

  set debugDisplacement(value: boolean) {
    if (setProperty(this.sceneNode, 'debugDisplacement', value)) {
      this.invalidateFrame('debugDisplacement')
    }
  }

  get zIndex(): number {
    return this.sceneNode.zIndex
  }

  set zIndex(value: number) {
    if (setProperty(this.sceneNode, 'zIndex', value)) {
      this.invalidateFrame('zIndex')
    }
  }
}

/**
 * Liquid-glass shape view backed by a scene {@link SceneGlass}.
 */
export class Glass extends SingleChildUiNode<LayoutNode, SceneGlass> {
  constructor(options: GlassOptions = {}) {
    super(new LayoutNoop(), new SceneGlass(options))
  }

  get cornerRadius(): number {
    return this.sceneNode.cornerRadius
  }

  set cornerRadius(value: number) {
    if (setProperty(this.sceneNode, 'cornerRadius', value)) {
      this.invalidateFrame('cornerRadius')
    }
  }

  get cornerSmoothing(): number {
    return this.sceneNode.cornerSmoothing
  }

  set cornerSmoothing(value: number) {
    if (setProperty(this.sceneNode, 'cornerSmoothing', value)) {
      this.invalidateFrame('cornerSmoothing')
    }
  }

  get pointerEvents(): boolean {
    return this.sceneNode.pointerEvents
  }

  set pointerEvents(value: boolean) {
    if (setProperty(this.sceneNode, 'pointerEvents', value)) {
      this.invalidateFrame('pointerEvents')
    }
  }

  get zIndex(): number {
    return this.sceneNode.zIndex
  }

  set zIndex(value: number) {
    if (setProperty(this.sceneNode, 'zIndex', value)) {
      this.invalidateFrame('zIndex')
    }
  }

  protected override applyLayoutRect(rect: Rect) {
    resetLayoutTransform(this.sceneNode, rect)
    this.sceneNode.width = rect.width
    this.sceneNode.height = rect.height
  }
}

/**
 * DOM-backed HTML view backed by a measured layout leaf and scene {@link SceneHtml}.
 */
export class Html extends UiNode<DomLeaf, SceneHtml> {
  private readonly ownedElement: HTMLElement

  constructor(options: HtmlOptions = {}) {
    const ownedElement = document.createElement('div')
    const contentElement = options.element ?? ownedElement
    const sizing = options.sizing ?? 'constrained-width'
    syncOwnedHtmlElementSizing(ownedElement, sizing)
    const sceneNode = new SceneHtml({
      opacity: options.opacity,
      blur: options.blur,
      zIndex: options.zIndex,
      element: contentElement,
    })
    const defaultMeasureOptions: DomLeafOptions = {
      element: contentElement,
      sizing,
    }
    const layoutNode = new DomLeaf(defaultMeasureOptions)

    super(layoutNode, sceneNode)
    this.ownedElement = ownedElement
  }

  override add<T extends LayoutUiNode>(_child: T): T {
    throw new Error('Html is a leaf node and cannot accept children.')
  }

  /** DOM measurement sizing mode. */
  get sizing(): DomLeafSizing {
    return this.layoutNode.sizing
  }

  set sizing(value: DomLeafSizing | undefined) {
    const nextSizing = value ?? 'constrained-width'
    if (this.layoutNode.sizing === nextSizing) {
      return
    }

    syncOwnedHtmlElementSizing(this.ownedElement, nextSizing)
    this.layoutNode.sizing = nextSizing
  }

  get opacity(): number {
    return this.sceneNode.opacity
  }

  set opacity(value: number) {
    if (setProperty(this.sceneNode, 'opacity', value)) {
      this.invalidateFrame('opacity')
    }
  }

  get blur(): number {
    return this.sceneNode.blur
  }

  set blur(value: number) {
    if (setProperty(this.sceneNode, 'blur', value)) {
      this.invalidateFrame('blur')
    }
  }

  get zIndex(): number {
    return this.sceneNode.zIndex
  }

  set zIndex(value: number) {
    if (setProperty(this.sceneNode, 'zIndex', value)) {
      this.invalidateFrame('zIndex')
    }
  }

  get element(): HTMLElement | null {
    return this.sceneNode.element
  }

  set element(value: HTMLElement | null) {
    this.setElement(value)
  }

  /** Replaces the measured content element inside the layout-owned scene host. */
  setElement(element: HTMLElement | null) {
    const contentElement = element ?? this.ownedElement
    if (this.layoutNode.element === contentElement) {
      return
    }

    this.sceneNode.setElement(contentElement)
    if (contentElement === this.ownedElement) {
      syncOwnedHtmlElementSizing(this.ownedElement, this.sizing)
    }
    this.layoutNode.element = contentElement
  }

  protected override applyLayoutRect(rect: Rect) {
    resetLayoutTransform(this.sceneNode, rect)
    this.sceneNode.width = rect.width
    this.sceneNode.height = rect.height
  }
}

/**
 * Layout-only spacer leaf. It has no liquid-glass scene node.
 */
export class Spacer extends UiNode<SpacerNode, null> {
  constructor(options: SpacerOptions = {}) {
    super(new LayoutSpacer(options), null)
  }

  override add<T extends LayoutUiNode>(_child: T): T {
    throw new Error('Spacer is a leaf node and cannot accept children.')
  }

  get minLength(): number {
    return this.layoutNode.minLength
  }

  set minLength(value: number) {
    this.layoutNode.minLength = value
  }
}
