export type ProposedSize = {
  width?: number
  height?: number
}

export type Size = {
  width: number
  height: number
}

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type NodeLayout = {
  rect: Rect
}

export type Axis = 'horizontal' | 'vertical'
export type StackAlignment = 'start' | 'center' | 'end' | 'leading' | 'trailing' | 'top' | 'bottom'
export type Alignment =
  | 'center'
  | 'top'
  | 'bottom'
  | 'leading'
  | 'trailing'
  | 'topLeading'
  | 'topTrailing'
  | 'bottomLeading'
  | 'bottomTrailing'
  | { x?: 'start' | 'center' | 'end'; y?: 'start' | 'center' | 'end' }

export type Length = number | 'infinity'

export type Insets = {
  top: number
  right: number
  bottom: number
  left: number
}

export type InsetsInput =
  | number
  | Partial<Insets>
  | {
      horizontal?: number
      vertical?: number
    }

export type ChildInput =
  | LayoutNode
  | readonly (LayoutNode | null | false | undefined)[]
  | null
  | false
  | undefined

export interface LayoutNode {
  readonly __liquidDomLayout: true
  readonly id: string
  readonly kind: string
  readonly parent: LayoutNode | null
  readonly children: readonly LayoutNode[]
  readonly layout: NodeLayout | undefined
  isLayoutActive: () => boolean
  append: (...children: ChildInput[]) => this
  prepend: (...children: ChildInput[]) => this
  insertBefore: (child: ChildInput, before: LayoutNode) => this
  replaceChildren: (...children: ChildInput[]) => this
  remove: () => void
  dispose: () => void
}

export type StackNode = LayoutNode & {
  spacing: number
  alignment: StackAlignment
}

export type ZStackNode = LayoutNode & {
  alignment: Alignment
}

export type FrameNode = LayoutNode & {
  width: number | undefined
  height: number | undefined
  minWidth: number | undefined
  minHeight: number | undefined
  idealWidth: number | undefined
  idealHeight: number | undefined
  maxWidth: Length | undefined
  maxHeight: Length | undefined
  alignment: Alignment
}

export type PaddingNode = LayoutNode & {
  insets: InsetsInput
}

export type NoopNode = LayoutNode

export type DecorationNode = LayoutNode & {
  alignment: Alignment
}

export type SpacerNode = LayoutNode & {
  minLength: number
}

export type LeafNode = LayoutNode & {
  measureKey: unknown
  invalidateMeasure: (cause?: unknown) => void
}

export type LayoutDebugStats = {
  measureCalls: number
  cacheHits: number
  cacheMisses: number
  invalidations: number
  nodes: number
}

export type LayoutInvalidationKind = 'measure' | 'placement' | 'structure'

export type LayoutInvalidation = {
  id: string
  node: LayoutNode
  kind: LayoutInvalidationKind
  cause?: unknown
}

export type LayoutChild = {
  node: LayoutNode
  id: string
  kind: string
  isSpacer: boolean
  measure: (proposal: ProposedSize) => Size
  place: (bounds: Rect, proposal?: ProposedSize) => void
}

export type LayoutMeasureInput = {
  proposal: ProposedSize
  children: LayoutChild[]
  node: LayoutNode
}

export type LayoutPlaceInput = {
  bounds: Rect
  proposal: ProposedSize
  children: LayoutChild[]
  node: LayoutNode
}

export type LayoutEngineOptions = {
  root?: LayoutNode
  onInvalidate?: (invalidation: LayoutInvalidation) => void
  dev?: boolean
  /**
   * Maximum measurement entries kept by the engine. Set to 0 to disable
   * measurement caching entirely.
   */
  maxCachedMeasurements?: number
}
