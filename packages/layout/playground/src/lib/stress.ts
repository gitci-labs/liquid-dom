import { Frame, HStack, Leaf, Padding, VStack, ZStack } from '@liquid-dom/layout'
import type {
  FrameNode,
  LayoutNode,
  PaddingNode,
  StackNode,
  ZStackNode,
} from '@liquid-dom/layout'
import {
  clampFloat,
  clampNumber,
  lerp,
  stressTone,
  wave,
} from './visual'
import type { VisualBox } from './visual'

export type StressConfig = {
  elements: number
  groupSize: number
  depth: number
  drawCap: number
  motion: number
  useCache: boolean
  animateFrame: boolean
}

export type StressGroupController = {
  depth: number
  sourceIndex: number
  layout: StackNode | ZStackNode
} & (
  | {
      wrapper: PaddingNode
      wrapperKind: 'padding'
    }
  | {
      wrapper: FrameNode
      wrapperKind: 'frame'
    }
)

export type StressTreeState = {
  root: LayoutNode
  rootFrame: FrameNode
  structuralKey: string
  groups: StressGroupController[]
  boxes: VisualBox[]
}

export function defaultStressConfig(): StressConfig {
  return {
    elements: 360,
    groupSize: 6,
    depth: 5,
    drawCap: 360,
    motion: 0.35,
    useCache: true,
    animateFrame: false,
  }
}

export function normalizeStressConfig(config: StressConfig): StressConfig {
  return {
    elements: clampNumber(config.elements, 25, 5000),
    groupSize: clampNumber(config.groupSize, 2, 16),
    depth: clampNumber(config.depth, 2, 8),
    drawCap: clampNumber(config.drawCap, 0, 1500),
    motion: clampFloat(config.motion, 0, 1),
    useCache: config.useCache,
    animateFrame: config.animateFrame,
  }
}

export function stressStructuralKey(config: StressConfig): string {
  return [config.elements, config.groupSize, config.depth].join(':')
}

export function buildStressTree(config: StressConfig): StressTreeState {
  const groups: StressGroupController[] = []
  const boxes: VisualBox[] = []
  const leaves = Array.from({ length: config.elements }, (_, index) => {
    const box = stressLeaf(index, 0)
    boxes.push(box)
    return box.node
  })
  let level: LayoutNode[] = leaves
  let depth = 0

  while (level.length > 1 && depth < config.depth) {
    const nextLevel: LayoutNode[] = []
    for (let index = 0; index < level.length; index += config.groupSize) {
      const group = level.slice(index, index + config.groupSize)
      const groupKey = `stress-${depth}-${Math.floor(index / config.groupSize)}`
      const node =
        depth % 3 === 0
          ? new HStack({ spacing: 0, alignment: 'center' }).append(group)
          : depth % 3 === 1
            ? new VStack({ spacing: 0, alignment: 'leading' }).append(group)
            : new ZStack({ alignment: 'topLeading' }).append(group)

      boxes.push(stressGroupBox(node, groupKey, depth))

      let grouped: LayoutNode
      if (depth % 2 === 0) {
        const wrapper = new Padding({ insets: 2 }).append(node)
        groups.push({ depth, sourceIndex: index, layout: node, wrapper, wrapperKind: 'padding' })
        grouped = wrapper
      } else {
        const wrapper = new Frame({
          maxWidth: 'infinity',
          alignment: 'topLeading',
        }).append(node)
        groups.push({ depth, sourceIndex: index, layout: node, wrapper, wrapperKind: 'frame' })
        grouped = wrapper
      }

      nextLevel.push(grouped)
    }
    level = nextLevel
    depth += 1
  }

  const root = level[0] ?? stressLeaf(0, 0).node
  const rootFrame = new Frame({
    width: 1180,
    maxHeight: 'infinity',
    alignment: 'topLeading',
  }).append(new Padding({ horizontal: 18, vertical: 16 }).append(root))
  const state = {
    root: rootFrame,
    rootFrame,
    structuralKey: stressStructuralKey(config),
    groups,
    boxes,
  }
  updateStressTree(state, config, 0)
  return state
}

export function updateStressTree(state: StressTreeState, config: StressConfig, phase: number) {
  state.rootFrame.alignment = wave(phase + 0.08) > 0.5 ? 'topLeading' : 'center'

  for (const group of state.groups) {
    const depthFactor = group.depth * 0.17
    const indexFactor = group.sourceIndex * 0.0015
    const motion = config.motion

    if ('spacing' in group.layout) {
      group.layout.spacing = lerp(5, 14 + group.depth * 2, wave(phase + depthFactor + indexFactor)) * motion
    } else {
      group.layout.alignment = wave(phase + group.sourceIndex * 0.01) > 0.5 ? 'topLeading' : 'bottomTrailing'
    }

    if (group.wrapperKind === 'padding') {
      group.wrapper.insets = lerp(2, 8 + group.depth, wave(phase + group.sourceIndex * 0.001)) * motion
    } else {
      group.wrapper.alignment = wave(phase + group.depth * 0.2) > 0.5 ? 'topLeading' : 'center'
    }
  }
}

function stressGroupBox(node: LayoutNode, key: string, depth: number): VisualBox {
  return {
    node,
    id: key,
    label: depth % 3 === 0 ? 'HStack' : depth % 3 === 1 ? 'VStack' : 'ZStack',
    tone: stressTone(depth),
    role: 'group',
  }
}

class StressLeaf extends Leaf {
  constructor(
    private readonly index: number,
    private readonly band: number,
  ) {
    super({ measureKey: `stress-leaf:${index}:${band}` })
  }

  protected override measureLeaf() {
    return {
      width: 44 + (this.index % 4) * 10,
      height: 30 + (this.index % 3) * 6 + this.band,
    }
  }
}

function stressLeaf(index: number, depth: number): VisualBox {
  const band = Math.floor(index / 24) % 4
  const node = new StressLeaf(index, band)
  return {
    node,
    id: `stress-${index}`,
    label: `${band + 1}.${(index % 24) + 1}`,
    tone: stressTone(band + depth),
    role: 'leaf',
  }
}
