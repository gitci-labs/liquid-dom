import {
  background as createBackground,
  createLayoutEngine,
  frame as createFrame,
  hstack as createHStack,
  noop as createNoop,
  overlay as createOverlay,
  padding as createPadding,
  spacer as createSpacer,
  vstack as createVStack,
  zstack as createZStack,
} from 'laymeout'
import {
  domLeaf,
  subscribeDomElement,
  type DomLeafOptions,
  type DomLeafSizing,
} from 'laymeout/dom'
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
import type {
  Alignment,
  DecorationOptions,
  FrameNode,
  FrameOptions,
  InsetsInput,
  LayoutDebugStats,
  LayoutEngine,
  LayoutEngineOptions,
  LayoutInvalidation,
  LayoutNode as LaymeoutNode,
  LeafNode,
  LeafSubscribe,
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
} from 'laymeout'
import type { Point, RgbaColor, SpecularWidth, SurfaceProfile, Transform as SceneTransform } from './types'

type SceneNode = SceneContainer | SceneGlass | SceneGroup | SceneStackingContext | SceneHtml
type SceneParent = GlassScene | SceneNode
type UiParent = LayoutScene | UiNode

/** Any node accepted by the retained layout UI tree. */
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

/** Kind of retained layout UI invalidation emitted by {@link LayoutScene}. */
export type LayoutSceneInvalidationKind = 'layout' | 'frame'

/** Invalidation emitted when retained layout UI nodes are mutated imperatively. */
export type LayoutSceneInvalidation = {
  /** Whether the mutation requires a layout pass or only a new frame. */
  kind: LayoutSceneInvalidationKind
  /** Optional source node for mutations that came from the retained UI tree. */
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
  /** Scene draw order among sibling scene or glass HTML nodes. */
  zIndex?: number
  /** Measured content element rendered inside the layout-owned scene HTML host. */
  element?: HTMLElement | null
  /** DOM measurement mode used by the default DOM measurement path. */
  sizing?: DomLeafSizing
}

/** Constructor options for {@link Transform}. */
export type TransformOptions = Partial<SceneTransform>

function clonePoint(point?: Point): Point {
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
  Layout extends LaymeoutNode = LaymeoutNode,
  SceneRef extends SceneNode | null = SceneNode | null,
> {
  /** Retained node owned by the laymeout engine. */
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
    this.invalidateLayout('children')
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
    this.invalidateLayout('children')
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
  Layout extends LaymeoutNode = LaymeoutNode,
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
 * Root owner for a layout UI tree, laymeout engine, and raw liquid-glass scene.
 */
export class LayoutScene {
  /** Raw scene consumed by {@link import('./renderer').Renderer}. */
  readonly scene = new GlassScene()
  /** Laymeout engine used to measure and place the UI tree. */
  readonly engine: LayoutEngine

  private _root: LayoutUiNode | null = null
  private readonly invalidationListeners = new Set<LayoutSceneInvalidationListener>()

  constructor(options: LayoutSceneOptions = {}) {
    const { root, onInvalidate, ...engineOptions } = options
    this.engine = createLayoutEngine({
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

  /** Adds a listener for retained UI mutations that require layout or rendering work. */
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

  /** Returns the laymeout engine's most recent debug stats. */
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
    super(createHStack(options), new SceneGroup())
  }

  get spacing(): number {
    return this.layoutNode.spacing
  }

  set spacing(value: number) {
    if (setProperty(this.layoutNode, 'spacing', value)) {
      this.invalidateLayout('spacing')
    }
  }

  get alignment(): StackAlignment {
    return this.layoutNode.alignment
  }

  set alignment(value: StackAlignment) {
    if (setProperty(this.layoutNode, 'alignment', value)) {
      this.invalidateLayout('alignment')
    }
  }
}

/**
 * Vertical stack layout backed by a transform-only scene group.
 */
export class VStack extends UiNode<StackNode, SceneGroup> {
  constructor(options: StackOptions = {}) {
    super(createVStack(options), new SceneGroup())
  }

  get spacing(): number {
    return this.layoutNode.spacing
  }

  set spacing(value: number) {
    if (setProperty(this.layoutNode, 'spacing', value)) {
      this.invalidateLayout('spacing')
    }
  }

  get alignment(): StackAlignment {
    return this.layoutNode.alignment
  }

  set alignment(value: StackAlignment) {
    if (setProperty(this.layoutNode, 'alignment', value)) {
      this.invalidateLayout('alignment')
    }
  }
}

/**
 * Z-stack layout backed by a local stacking context.
 */
export class ZStack extends UiNode<ZStackNode, SceneStackingContext> {
  private readonly sceneSlots = new Map<LayoutUiNode, SceneStackingContext>()

  constructor(options: ZStackOptions = {}) {
    super(createZStack(options), new SceneStackingContext())
  }

  get alignment(): Alignment {
    return this.layoutNode.alignment
  }

  set alignment(value: Alignment) {
    if (setProperty(this.layoutNode, 'alignment', value)) {
      this.invalidateLayout('alignment')
    }
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
    super(createFrame(options), new SceneGroup())
  }

  get width(): number | undefined {
    return this.layoutNode.width
  }

  set width(value: number | undefined) {
    if (setProperty(this.layoutNode, 'width', value)) {
      this.invalidateLayout('width')
    }
  }

  get height(): number | undefined {
    return this.layoutNode.height
  }

  set height(value: number | undefined) {
    if (setProperty(this.layoutNode, 'height', value)) {
      this.invalidateLayout('height')
    }
  }

  get minWidth(): number | undefined {
    return this.layoutNode.minWidth
  }

  set minWidth(value: number | undefined) {
    if (setProperty(this.layoutNode, 'minWidth', value)) {
      this.invalidateLayout('minWidth')
    }
  }

  get minHeight(): number | undefined {
    return this.layoutNode.minHeight
  }

  set minHeight(value: number | undefined) {
    if (setProperty(this.layoutNode, 'minHeight', value)) {
      this.invalidateLayout('minHeight')
    }
  }

  get idealWidth(): number | undefined {
    return this.layoutNode.idealWidth
  }

  set idealWidth(value: number | undefined) {
    if (setProperty(this.layoutNode, 'idealWidth', value)) {
      this.invalidateLayout('idealWidth')
    }
  }

  get idealHeight(): number | undefined {
    return this.layoutNode.idealHeight
  }

  set idealHeight(value: number | undefined) {
    if (setProperty(this.layoutNode, 'idealHeight', value)) {
      this.invalidateLayout('idealHeight')
    }
  }

  get maxWidth(): FrameNode['maxWidth'] {
    return this.layoutNode.maxWidth
  }

  set maxWidth(value: FrameNode['maxWidth']) {
    if (setProperty(this.layoutNode, 'maxWidth', value)) {
      this.invalidateLayout('maxWidth')
    }
  }

  get maxHeight(): FrameNode['maxHeight'] {
    return this.layoutNode.maxHeight
  }

  set maxHeight(value: FrameNode['maxHeight']) {
    if (setProperty(this.layoutNode, 'maxHeight', value)) {
      this.invalidateLayout('maxHeight')
    }
  }

  get alignment(): Alignment {
    return this.layoutNode.alignment
  }

  set alignment(value: Alignment) {
    if (setProperty(this.layoutNode, 'alignment', value)) {
      this.invalidateLayout('alignment')
    }
  }
}

/**
 * Padding layout backed by a transform-only scene group.
 */
export class Padding extends SingleChildUiNode<PaddingNode, SceneGroup> {
  constructor(options: PaddingOptions = {}) {
    super(createPadding(options), new SceneGroup())
  }

  get insets(): InsetsInput {
    return this.layoutNode.insets
  }

  set insets(value: InsetsInput) {
    if (setProperty(this.layoutNode, 'insets', value)) {
      this.invalidateLayout('insets')
    }
  }
}

abstract class DecorationUiNode extends UiNode<LaymeoutNode, SceneStackingContext> {
  private readonly emptyContent = createNoop()
  private readonly emptyDecoration = createNoop()
  private readonly contentSlot = new SceneStackingContext()
  private readonly decorationSlot = new SceneStackingContext()
  private content: LayoutUiNode | null = null
  private decoration: LayoutUiNode | null = null

  protected constructor(
    layoutNode: LaymeoutNode,
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
    if (setProperty(this.layoutNode as unknown as { alignment: Alignment }, 'alignment', value)) {
      this.invalidateLayout('alignment')
    }
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
    this.invalidateLayout('children')
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
    this.invalidateLayout('children')
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
    const emptyContent = createNoop()
    const emptyDecoration = createNoop()
    super(createBackground(emptyContent, emptyDecoration, options), 'background')
  }
}

/**
 * Overlay decoration layout backed by a local stacking context.
 */
export class Overlay extends DecorationUiNode {
  constructor(options: DecorationOptions = {}) {
    const emptyContent = createNoop()
    const emptyDecoration = createNoop()
    super(createOverlay(emptyContent, emptyDecoration, options), 'overlay')
  }
}

/**
 * Layout pass-through node that contributes an explicit scene transform.
 */
export class Transform extends SingleChildUiNode<LaymeoutNode, SceneGroup> {
  private _x = 0
  private _y = 0
  private _scaleX = 1
  private _scaleY = 1
  private _rotation = 0
  private _origin: Point = { x: 0, y: 0 }

  constructor(options: TransformOptions = {}) {
    super(createNoop(), new SceneGroup())
    this._x = options.x ?? 0
    this._y = options.y ?? 0
    this._scaleX = options.scaleX ?? 1
    this._scaleY = options.scaleY ?? 1
    this._rotation = options.rotation ?? 0
    this._origin = clonePoint(options.origin)
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

  get origin(): Point {
    return this._origin
  }

  set origin(value: Point) {
    if (this._origin.x === value.x && this._origin.y === value.y) {
      return
    }

    this._origin = clonePoint(value)
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
    this.sceneNode.origin = clonePoint(this._origin)
  }
}

/**
 * Liquid-glass container view backed by a scene {@link SceneContainer}.
 */
export class GlassContainer extends SingleChildUiNode<LaymeoutNode, SceneContainer> {
  constructor(options: GlassContainerOptions = {}) {
    super(createNoop(), new SceneContainer(options))
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

  get normalDivergenceBlendPower(): number {
    return this.sceneNode.normalDivergenceBlendPower
  }

  set normalDivergenceBlendPower(value: number) {
    if (setProperty(this.sceneNode, 'normalDivergenceBlendPower', value)) {
      this.invalidateFrame('normalDivergenceBlendPower')
    }
  }

  get normalDivergenceBlendEnabled(): boolean {
    return this.sceneNode.normalDivergenceBlendEnabled
  }

  set normalDivergenceBlendEnabled(value: boolean) {
    if (setProperty(this.sceneNode, 'normalDivergenceBlendEnabled', value)) {
      this.invalidateFrame('normalDivergenceBlendEnabled')
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
export class Glass extends SingleChildUiNode<LaymeoutNode, SceneGlass> {
  constructor(options: GlassOptions = {}) {
    super(createNoop(), new SceneGlass(options))
  }

  get cornerRadius(): number {
    return this.sceneNode.cornerRadius
  }

  set cornerRadius(value: number) {
    if (setProperty(this.sceneNode, 'cornerRadius', value)) {
      this.invalidateFrame('cornerRadius')
    }
  }

  get cornerTransitionSpeed(): number {
    return this.sceneNode.cornerTransitionSpeed
  }

  set cornerTransitionSpeed(value: number) {
    if (setProperty(this.sceneNode, 'cornerTransitionSpeed', value)) {
      this.invalidateFrame('cornerTransitionSpeed')
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
export class Html extends UiNode<LeafNode, SceneHtml> {
  private readonly defaultMeasureOptions: DomLeafOptions
  private readonly ownedElement: HTMLElement
  private defaultSubscribe: LeafSubscribe

  constructor(options: HtmlOptions = {}) {
    const ownedElement = document.createElement('div')
    const contentElement = options.element ?? ownedElement
    const sizing = options.sizing ?? 'constrained-width'
    syncOwnedHtmlElementSizing(ownedElement, sizing)
    const sceneNode = new SceneHtml({
      zIndex: options.zIndex,
      element: contentElement,
    })
    const defaultMeasureOptions: DomLeafOptions = {
      element: contentElement,
      sizing,
    }
    const defaultSubscribe: LeafSubscribe = (notify) =>
      subscribeDomElement(defaultMeasureOptions.element, notify)
    const layoutNode = domLeaf(defaultMeasureOptions)

    super(layoutNode, sceneNode)
    this.defaultMeasureOptions = defaultMeasureOptions
    this.defaultSubscribe = defaultSubscribe
    this.ownedElement = ownedElement
  }

  override add<T extends LayoutUiNode>(_child: T): T {
    throw new Error('Html is a leaf node and cannot accept children.')
  }

  /** DOM measurement sizing mode. */
  get sizing(): DomLeafSizing {
    return this.defaultMeasureOptions.sizing ?? 'constrained-width'
  }

  set sizing(value: DomLeafSizing | undefined) {
    const nextSizing = value ?? 'constrained-width'
    if (this.defaultMeasureOptions.sizing === nextSizing) {
      return
    }

    this.defaultMeasureOptions.sizing = nextSizing
    syncOwnedHtmlElementSizing(this.ownedElement, nextSizing)
    this.layoutNode.invalidateMeasure('sizing')
    this.invalidateLayout('sizing')
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
    if (this.defaultMeasureOptions.element === contentElement) {
      return
    }

    this.sceneNode.setElement(contentElement)
    if (contentElement === this.ownedElement) {
      syncOwnedHtmlElementSizing(this.ownedElement, this.sizing)
    }
    this.defaultMeasureOptions.element = contentElement
    this.defaultSubscribe = (notify) => subscribeDomElement(contentElement, notify)
    this.layoutNode.subscribe = this.defaultSubscribe
    this.layoutNode.invalidateMeasure('element')
    this.invalidateLayout('element')
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
    super(createSpacer(options), null)
  }

  override add<T extends LayoutUiNode>(_child: T): T {
    throw new Error('Spacer is a leaf node and cannot accept children.')
  }

  get minLength(): number {
    return this.layoutNode.minLength
  }

  set minLength(value: number) {
    if (setProperty(this.layoutNode, 'minLength', value)) {
      this.invalidateLayout('minLength')
    }
  }
}
