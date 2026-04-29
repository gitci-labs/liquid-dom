import {
  background as createBackground,
  createLayoutEngine,
  frame as createFrame,
  hstack as createHStack,
  leaf as createLeaf,
  noop as createNoop,
  overlay as createOverlay,
  padding as createPadding,
  spacer as createSpacer,
  vstack as createVStack,
  zstack as createZStack,
} from 'laymeout'
import { domLeaf, type DomLeafSizing } from 'laymeout/dom'
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
  LayoutNode as LaymeoutNode,
  LeafMeasure,
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
import type { Point, RgbaColor, SurfaceProfile, Transform as SceneTransform } from './types'

type SceneNode = SceneContainer | SceneGlass | SceneGroup | SceneStackingContext | SceneHtml
type SceneParent = GlassScene | SceneNode
type UiParent = LayoutScene | UiNode
type FixedMeasureState = {
  width: number | undefined
  height: number | undefined
}

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

/** Constructor options for {@link GlassContainer}. */
export type GlassContainerOptions = Omit<ContainerInit, keyof SceneTransform>

/** Constructor options for {@link Glass}. */
export type GlassOptions = Omit<GlassInit, keyof SceneTransform | 'width' | 'height'>

/** Constructor options for {@link Html}. */
export type HtmlOptions = {
  /** Intrinsic layout width used by the fixed-size leaf mode. */
  width?: number
  /** Intrinsic layout height used by the fixed-size leaf mode. */
  height?: number
  /** Scene draw order among sibling scene or glass HTML nodes. */
  zIndex?: number
  /** DOM element hosted by the scene HTML node. */
  element?: HTMLElement | null
  /** Custom layout measurement callback. */
  measure?: LeafMeasure
  /** Optional custom measurement subscription. */
  subscribe?: LeafSubscribe
  /** Custom measure cache key passed through to the leaf layout node. */
  measureKey?: unknown
  /** Custom subscription identity passed through to the leaf layout node. */
  subscriptionKey?: unknown
  /** DOM measurement mode used when `element` is provided without a fixed size or custom measure. */
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

function makeFixedMeasure(state: FixedMeasureState): LeafMeasure {
  return (proposal) => ({
    width: state.width ?? proposal.width ?? 0,
    height: state.height ?? proposal.height ?? 0,
  })
}

function createHtmlLayoutNode(options: HtmlOptions, fixedMeasure: { current: FixedMeasureState | null }) {
  if (options.measure) {
    return createLeaf({
      measure: options.measure,
      subscribe: options.subscribe,
      measureKey: options.measureKey,
      subscriptionKey: options.subscriptionKey,
    })
  }

  if (options.element && options.width === undefined && options.height === undefined) {
    return domLeaf({
      element: options.element,
      sizing: options.sizing,
      measureKey: options.measureKey,
    })
  }

  fixedMeasure.current = {
    width: options.width,
    height: options.height,
  }

  return createLeaf({
    measure: makeFixedMeasure(fixedMeasure.current),
    measureKey: options.measureKey,
  })
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

  constructor(options: LayoutSceneOptions = {}) {
    const { root, ...engineOptions } = options
    this.engine = createLayoutEngine(engineOptions)
    if (root) {
      this.add(root)
    }
  }

  /** Current root UI node, if one is attached. */
  get root(): LayoutUiNode | null {
    return this._root
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
    super(createVStack(options), new SceneGroup())
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
    super(createZStack(options), new SceneStackingContext())
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
    super(createFrame(options), new SceneGroup())
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
    super(createPadding(options), new SceneGroup())
  }

  get insets(): InsetsInput {
    return this.layoutNode.insets
  }

  set insets(value: InsetsInput) {
    this.layoutNode.insets = value
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
    ;(this.layoutNode as unknown as { alignment: Alignment }).alignment = value
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
    this._x = value
    this.syncSceneTransform()
  }

  get y(): number {
    return this._y
  }

  set y(value: number) {
    this._y = value
    this.syncSceneTransform()
  }

  get scaleX(): number {
    return this._scaleX
  }

  set scaleX(value: number) {
    this._scaleX = value
    this.syncSceneTransform()
  }

  get scaleY(): number {
    return this._scaleY
  }

  set scaleY(value: number) {
    this._scaleY = value
    this.syncSceneTransform()
  }

  get rotation(): number {
    return this._rotation
  }

  set rotation(value: number) {
    this._rotation = value
    this.syncSceneTransform()
  }

  get origin(): Point {
    return this._origin
  }

  set origin(value: Point) {
    this._origin = clonePoint(value)
    this.syncSceneTransform()
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
    this.sceneNode.spacing = value
  }

  get blur(): number {
    return this.sceneNode.blur
  }

  set blur(value: number) {
    this.sceneNode.blur = value
  }

  get bezelWidth(): number {
    return this.sceneNode.bezelWidth
  }

  set bezelWidth(value: number) {
    this.sceneNode.bezelWidth = value
  }

  get thickness(): number {
    return this.sceneNode.thickness
  }

  set thickness(value: number) {
    this.sceneNode.thickness = value
  }

  get displacementFactor(): number {
    return this.sceneNode.displacementFactor
  }

  set displacementFactor(value: number) {
    this.sceneNode.displacementFactor = value
  }

  get ior(): number {
    return this.sceneNode.ior
  }

  set ior(value: number) {
    this.sceneNode.ior = value
  }

  get contentIor(): number {
    return this.sceneNode.contentIor
  }

  set contentIor(value: number) {
    this.sceneNode.contentIor = value
  }

  get contentDepth(): number {
    return this.sceneNode.contentDepth
  }

  set contentDepth(value: number) {
    this.sceneNode.contentDepth = value
  }

  get dispersion(): number {
    return this.sceneNode.dispersion
  }

  set dispersion(value: number) {
    this.sceneNode.dispersion = value
  }

  get surfaceProfile(): SurfaceProfile {
    return this.sceneNode.surfaceProfile
  }

  set surfaceProfile(value: SurfaceProfile) {
    this.sceneNode.surfaceProfile = value
  }

  get lightDirection(): number {
    return this.sceneNode.lightDirection
  }

  set lightDirection(value: number) {
    this.sceneNode.lightDirection = value
  }

  get specularStrength(): number {
    return this.sceneNode.specularStrength
  }

  set specularStrength(value: number) {
    this.sceneNode.specularStrength = value
  }

  get specularWidth(): number {
    return this.sceneNode.specularWidth
  }

  set specularWidth(value: number) {
    this.sceneNode.specularWidth = value
  }

  get specularFalloff(): number {
    return this.sceneNode.specularFalloff
  }

  set specularFalloff(value: number) {
    this.sceneNode.specularFalloff = value
  }

  get oppositeSpecularStrength(): number {
    return this.sceneNode.oppositeSpecularStrength
  }

  set oppositeSpecularStrength(value: number) {
    this.sceneNode.oppositeSpecularStrength = value
  }

  get specularSharpness(): number {
    return this.sceneNode.specularSharpness
  }

  set specularSharpness(value: number) {
    this.sceneNode.specularSharpness = value
  }

  get specularOpacity(): number {
    return this.sceneNode.specularOpacity
  }

  set specularOpacity(value: number) {
    this.sceneNode.specularOpacity = value
  }

  get reflectionOffset(): number {
    return this.sceneNode.reflectionOffset
  }

  set reflectionOffset(value: number) {
    this.sceneNode.reflectionOffset = value
  }

  get tint(): RgbaColor {
    return this.sceneNode.tint
  }

  set tint(value: RgbaColor) {
    this.sceneNode.tint = value
  }

  get zIndex(): number {
    return this.sceneNode.zIndex
  }

  set zIndex(value: number) {
    this.sceneNode.zIndex = value
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
    this.sceneNode.cornerRadius = value
  }

  get cornerTransitionSpeed(): number {
    return this.sceneNode.cornerTransitionSpeed
  }

  set cornerTransitionSpeed(value: number) {
    this.sceneNode.cornerTransitionSpeed = value
  }

  get pointerEvents(): boolean {
    return this.sceneNode.pointerEvents
  }

  set pointerEvents(value: boolean) {
    this.sceneNode.pointerEvents = value
  }

  get zIndex(): number {
    return this.sceneNode.zIndex
  }

  set zIndex(value: number) {
    this.sceneNode.zIndex = value
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
  private fixedMeasure: FixedMeasureState | null

  constructor(options: HtmlOptions = {}) {
    const fixedMeasure = { current: null as FixedMeasureState | null }
    const layoutNode = createHtmlLayoutNode(options, fixedMeasure)
    super(layoutNode, new SceneHtml({
      zIndex: options.zIndex,
      element: options.element,
      width: options.width,
      height: options.height,
    }))
    this.fixedMeasure = fixedMeasure.current
  }

  override add<T extends LayoutUiNode>(_child: T): T {
    throw new Error('Html is a leaf node and cannot accept children.')
  }

  get width(): number | undefined {
    return this.fixedMeasure?.width
  }

  set width(value: number | undefined) {
    this.ensureFixedMeasure().width = value
    this.layoutNode.invalidateMeasure('width')
  }

  get height(): number | undefined {
    return this.fixedMeasure?.height
  }

  set height(value: number | undefined) {
    this.ensureFixedMeasure().height = value
    this.layoutNode.invalidateMeasure('height')
  }

  get zIndex(): number {
    return this.sceneNode.zIndex
  }

  set zIndex(value: number) {
    this.sceneNode.zIndex = value
  }

  get element(): HTMLElement | null {
    return this.sceneNode.element
  }

  set element(value: HTMLElement | null) {
    this.setElement(value)
  }

  /** Replaces the hosted DOM element. */
  setElement(element: HTMLElement | null) {
    this.sceneNode.setElement(element)
    this.layoutNode.invalidateMeasure('element')
  }

  protected override applyLayoutRect(rect: Rect) {
    resetLayoutTransform(this.sceneNode, rect)
    this.sceneNode.width = rect.width
    this.sceneNode.height = rect.height
  }

  private ensureFixedMeasure(): FixedMeasureState {
    if (!this.fixedMeasure) {
      this.fixedMeasure = {
        width: undefined,
        height: undefined,
      }
      this.layoutNode.measure = makeFixedMeasure(this.fixedMeasure)
    }

    return this.fixedMeasure
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
    this.layoutNode.minLength = value
  }
}
