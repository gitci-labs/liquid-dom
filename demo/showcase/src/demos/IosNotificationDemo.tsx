import { useEffect, useRef, useState, type RefObject } from 'react'
import { useDrag } from '@use-gesture/react'
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidCanvas,
  spring,
  Transform,
  useAnimate,
  useFrame,
  useInvalidateFrame,
  useRenderer,
  ZStack,
  type AnimationControls,
  type GlassProps,
  type TransformRef,
} from '@liquid-dom/react'
import abstractShapesUrl from '../assets/Abstract Shapes.jpg'
import styles from './IosNotificationDemo.module.css'

const NOTIFICATION_WIDTH = 616
const NOTIFICATION_HEIGHT = 112
const ACTION_WIDTH = 134
const ACTION_HEIGHT = 112
const ACTION_GAP = 18
const OPTIONS_X = NOTIFICATION_WIDTH / 2 - ACTION_WIDTH * 1.5 - ACTION_GAP
const CLEAR_X = OPTIONS_X + ACTION_WIDTH + ACTION_GAP
const OPEN_OFFSET = OPTIONS_X - ACTION_WIDTH / 2 - ACTION_GAP - NOTIFICATION_WIDTH / 2
const NOTIFICATION_CORNER_RADIUS = 48
const ACTION_HOVER_SCALE = 1.035
const ACTION_PRESS_SCALE = 0.96
const ACTION_LABEL_FADE_OUT_FRACTION = 0.4
const ACTION_SCALE_TRANSITION = spring({ stiffness: 520, damping: 42 })
const NOTIFICATION_OFFSET_TRANSITION = spring({ stiffness: 520, damping: 44 })
const NOTIFICATION_RUBBERBAND = 0.18
const NOTIFICATION_ORIGIN = {
  x: 0.5,
  y: 0.5,
}

type GlassDragBind = Pick<GlassProps, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getActionOpacity(actionX: number, notificationOffset: number) {
  const notificationRightEdge = notificationOffset + NOTIFICATION_WIDTH / 2
  const actionLeftEdge = actionX - ACTION_WIDTH / 2
  const disappearedFraction = clamp((notificationRightEdge - actionLeftEdge) / ACTION_WIDTH, 0, 1)

  return clamp(1 - disappearedFraction / ACTION_LABEL_FADE_OUT_FRACTION, 0, 1)
}

export default function IosNotificationDemo() {
  const [nightMode, setNightMode] = useState(false)

  return (
    <section className={styles.root}>
      <LiquidCanvas
        className={styles.canvasShell}
        canvasClassName={styles.canvas}
      >
        <NotificationScene nightMode={nightMode} />
      </LiquidCanvas>

      <button
        aria-pressed={nightMode}
        className={`${styles.nightModeToggle} ${nightMode ? styles.nightModeToggleActive : ''}`}
        type="button"
        onClick={() => setNightMode((enabled) => !enabled)}
      >
        <span className={styles.nightModeCheckbox} aria-hidden="true" />
        Night mode
      </button>
    </section>
  )
}

function NotificationScene({ nightMode }: { nightMode: boolean }) {
  const renderer = useRenderer()
  const invalidateFrame = useInvalidateFrame()
  const animate = useAnimate()
  const notificationTransformRef = useRef<TransformRef | null>(null)
  const optionsLabelRef = useRef<HTMLDivElement | null>(null)
  const clearLabelRef = useRef<HTMLDivElement | null>(null)
  const offsetRef = useRef(0)
  const draggingRef = useRef(false)
  const notificationHoveredRef = useRef(false)
  const offsetAnimationRef = useRef<AnimationControls | null>(null)
  const offsetAnimatingRef = useRef(false)

  function updateActionLabels(notificationOffset: number) {
    if (optionsLabelRef.current) {
      optionsLabelRef.current.style.opacity = String(getActionOpacity(OPTIONS_X, notificationOffset))
    }
    if (clearLabelRef.current) {
      clearLabelRef.current.style.opacity = String(getActionOpacity(CLEAR_X, notificationOffset))
    }
  }

  function setNotificationOffset(notificationOffset: number) {
    offsetRef.current = notificationOffset

    if (notificationTransformRef.current) {
      notificationTransformRef.current.x = notificationOffset
    }

    updateActionLabels(notificationOffset)
    invalidateFrame()
  }

  function cancelOffsetAnimation() {
    offsetAnimationRef.current?.stop()
    offsetAnimationRef.current = null
    offsetAnimatingRef.current = false

    if (notificationTransformRef.current) {
      offsetRef.current = notificationTransformRef.current.x
      updateActionLabels(notificationTransformRef.current.x)
    }
  }

  function animateNotificationOffset(targetOffset: number) {
    cancelOffsetAnimation()

    const notificationTransform = notificationTransformRef.current
    if (!notificationTransform) {
      setNotificationOffset(targetOffset)
      return
    }

    offsetAnimatingRef.current = true
    const controls = animate(notificationTransform, { x: targetOffset }, NOTIFICATION_OFFSET_TRANSITION)
    offsetAnimationRef.current = controls

    void controls.finished.then(() => {
      if (offsetAnimationRef.current !== controls) {
        return
      }

      offsetAnimationRef.current = null
      offsetAnimatingRef.current = false
      setNotificationOffset(notificationTransform.x)
    })
  }

  useFrame(() => {
    if (!offsetAnimatingRef.current || !notificationTransformRef.current) {
      return
    }

    const animatedOffset = notificationTransformRef.current.x
    offsetRef.current = animatedOffset
    updateActionLabels(animatedOffset)
  })

  useEffect(() => {
    setNotificationOffset(offsetRef.current)
    return cancelOffsetAnimation
  }, [])

  function setCanvasCursor(cursorClass: string | null) {
    const canvas = renderer.canvas
    canvas.classList.remove(styles.canvasGrab, styles.canvasGrabbing)

    if (cursorClass) {
      canvas.classList.add(cursorClass)
    }
  }

  function handlePointerEnter() {
    notificationHoveredRef.current = true

    if (draggingRef.current) {
      return
    }

    setCanvasCursor(styles.canvasGrab)
  }

  function handlePointerLeave() {
    notificationHoveredRef.current = false

    if (draggingRef.current) {
      return
    }

    setCanvasCursor(null)
  }

  const bind = useDrag(({
    active,
    first,
    last,
    offset: [notificationOffset],
  }) => {
    if (first) {
      cancelOffsetAnimation()
      draggingRef.current = true
      setCanvasCursor(styles.canvasGrabbing)
    }

    if (last || !active) {
      const boundedOffset = clamp(notificationOffset, OPEN_OFFSET, 0)
      draggingRef.current = false
      setCanvasCursor(notificationHoveredRef.current ? styles.canvasGrab : null)
      animateNotificationOffset(boundedOffset < OPEN_OFFSET * 0.42 ? OPEN_OFFSET : 0)
      return
    }

    setNotificationOffset(notificationOffset)
  }, {
    bounds: { left: OPEN_OFFSET, right: 0 },
    from: () => [offsetRef.current, 0],
    preventDefault: true,
    rubberband: [NOTIFICATION_RUBBERBAND, 0],
    pointer: {
      capture: false,
      keys: false,
    },
  }) as () => GlassDragBind

  return (
    <ZStack alignment="center">
      <Html zIndex={-2} sizing="fill">
        <div className={`${styles.backdrop} ${nightMode ? styles.backdropNight : ''}`}>
          <img
            alt=""
            className={styles.backgroundImage}
            src={abstractShapesUrl}
          />
        </div>
      </Html>

      <Frame maxWidth={Infinity} maxHeight={Infinity}>
        <GlassContainer
          blendSupportGating={false}
          blur={12}
          spacing={10}
          bezelWidth={18}
          tint={ nightMode ? { r: 0.7, g: 0.7, b: 0.7, a: 0.22 } : { r: 0.82, g: 0.92, b: 0.95, a: 0.22 }}
          shadowColor={{ r: 0, g: 0, b: 0, a: 0.2 }}
          shadowOffsetY={7}
          shadowBlur={21}
          specularOpacity={0.6}
        >
          <ZStack alignment="center">
            <Transform x={OPTIONS_X} origin={{ x: 0.5, y: 0.5 }}>
              <ActionGlass label="Options" labelRef={optionsLabelRef} />
            </Transform>

            <Transform x={CLEAR_X} origin={{ x: 0.5, y: 0.5 }}>
              <ActionGlass label="Clear" labelRef={clearLabelRef} />
            </Transform>

            <Transform
              ref={notificationTransformRef}
              x={0}
              origin={NOTIFICATION_ORIGIN}
            >
              <Glass
                cornerRadius={NOTIFICATION_CORNER_RADIUS}
                pointerEvents
                {...bind()}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
              >
                <Frame width={NOTIFICATION_WIDTH} height={NOTIFICATION_HEIGHT}>
                  <Html sizing="fill">
                    <NotificationContent />
                  </Html>
                </Frame>
              </Glass>
            </Transform>
          </ZStack>
        </GlassContainer>
      </Frame>
    </ZStack>
  )
}

function ActionGlass({
  label,
  labelRef,
}: {
  label: string
  labelRef: RefObject<HTMLDivElement | null>
}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const actionScale = pressed ? ACTION_PRESS_SCALE : hovered ? ACTION_HOVER_SCALE : 1

  return (
    <Transform
      origin={{ x: 0.5, y: 0.5 }}
      scaleX={actionScale}
      scaleY={actionScale}
      transition={{
        scaleX: ACTION_SCALE_TRANSITION,
        scaleY: ACTION_SCALE_TRANSITION,
      }}
    >
      <Glass
        cornerRadius={NOTIFICATION_CORNER_RADIUS}
        pointerEvents
        onHover={setHovered}
        onPress={setPressed}
      >
        <Frame width={ACTION_WIDTH} height={ACTION_HEIGHT}>
          <Html sizing="fill">
            <div
              ref={labelRef}
              className={styles.actionLabel}
            >
              {label}
            </div>
          </Html>
        </Frame>  
      </Glass>
    </Transform>
  )
}

function NotificationContent() {
  return (
    <div className={styles.content}>
      <div className={styles.avatar}>
        JA
      </div>

      <div className={styles.copy}>
        <div className={styles.heading}>
          <strong>John Appleseed</strong>
          <span>27m ago</span>
        </div>
        <p className={styles.message}>
          My orchard just shipped a critical bug fix. The apples now fall closer to the tree.
        </p>
      </div>
    </div>
  )
}
