import { Layout } from './node'
import type {
  Alignment,
  Axis,
  DecorationNode,
  FrameNode,
  Insets,
  InsetsInput,
  LayoutChild,
  LayoutMeasureInput,
  LayoutPlaceInput,
  LeafNode,
  Length,
  NoopNode,
  PaddingNode,
  ProposedSize,
  Rect,
  Size,
  SpacerNode,
  StackAlignment,
  StackNode,
  ZStackNode,
} from './types'
import {
  addInsets,
  alignRect,
  clampSize,
  crossAxisOffset,
  insetRect,
  normalizeInsets,
  normalizeLength,
  sanitizeProposal,
  sanitizeSize,
  sizeToProposal,
  stableSerialize,
  subtractInsets,
} from './utils'

export type StackOptions = {
  spacing?: number
  alignment?: StackAlignment
}

export type ZStackOptions = {
  alignment?: Alignment
}

export type FrameOptions = {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  idealWidth?: number
  idealHeight?: number
  maxWidth?: Length
  maxHeight?: Length
  alignment?: Alignment
}

export type PaddingOptions = {
  insets?: InsetsInput
}

export type DecorationOptions = {
  alignment?: Alignment
}

export type SpacerOptions = {
  minLength?: number
}

export type LeafOptions = {
  measureKey?: unknown
}

export abstract class Leaf extends Layout implements LeafNode {
  private _measureKey: unknown

  constructor(options: LeafOptions = {}) {
    super('leaf')
    this._measureKey = options.measureKey
  }

  get measureKey(): unknown {
    return this._measureKey
  }

  set measureKey(value: unknown) {
    if (Object.is(this._measureKey, value)) return
    this._measureKey = value
    this.markMeasureDirty('measureKey')
  }

  override measureSelf(input: LayoutMeasureInput): Size {
    return sanitizeSize(this.measureLeaf(input.proposal))
  }

  override getMeasureKey(): unknown {
    return this._measureKey
  }

  invalidateMeasure(cause?: unknown) {
    this.markMeasureDirty(cause)
  }

  protected abstract measureLeaf(proposal: ProposedSize): Size
}

export class Spacer extends Layout implements SpacerNode {
  private _minLength: number

  constructor(options: SpacerOptions = {}) {
    super('spacer', { isSpacer: true })
    this._minLength = options.minLength ?? 0
  }

  get minLength(): number {
    return this._minLength
  }

  set minLength(value: number) {
    const next = sanitizeLength(value)
    if (this._minLength === next) return
    this._minLength = next
    this.markMeasureDirty('minLength')
  }

  override measureSelf(): Size {
    return { width: this._minLength, height: this._minLength }
  }
}

abstract class StackLayout extends Layout implements StackNode {
  private readonly axis: Axis
  private _spacing: number
  private _alignment: StackAlignment

  constructor(axis: Axis, options: StackOptions = {}) {
    super(axis === 'horizontal' ? 'hstack' : 'vstack')
    this.axis = axis
    this._spacing = options.spacing ?? 0
    this._alignment = options.alignment ?? 'center'
  }

  get spacing(): number {
    return this._spacing
  }

  set spacing(value: number) {
    const next = sanitizeLength(value)
    if (this._spacing === next) return
    this._spacing = next
    this.markMeasureDirty('spacing')
  }

  get alignment(): StackAlignment {
    return this._alignment
  }

  set alignment(value: StackAlignment) {
    if (this._alignment === value) return
    this._alignment = value
    this.markPlacementDirty('alignment')
  }

  override measureSelf(input: LayoutMeasureInput): Size {
    return measureStack(this.axis, input.proposal, input.children, {
      spacing: this._spacing,
      alignment: this._alignment,
    })
  }

  override placeChildren(input: LayoutPlaceInput): void {
    placeStack(this.axis, input.bounds, input.proposal, input.children, {
      spacing: this._spacing,
      alignment: this._alignment,
    })
  }
}

export class HStack extends StackLayout {
  constructor(options: StackOptions = {}) {
    super('horizontal', options)
  }
}

export class VStack extends StackLayout {
  constructor(options: StackOptions = {}) {
    super('vertical', options)
  }
}

export class ZStack extends Layout implements ZStackNode {
  private _alignment: Alignment

  constructor(options: ZStackOptions = {}) {
    super('zstack')
    this._alignment = options.alignment ?? 'center'
  }

  get alignment(): Alignment {
    return this._alignment
  }

  set alignment(value: Alignment) {
    if (stableSerialize(this._alignment) === stableSerialize(value)) return
    this._alignment = value
    this.markPlacementDirty('alignment')
  }

  override measureSelf(input: LayoutMeasureInput): Size {
    let width = 0
    let height = 0
    for (const child of input.children) {
      const childSize = child.measure(input.proposal)
      width = Math.max(width, childSize.width)
      height = Math.max(height, childSize.height)
    }
    return { width, height }
  }

  override placeChildren(input: LayoutPlaceInput): void {
    for (const child of input.children) {
      const childSize = child.measure(input.proposal)
      child.place(alignRect(childSize, input.bounds, this._alignment), sizeToProposal(childSize))
    }
  }
}

export class Frame extends Layout implements FrameNode {
  private _width: number | undefined
  private _height: number | undefined
  private _minWidth: number | undefined
  private _minHeight: number | undefined
  private _idealWidth: number | undefined
  private _idealHeight: number | undefined
  private _maxWidth: Length | undefined
  private _maxHeight: Length | undefined
  private _alignment: Alignment

  constructor(options: FrameOptions = {}) {
    super('frame')
    this._width = sanitizeOptionalLength(options.width)
    this._height = sanitizeOptionalLength(options.height)
    this._minWidth = sanitizeOptionalLength(options.minWidth)
    this._minHeight = sanitizeOptionalLength(options.minHeight)
    this._idealWidth = sanitizeOptionalLength(options.idealWidth)
    this._idealHeight = sanitizeOptionalLength(options.idealHeight)
    this._maxWidth = options.maxWidth
    this._maxHeight = options.maxHeight
    this._alignment = options.alignment ?? 'center'
  }

  get width(): number | undefined {
    return this._width
  }

  set width(value: number | undefined) {
    const next = sanitizeOptionalLength(value)
    if (Object.is(this._width, next)) return
    this._width = next
    this.markMeasureDirty('width')
  }

  get height(): number | undefined {
    return this._height
  }

  set height(value: number | undefined) {
    const next = sanitizeOptionalLength(value)
    if (Object.is(this._height, next)) return
    this._height = next
    this.markMeasureDirty('height')
  }

  get minWidth(): number | undefined {
    return this._minWidth
  }

  set minWidth(value: number | undefined) {
    const next = sanitizeOptionalLength(value)
    if (Object.is(this._minWidth, next)) return
    this._minWidth = next
    this.markMeasureDirty('minWidth')
  }

  get minHeight(): number | undefined {
    return this._minHeight
  }

  set minHeight(value: number | undefined) {
    const next = sanitizeOptionalLength(value)
    if (Object.is(this._minHeight, next)) return
    this._minHeight = next
    this.markMeasureDirty('minHeight')
  }

  get idealWidth(): number | undefined {
    return this._idealWidth
  }

  set idealWidth(value: number | undefined) {
    const next = sanitizeOptionalLength(value)
    if (Object.is(this._idealWidth, next)) return
    this._idealWidth = next
    this.markMeasureDirty('idealWidth')
  }

  get idealHeight(): number | undefined {
    return this._idealHeight
  }

  set idealHeight(value: number | undefined) {
    const next = sanitizeOptionalLength(value)
    if (Object.is(this._idealHeight, next)) return
    this._idealHeight = next
    this.markMeasureDirty('idealHeight')
  }

  get maxWidth(): Length | undefined {
    return this._maxWidth
  }

  set maxWidth(value: Length | undefined) {
    if (Object.is(this._maxWidth, value)) return
    this._maxWidth = value
    this.markMeasureDirty('maxWidth')
  }

  get maxHeight(): Length | undefined {
    return this._maxHeight
  }

  set maxHeight(value: Length | undefined) {
    if (Object.is(this._maxHeight, value)) return
    this._maxHeight = value
    this.markMeasureDirty('maxHeight')
  }

  get alignment(): Alignment {
    return this._alignment
  }

  set alignment(value: Alignment) {
    if (stableSerialize(this._alignment) === stableSerialize(value)) return
    this._alignment = value
    this.markPlacementDirty('alignment')
  }

  override measureSelf(input: LayoutMeasureInput): Size {
    const child = input.children[0]
    const props = this.runtimeProps()
    const childProposal = frameChildProposal(input.proposal, props)
    const childSize = child?.measure(childProposal) ?? emptyFrameChildSize(props)
    return frameReportedSize(childSize, input.proposal, props)
  }

  override placeChildren(input: LayoutPlaceInput): void {
    const child = input.children[0]
    if (!child) return
    const props = this.runtimeProps()
    const childProposal = frameChildProposal(input.proposal, props)
    const childSize = child.measure(childProposal)
    child.place(alignRect(childSize, input.bounds, props.alignment), sizeToProposal(childSize))
  }

  private runtimeProps(): FrameRuntimeProps {
    return {
      width: this._width,
      height: this._height,
      minWidth: this._minWidth,
      minHeight: this._minHeight,
      idealWidth: this._idealWidth,
      idealHeight: this._idealHeight,
      maxWidth: normalizeLength(this._maxWidth),
      maxHeight: normalizeLength(this._maxHeight),
      alignment: this._alignment,
    }
  }
}

export class Padding extends Layout implements PaddingNode {
  private _insets: Insets

  constructor(options: InsetsInput | PaddingOptions = 0) {
    super('padding')
    this._insets = normalizeInsets(parsePaddingOptions(options).insets)
  }

  get insets(): Insets {
    return this._insets
  }

  set insets(value: InsetsInput) {
    const next = normalizeInsets(value)
    if (stableSerialize(this._insets) === stableSerialize(next)) return
    this._insets = next
    this.markMeasureDirty('insets')
  }

  override measureSelf(input: LayoutMeasureInput): Size {
    const child = input.children[0]
    if (!child) return { width: 0, height: 0 }
    return addInsets(child.measure(subtractInsets(input.proposal, this._insets)), this._insets)
  }

  override placeChildren(input: LayoutPlaceInput): void {
    const child = input.children[0]
    if (!child) return
    child.place(insetRect(input.bounds, this._insets), subtractInsets(input.proposal, this._insets))
  }
}

export class Noop extends Layout implements NoopNode {
  constructor() {
    super('noop')
  }

  override measureSelf(input: LayoutMeasureInput): Size {
    return input.children[0]?.measure(input.proposal) ?? {
      width: input.proposal.width ?? 0,
      height: input.proposal.height ?? 0,
    }
  }

  override placeChildren(input: LayoutPlaceInput): void {
    input.children[0]?.place(input.bounds, input.proposal)
  }
}

abstract class DecorationLayout extends Layout implements DecorationNode {
  private _alignment: Alignment

  constructor(kind: 'background' | 'overlay', options: DecorationOptions = {}) {
    super(kind)
    this._alignment = options.alignment ?? 'center'
  }

  get alignment(): Alignment {
    return this._alignment
  }

  set alignment(value: Alignment) {
    if (stableSerialize(this._alignment) === stableSerialize(value)) return
    this._alignment = value
    this.markPlacementDirty('alignment')
  }

  override measureSelf(input: LayoutMeasureInput): Size {
    return input.children[0]?.measure(input.proposal) ?? { width: 0, height: 0 }
  }

  override placeChildren(input: LayoutPlaceInput): void {
    const contentChild = input.children[0]
    const decorationChild = input.children[1]
    if (!contentChild) return

    contentChild.place(input.bounds, sizeToProposal(input.bounds))
    if (!decorationChild) return

    const decorationProposal = { width: input.bounds.width, height: input.bounds.height }
    const decorationSize = decorationChild.measure(decorationProposal)
    decorationChild.place(alignRect(decorationSize, input.bounds, this._alignment), sizeToProposal(decorationSize))
  }
}

export class Background extends DecorationLayout {
  constructor(options: DecorationOptions = {}) {
    super('background', options)
  }
}

export class Overlay extends DecorationLayout {
  constructor(options: DecorationOptions = {}) {
    super('overlay', options)
  }
}

type StackRuntimeProps = {
  spacing: number
  alignment: StackAlignment
}

type FrameRuntimeProps = {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  idealWidth?: number
  idealHeight?: number
  maxWidth?: number
  maxHeight?: number
  alignment: Alignment
}

function measureStack(
  axis: Axis,
  proposal: ProposedSize,
  children: LayoutChild[],
  props: StackRuntimeProps,
): Size {
  const sizes = measureStackChildren(axis, proposal, children)
  const spacing = props.spacing * Math.max(0, children.length - 1)
  const main = sizes.reduce((sum, size) => sum + mainSize(axis, size), 0) + spacing
  const cross = sizes.reduce((max, size) => Math.max(max, crossSize(axis, size)), 0)

  if (axis === 'horizontal') {
    return {
      width: hasSpacer(children) && proposal.width !== undefined ? Math.max(main, proposal.width) : main,
      height: proposal.height !== undefined && hasSpacer(children) ? Math.max(cross, proposal.height) : cross,
    }
  }

  return {
    width: proposal.width !== undefined && hasSpacer(children) ? Math.max(cross, proposal.width) : cross,
    height: hasSpacer(children) && proposal.height !== undefined ? Math.max(main, proposal.height) : main,
  }
}

function placeStack(
  axis: Axis,
  bounds: Rect,
  proposal: ProposedSize,
  children: LayoutChild[],
  props: StackRuntimeProps,
): void {
  const sizes = measureStackChildren(axis, proposal, children)
  const spacing = props.spacing * Math.max(0, children.length - 1)
  const baseMain = sizes.reduce((sum, size) => sum + mainSize(axis, size), 0) + spacing
  const spacerCount = children.filter((child) => child.isSpacer).length
  const extra = spacerCount > 0 ? Math.max(0, mainSize(axis, bounds) - baseMain) / spacerCount : 0
  let cursor = axis === 'horizontal' ? bounds.x : bounds.y

  for (const [index, child] of children.entries()) {
    const measured = sizes[index]
    if (!measured) continue

    const size = child.isSpacer
      ? setMainSize(axis, measured, mainSize(axis, measured) + extra)
      : measured
    const childBounds = rectOnAxis(axis, bounds, cursor, size, props.alignment)
    child.place(childBounds, sizeToProposal(size))
    cursor += mainSize(axis, size) + props.spacing
  }
}

function measureStackChildren(
  axis: Axis,
  proposal: ProposedSize,
  children: LayoutChild[],
): Size[] {
  const childProposal =
    axis === 'horizontal'
      ? sanitizeProposal({ height: proposal.height })
      : sanitizeProposal({ width: proposal.width })

  return children.map((child) => child.measure(childProposal))
}

function frameChildProposal(proposal: ProposedSize, props: FrameRuntimeProps): ProposedSize {
  const next: ProposedSize = {}
  const widthProposal = props.width ?? props.idealWidth ?? clampProposal(proposal.width, props.minWidth, props.maxWidth)
  const heightProposal = props.height ?? props.idealHeight ?? clampProposal(proposal.height, props.minHeight, props.maxHeight)
  if (widthProposal !== undefined) next.width = widthProposal
  if (heightProposal !== undefined) next.height = heightProposal
  return sanitizeProposal(next)
}

function frameReportedSize(childSize: Size, proposal: ProposedSize, props: FrameRuntimeProps): Size {
  const width =
    props.width ??
    (props.maxWidth === Infinity && proposal.width !== undefined
      ? Math.max(childSize.width, proposal.width)
      : childSize.width)
  const height =
    props.height ??
    (props.maxHeight === Infinity && proposal.height !== undefined
      ? Math.max(childSize.height, proposal.height)
      : childSize.height)

  return clampSize(
    {
      width,
      height,
    },
    props.minWidth,
    props.minHeight,
    props.maxWidth,
    props.maxHeight,
  )
}

function emptyFrameChildSize(props: FrameRuntimeProps): Size {
  return {
    width: props.idealWidth ?? 0,
    height: props.idealHeight ?? 0,
  }
}

function clampProposal(value: number | undefined, min?: number, max?: number): number | undefined {
  if (value === undefined) return undefined
  let next = value
  if (min !== undefined) next = Math.max(min, next)
  if (max !== undefined && Number.isFinite(max)) next = Math.min(max, next)
  return next
}

function hasSpacer(children: LayoutChild[]) {
  return children.some((child) => child.isSpacer)
}

function mainSize(axis: Axis, value: Size | Rect) {
  return axis === 'horizontal' ? value.width : value.height
}

function crossSize(axis: Axis, value: Size | Rect) {
  return axis === 'horizontal' ? value.height : value.width
}

function setMainSize(axis: Axis, size: Size, value: number): Size {
  return axis === 'horizontal' ? { width: value, height: size.height } : { width: size.width, height: value }
}

function rectOnAxis(
  axis: Axis,
  bounds: Rect,
  cursor: number,
  size: Size,
  alignment: StackAlignment,
): Rect {
  if (axis === 'horizontal') {
    return {
      x: cursor,
      y: bounds.y + crossAxisOffset(bounds.height, size.height, alignment),
      width: size.width,
      height: size.height,
    }
  }

  return {
    x: bounds.x + crossAxisOffset(bounds.width, size.width, alignment),
    y: cursor,
    width: size.width,
    height: size.height,
  }
}

function parsePaddingOptions(input: InsetsInput | PaddingOptions | undefined): PaddingOptions {
  if (input && typeof input === 'object' && 'insets' in input) {
    return input as PaddingOptions
  }
  return { insets: input as InsetsInput | undefined }
}

function sanitizeLength(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function sanitizeOptionalLength(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return sanitizeLength(value)
}

export function propsSignature(value: unknown): string {
  return stableSerialize(value)
}
