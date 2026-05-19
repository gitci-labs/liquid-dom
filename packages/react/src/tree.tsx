import {
  Children,
  createContext,
  useCallback,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Background as LayoutBackground,
  Frame as LayoutFrame,
  Glass as LayoutGlass,
  GlassContainer as LayoutGlassContainer,
  LayoutScene,
  Overlay as LayoutOverlay,
  Padding as LayoutPadding,
  Transform as LayoutTransform,
  type LayoutUiNode,
} from '@liquid-dom/core/layout'
import type {
  ChildRegistrar,
  ChildrenProp,
  LayoutParent,
  RegisteredChild,
  RootContextValue,
} from './types'

export const RootContext = createContext<RootContextValue | null>(null)
const ParentContext = createContext<ChildRegistrar | null>(null)
const ChildOrderContext = createContext(0)

function sameChildren(left: readonly LayoutUiNode[], right: readonly LayoutUiNode[]) {
  return left.length === right.length && left.every((node, index) => node === right[index])
}

function currentChildren(parent: LayoutParent): LayoutUiNode[] {
  if (parent instanceof LayoutScene) {
    return parent.root ? [parent.root] : []
  }

  return [...parent.children]
}

function acceptsSingleChild(parent: LayoutParent) {
  return (
    parent instanceof LayoutScene ||
    parent instanceof LayoutFrame ||
    parent instanceof LayoutPadding ||
    parent instanceof LayoutTransform ||
    parent instanceof LayoutGlassContainer ||
    parent instanceof LayoutGlass
  )
}

export function syncOrderedChildren(parent: LayoutParent, nextChildren: readonly LayoutUiNode[]) {
  if (acceptsSingleChild(parent) && nextChildren.length > 1) {
    throw new Error(`${parent.constructor.name} accepts exactly one child.`)
  }

  const previousChildren = currentChildren(parent)
  if (sameChildren(previousChildren, nextChildren)) {
    return
  }

  for (const child of previousChildren) {
    if (!nextChildren.includes(child)) {
      child.remove()
    }
  }

  for (const child of previousChildren) {
    if (nextChildren.includes(child)) {
      child.remove()
    }
  }

  for (const child of nextChildren) {
    parent.add(child)
  }
}

export function useOrderedChildRegistrar(
  syncChildren: (children: readonly LayoutUiNode[]) => void,
): ChildRegistrar {
  const entriesRef = useRef<RegisteredChild[]>([])
  const sequenceRef = useRef(0)
  const syncChildrenRef = useRef(syncChildren)
  syncChildrenRef.current = syncChildren

  return useMemo(() => {
    const sync = () => {
      const children = [...entriesRef.current]
        .sort((left, right) => left.order - right.order || left.sequence - right.sequence)
        .map((entry) => entry.node)
      syncChildrenRef.current(children)
    }

    return {
      registerChild(node, order) {
        const entry = {
          node,
          order,
          sequence: sequenceRef.current,
        }
        sequenceRef.current += 1
        entriesRef.current.push(entry)
        sync()

        return () => {
          entriesRef.current = entriesRef.current.filter((candidate) => candidate !== entry)
          node.remove()
          sync()
        }
      },
    }
  }, [])
}

function OrderedChildren({ children }: ChildrenProp) {
  return Children.map(children, (child, index) => (
    <ChildOrderContext.Provider value={index}>
      {child}
    </ChildOrderContext.Provider>
  ))
}

export function useRequiredRoot() {
  const root = useContext(RootContext)
  if (!root) {
    throw new Error('@liquid-dom/react components must be rendered inside LiquidCanvas or LiquidScene.')
  }
  return root
}

function useRequiredParent() {
  const parent = useContext(ParentContext)
  if (!parent) {
    throw new Error('Layout node components must be rendered inside a layout parent.')
  }
  return parent
}

export function useStableNode<T>(factory: () => T) {
  const ref = useRef<T | null>(null)
  if (!ref.current) {
    ref.current = factory()
  }
  return ref.current
}

export function useExposeRef<T>(ref: Ref<T> | undefined, value: T) {
  useImperativeHandle(ref, () => value, [value])
}

export function useAttachNode(node: LayoutUiNode) {
  const parent = useRequiredParent()
  const order = useContext(ChildOrderContext)

  useLayoutEffect(() => parent.registerChild(node, order), [node, order, parent])
}

export function useNodeParent(node: LayoutUiNode) {
  return useOrderedChildRegistrar(
    useCallback((children) => syncOrderedChildren(node, children), [node]),
  )
}

export function renderNodeChildren(parent: ChildRegistrar, children: ReactNode) {
  return (
    <ParentContext.Provider value={parent}>
      <OrderedChildren>{children}</OrderedChildren>
    </ParentContext.Provider>
  )
}

function syncDecorationSlot(
  node: LayoutOverlay | LayoutBackground,
  slot: 'content' | 'decoration',
  currentRef: MutableRefObject<LayoutUiNode | null>,
  children: readonly LayoutUiNode[],
) {
  if (children.length > 1) {
    throw new Error(`${node.constructor.name} ${slot} slot accepts exactly one child.`)
  }

  const next = children[0] ?? null
  if (currentRef.current === next) {
    return
  }

  currentRef.current?.remove()
  currentRef.current = next
  if (!next) {
    return
  }

  if (slot === 'content') {
    node.setContent(next)
  } else {
    node.setDecoration(next)
  }
}

export function useDecorationSlotRegistrar(node: LayoutOverlay | LayoutBackground, slot: 'content' | 'decoration') {
  const currentRef = useRef<LayoutUiNode | null>(null)
  return useOrderedChildRegistrar(
    useCallback((children) => syncDecorationSlot(node, slot, currentRef, children), [node, slot]),
  )
}
