type NumericObject = {
  [key: string]: number | NumericObject
}

type AnimationChannel = {
  current: number
  origin: number
  target: number
  velocity: number
}

type NormalizedSpringTransition = Required<SpringTransition>
type NormalizedEasingTransition = Required<EasingTransition>
type NormalizedTransition = NormalizedSpringTransition | NormalizedEasingTransition

type AnimationValue =
  | {
      kind: 'number'
      channel: AnimationChannel
    }
  | {
      kind: 'object'
      template: NumericObject
      channels: Map<string, AnimationChannel>
    }

type PropertyAnimation = {
  target: object
  property: string
  value: AnimationValue
  config: NormalizedTransition
  elapsed: number
  timeScaleRef?: AnimationTimeScaleRef
  listeners: Set<() => void>
}

type TimelineStep =
  | {
      kind: 'to'
      target: object
      values: Record<string, unknown>
      transition?: AnimationConfig
    }
  | {
      kind: 'call'
      callback: () => void
    }

/** Spring transition parameters used by declarative and imperative animations. */
export type SpringTransition = {
  type: 'spring'
  stiffness?: number
  damping?: number
  mass?: number
  velocity?: number
  restSpeed?: number
  restDelta?: number
}

export type EasingFunction = (t: number) => number

export type EasingTransition = {
  type: 'easing'
  duration?: number
  ease?: EasingFunction
}

/** Animation transition config accepted by React props and imperative animation calls. */
export type AnimationConfig = SpringTransition | EasingTransition | true | false | null | undefined

export type AnimationTimeScaleRef = {
  current: number
}

type AnimationOptions = {
  timeScaleRef?: AnimationTimeScaleRef
}

/** Per-property declarative transition map for a component. */
export type TransitionMap<T extends object = Record<string, unknown>> = Partial<
  Record<Extract<keyof T, string>, AnimationConfig>
> & {
  default?: AnimationConfig
}

/** Declarative transition prop accepted by React layout components. */
export type ComponentTransition<T extends object = Record<string, unknown>> =
  | AnimationConfig
  | TransitionMap<T>

/** Imperative animation handle. */
export type AnimationControls = {
  readonly finished: Promise<void>
  stop: () => void
}

/** Imperative animation function returned by {@link import('./canvas').useAnimate}. */
export type AnimateFunction = <Target extends object>(
  target: Target | null | undefined,
  values: Partial<Target>,
  transition?: AnimationConfig,
) => AnimationControls

function defaultSpring(): Required<SpringTransition> {
  return {
    type: 'spring',
    stiffness: 300,
    damping: 30,
    mass: 1,
    velocity: 0,
    restSpeed: 0.01,
    restDelta: 0.01,
  }
}

function clamp01(value: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1)
}

function cubicBezierCoordinate(t: number, p1: number, p2: number) {
  const invT = 1 - t
  return 3 * invT * invT * t * p1 + 3 * invT * t * t * p2 + t * t * t
}

function cubicBezierDerivative(t: number, p1: number, p2: number) {
  const invT = 1 - t
  return 3 * invT * invT * p1 + 6 * invT * t * (p2 - p1) + 3 * t * t * (1 - p2)
}

export const Easing = {
  linear: (t: number) => t,
  easeIn: (t: number) => t * t,
  easeOut: (t: number) => 1 - (1 - t) * (1 - t),
  easeInOut: (t: number) => (
    t < 0.5
      ? 2 * t * t
      : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2
  ),
  bezier: (x1: number, y1: number, x2: number, y2: number): EasingFunction => {
    const cx1 = clamp01(x1)
    const cx2 = clamp01(x2)

    return (progress: number) => {
      const x = clamp01(progress)
      if (x === 0 || x === 1) {
        return x
      }

      let t = x
      let solved = false
      for (let index = 0; index < 8; index += 1) {
        const currentX = cubicBezierCoordinate(t, cx1, cx2) - x
        const derivative = cubicBezierDerivative(t, cx1, cx2)
        if (Math.abs(currentX) < 1e-6) {
          solved = true
          break
        }
        if (Math.abs(derivative) < 1e-6) {
          break
        }

        const nextT = t - currentX / derivative
        if (nextT < 0 || nextT > 1) {
          break
        }
        t = nextT
      }

      if (!solved) {
        let lower = 0
        let upper = 1
        t = x
        for (let index = 0; index < 16; index += 1) {
          const currentX = cubicBezierCoordinate(t, cx1, cx2)
          if (Math.abs(currentX - x) < 1e-6) {
            break
          }
          if (currentX < x) {
            lower = t
          } else {
            upper = t
          }
          t = (lower + upper) / 2
        }
      }

      return cubicBezierCoordinate(t, y1, y2)
    }
  },
} as const

function defaultEasing(): Required<EasingTransition> {
  return {
    type: 'easing',
    duration: 0.25,
    ease: Easing.easeInOut,
  }
}

/** Creates a spring transition config. */
export function spring(options: Omit<SpringTransition, 'type'> = {}): SpringTransition {
  return {
    type: 'spring',
    ...options,
  }
}

export function easing(options: Omit<EasingTransition, 'type'> = {}): EasingTransition {
  return {
    type: 'easing',
    ...options,
  }
}

function normalizeTransition(config: AnimationConfig): NormalizedTransition | null {
  if (!config) {
    return null
  }

  if (config === true) {
    return defaultSpring()
  }

  if (isEasingTransition(config)) {
    return {
      ...defaultEasing(),
      ...config,
      type: 'easing',
    }
  }

  return {
    ...defaultSpring(),
    ...config,
    type: 'spring',
  }
}

function isSpringTransition(value: unknown): value is SpringTransition | true {
  return value === true || (
    value !== null &&
    typeof value === 'object' &&
    (
      (value as { type?: unknown }).type === 'spring' ||
      'stiffness' in value ||
      'damping' in value ||
      'mass' in value ||
      'velocity' in value ||
      'restSpeed' in value ||
      'restDelta' in value
    )
  )
}

function isEasingTransition(value: unknown): value is EasingTransition {
  return (
    value !== null &&
    typeof value === 'object' &&
    (
      (value as { type?: unknown }).type === 'easing' ||
      'duration' in value ||
      'ease' in value
    )
  )
}

function isAnimationTransition(value: unknown): value is SpringTransition | EasingTransition | true {
  return value === true || isSpringTransition(value) || isEasingTransition(value)
}

/** Resolves the transition config that applies to one property. */
export function resolveTransition(
  transition: ComponentTransition | undefined,
  property: string,
): AnimationConfig {
  if (transition === undefined || transition === null || transition === false) {
    return transition
  }

  if (isAnimationTransition(transition)) {
    return transition
  }

  return transition[property] ?? transition.default
}

function isPlainObject(value: unknown): value is NumericObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneNumericObject(value: NumericObject): NumericObject {
  const clone: NumericObject = {}
  for (const [key, child] of Object.entries(value)) {
    clone[key] = typeof child === 'number' ? child : cloneNumericObject(child)
  }
  return clone
}

function flattenNumericObject(
  value: NumericObject,
  prefix = '',
  output = new Map<string, number>(),
): Map<string, number> | null {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'number') {
      output.set(path, child)
    } else if (isPlainObject(child)) {
      if (!flattenNumericObject(child, path, output)) {
        return null
      }
    } else {
      return null
    }
  }

  return output
}

function setPath(target: NumericObject, path: string, value: number) {
  const parts = path.split('.')
  let current = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current[parts[index]] as NumericObject
  }
  current[parts[parts.length - 1]] = value
}

function resolveInitialVelocity(current: number, target: number, configuredVelocity: number) {
  if (configuredVelocity === 0 || current === target) {
    return 0
  }

  return Math.abs(configuredVelocity) * Math.sign(target - current)
}

function buildAnimationValue(from: unknown, to: unknown, initialVelocity: number): AnimationValue | null {
  if (typeof from === 'number' && typeof to === 'number') {
    return {
      kind: 'number',
      channel: {
        current: from,
        origin: from,
        target: to,
        velocity: resolveInitialVelocity(from, to, initialVelocity),
      },
    }
  }

  if (!isPlainObject(from) || !isPlainObject(to)) {
    return null
  }

  const fromValues = flattenNumericObject(from)
  const toValues = flattenNumericObject(to)
  if (!fromValues || !toValues || fromValues.size === 0 || fromValues.size !== toValues.size) {
    return null
  }

  const channels = new Map<string, AnimationChannel>()
  for (const [path, target] of toValues) {
    const current = fromValues.get(path)
    if (current === undefined) {
      return null
    }
    channels.set(path, {
      current,
      origin: current,
      target,
      velocity: resolveInitialVelocity(current, target, initialVelocity),
    })
  }

  return {
    kind: 'object',
    template: cloneNumericObject(to),
    channels,
  }
}

function retargetAnimationValue(
  value: AnimationValue,
  to: unknown,
  initialVelocity: number,
  resetOrigin: boolean,
) {
  if (value.kind === 'number') {
    if (typeof to !== 'number') {
      return false
    }

    value.channel.target = to
    if (resetOrigin) {
      value.channel.origin = value.channel.current
      value.channel.velocity = 0
    } else if (initialVelocity !== 0) {
      value.channel.velocity = resolveInitialVelocity(value.channel.current, to, initialVelocity)
    }
    return true
  }

  if (!isPlainObject(to)) {
    return false
  }

  const toValues = flattenNumericObject(to)
  if (!toValues || toValues.size !== value.channels.size) {
    return false
  }

  for (const [path, channel] of value.channels) {
    const target = toValues.get(path)
    if (target === undefined) {
      return false
    }
    channel.target = target
    if (resetOrigin) {
      channel.origin = channel.current
      channel.velocity = 0
    } else if (initialVelocity !== 0) {
      channel.velocity = resolveInitialVelocity(channel.current, target, initialVelocity)
    }
  }
  value.template = cloneNumericObject(to)
  return true
}

function materializeValue(value: AnimationValue): unknown {
  if (value.kind === 'number') {
    return value.channel.current
  }

  const output = cloneNumericObject(value.template)
  for (const [path, channel] of value.channels) {
    setPath(output, path, channel.current)
  }
  return output
}

function getChannels(value: AnimationValue): AnimationChannel[] {
  return value.kind === 'number' ? [value.channel] : [...value.channels.values()]
}

function isSettled(channel: AnimationChannel, config: Required<SpringTransition>) {
  return (
    Math.abs(channel.velocity) <= config.restSpeed &&
    Math.abs(channel.target - channel.current) <= config.restDelta
  )
}

function stepChannel(channel: AnimationChannel, config: Required<SpringTransition>, deltaSeconds: number) {
  const displacement = channel.current - channel.target
  const springForce = -config.stiffness * displacement
  const dampingForce = -config.damping * channel.velocity
  const acceleration = (springForce + dampingForce) / config.mass
  channel.velocity += acceleration * deltaSeconds
  channel.current += channel.velocity * deltaSeconds

  if (isSettled(channel, config)) {
    channel.current = channel.target
    channel.velocity = 0
  }
}

function stepEasingChannel(channel: AnimationChannel, easedProgress: number) {
  channel.current = channel.origin + (channel.target - channel.origin) * easedProgress
}

function assignProperty(target: object, property: string, value: unknown) {
  const writableTarget = target as Record<string, unknown>
  writableTarget[property] = value
}

function resolveFinished() {
  return Promise.resolve()
}

function resolveTimeScale(timeScaleRef: AnimationTimeScaleRef | undefined) {
  const timeScale = timeScaleRef?.current ?? 1
  return Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1
}

/**
 * Retained animation scheduler ticked by LayoutCanvas' RAF loop.
 */
export class AnimationManager {
  private readonly animations = new Set<PropertyAnimation>()
  private readonly animationsByTarget = new WeakMap<object, Map<string, PropertyAnimation>>()

  /** Whether any animations are currently active. */
  get active(): boolean {
    return this.animations.size > 0
  }

  /** Starts or retargets animations for the provided properties. */
  animate<Target extends object>(
    target: Target | null | undefined,
    values: Partial<Target>,
    transition: AnimationConfig = true,
    options: AnimationOptions = {},
  ): AnimationControls {
    const config = normalizeTransition(transition)
    if (!target || !config) {
      return {
        finished: resolveFinished(),
        stop: () => undefined,
      }
    }

    let remaining = 0
    let resolve: () => void = () => undefined
    const finished = new Promise<void>((done) => {
      resolve = done
    })
    const cleanups: (() => void)[] = []

    for (const [property, nextValue] of Object.entries(values)) {
      const currentValue = (target as Record<string, unknown>)[property]
      const targetAnimations = this.getTargetAnimations(target)
      const existing = targetAnimations.get(property)

      if (config.type === 'easing' && config.duration <= 0) {
        existing && this.finishAnimation(existing, false)
        assignProperty(target, property, nextValue)
        continue
      }

      const initialVelocity = config.type === 'spring' ? config.velocity : 0
      if (existing && retargetAnimationValue(
        existing.value,
        nextValue,
        initialVelocity,
        config.type === 'easing',
      )) {
        existing.config = config
        existing.elapsed = 0
        existing.timeScaleRef = options.timeScaleRef
        remaining += 1
        const listener = () => {
          remaining -= 1
          if (remaining === 0) {
            resolve()
          }
        }
        existing.listeners.add(listener)
        cleanups.push(() => existing.listeners.delete(listener))
        continue
      }

      existing && this.finishAnimation(existing, false)
      const value = buildAnimationValue(currentValue, nextValue, initialVelocity)
      if (!value) {
        assignProperty(target, property, nextValue)
        continue
      }

      const animation: PropertyAnimation = {
        target,
        property,
        value,
        config,
        elapsed: 0,
        timeScaleRef: options.timeScaleRef,
        listeners: new Set(),
      }
      remaining += 1
      const listener = () => {
        remaining -= 1
        if (remaining === 0) {
          resolve()
        }
      }
      animation.listeners.add(listener)
      cleanups.push(() => animation.listeners.delete(listener))
      this.animations.add(animation)
      targetAnimations.set(property, animation)
    }

    if (remaining === 0) {
      resolve()
    }

    return {
      finished,
      stop: () => {
        for (const cleanup of cleanups) {
          cleanup()
        }
        for (const [property] of Object.entries(values)) {
          const animation = this.animationsByTarget.get(target)?.get(property)
          if (animation) {
            this.finishAnimation(animation, false)
          }
        }
        resolve()
      },
    }
  }

  /** Stops all animations for a target, or only the listed properties. */
  stop(target: object, properties?: readonly string[]) {
    const targetAnimations = this.animationsByTarget.get(target)
    if (!targetAnimations) {
      return
    }

    const keys = properties ?? [...targetAnimations.keys()]
    for (const property of keys) {
      const animation = targetAnimations.get(property)
      if (animation) {
        this.finishAnimation(animation, false)
      }
    }
  }

  /** Advances active animations by one RAF delta. */
  tick(deltaMilliseconds: number): boolean {
    if (this.animations.size === 0) {
      return false
    }

    const frameDeltaSeconds = Math.max(0, deltaMilliseconds / 1000)

    for (const animation of [...this.animations]) {
      const deltaSeconds = frameDeltaSeconds * resolveTimeScale(animation.timeScaleRef)
      const springDeltaSeconds = Math.min(0.064, deltaSeconds)
      const stepCount = Math.max(1, Math.ceil(springDeltaSeconds / (1 / 60)))
      const stepSeconds = springDeltaSeconds / stepCount
      let complete = false

      if (animation.config.type === 'spring') {
        const springConfig = animation.config
        for (let step = 0; step < stepCount; step += 1) {
          for (const channel of getChannels(animation.value)) {
            stepChannel(channel, springConfig, stepSeconds)
          }
        }

        complete = getChannels(animation.value).every((channel) => isSettled(channel, springConfig))
      } else {
        animation.elapsed += deltaSeconds
        const progress = clamp01(animation.elapsed / animation.config.duration)
        const easedProgress = animation.config.ease(progress)

        for (const channel of getChannels(animation.value)) {
          stepEasingChannel(channel, easedProgress)
        }

        complete = progress >= 1
      }

      assignProperty(animation.target, animation.property, materializeValue(animation.value))
      if (complete) {
        this.finishAnimation(animation, true)
      }
    }

    return true
  }

  private getTargetAnimations(target: object) {
    const existing = this.animationsByTarget.get(target)
    if (existing) {
      return existing
    }

    const animations = new Map<string, PropertyAnimation>()
    this.animationsByTarget.set(target, animations)
    return animations
  }

  private finishAnimation(animation: PropertyAnimation, snapToTarget: boolean) {
    if (snapToTarget) {
      for (const channel of getChannels(animation.value)) {
        channel.current = channel.target
        channel.origin = channel.target
        channel.velocity = 0
      }
      assignProperty(animation.target, animation.property, materializeValue(animation.value))
    }

    this.animations.delete(animation)
    this.animationsByTarget.get(animation.target)?.delete(animation.property)
    for (const listener of [...animation.listeners]) {
      listener()
    }
    animation.listeners.clear()
  }
}

/**
 * Imperative sequence builder for animations that should run one after another.
 */
export class AnimationTimeline {
  private readonly steps: TimelineStep[] = []
  private currentControls: AnimationControls | null = null
  private stopped = false

  constructor(
    private readonly manager: AnimationManager,
    private readonly requestFrame: () => void,
    private readonly defaultTransition: AnimationConfig = true,
    private readonly timeScaleRef?: AnimationTimeScaleRef,
  ) {}

  /** Adds an animation step to the sequence. */
  to<Target extends object>(
    target: Target | null | undefined,
    values: Partial<Target>,
    transition?: AnimationConfig,
  ): this {
    if (target) {
      this.steps.push({
        kind: 'to',
        target,
        values: values as Record<string, unknown>,
        transition,
      })
    }
    return this
  }

  /** Adds a synchronous callback step to the sequence. */
  call(callback: () => void): this {
    this.steps.push({ kind: 'call', callback })
    return this
  }

  /** Starts the sequence. */
  play(): AnimationControls {
    this.stopped = false
    const finished = this.run()
    return {
      finished,
      stop: () => this.stop(),
    }
  }

  /** Stops the currently running step. */
  stop() {
    this.stopped = true
    this.currentControls?.stop()
    this.currentControls = null
  }

  private async run() {
    for (const step of this.steps) {
      if (this.stopped) {
        return
      }

      if (step.kind === 'call') {
        step.callback()
        continue
      }

      this.currentControls = this.manager.animate(
        step.target,
        step.values,
        step.transition ?? this.defaultTransition,
        { timeScaleRef: this.timeScaleRef },
      )
      this.requestFrame()
      await this.currentControls.finished
      this.currentControls = null
    }
  }
}
