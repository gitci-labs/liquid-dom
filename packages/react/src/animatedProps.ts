import { useLayoutEffect, useRef } from 'react'
import type { ComponentTransition } from './animation'
import { resolveTransition } from './animation'
import { useAnimationTimeScaleRef } from './animationConfig'
import { useRequiredRoot } from './tree'

type PropValues = Record<string, unknown>

type AnimatedPropsOptions = {
  assignUndefined?: boolean
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => sameValue(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    ))
  )
}

function assignProperty(target: object, property: string, value: unknown) {
  const writableTarget = target as Record<string, unknown>
  writableTarget[property] = value
}

/**
 * Synchronizes React props into a node, animating properties with a
 * matching declarative transition and assigning all other values immediately.
 */
export function useAnimatedProps<Target extends object, Values extends PropValues>(
  target: Target,
  values: Values,
  transition: ComponentTransition<Values> | undefined,
  options: AnimatedPropsOptions = {},
) {
  const root = useRequiredRoot()
  const timeScaleRef = useAnimationTimeScaleRef()
  const mountedRef = useRef(false)
  const previousRef = useRef<PropValues | null>(null)
  const assignUndefined = options.assignUndefined ?? true

  useLayoutEffect(() => {
    const previous = previousRef.current
    previousRef.current = values
    let assignedImmediately = false

    for (const [property, value] of Object.entries(values)) {
      if (value === undefined && !assignUndefined) {
        continue
      }
      if (previous && sameValue(previous[property], value)) {
        continue
      }

      const transitionConfig = mountedRef.current
        ? resolveTransition(transition, property)
        : undefined

      if (transitionConfig) {
        root.animationManager.animate(
          target,
          { [property]: value } as Partial<Target>,
          transitionConfig,
          { timeScaleRef },
        )
        root.invalidateFrame()
      } else {
        root.animationManager.stop(target, [property])
        assignProperty(target, property, value)
        assignedImmediately = true
      }
    }

    if (assignedImmediately) {
      root.invalidateFrame()
    }

    mountedRef.current = true
  })

  useLayoutEffect(() => () => {
    root.animationManager.stop(target)
  }, [root, target])
}
