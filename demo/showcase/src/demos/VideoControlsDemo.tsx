import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidCanvas,
  spring,
  Transform,
  ZStack,
} from '@liquid-dom/react'
import { FakeVideo, type FakeVideoHandle } from './FakeVideo'
import styles from './VideoControlsDemo.module.css'

const SIDE_BUTTON_SIZE = 58
const PLAY_BUTTON_SIZE = 78
const SIDE_BUTTON_OFFSET = 92
const SIDE_BUTTON_APPEAR_DELAY = 120
const CONTROLS_DISAPPEAR_DELAY = 500
const BUTTON_HOVER_SCALE = 1.1
const BUTTON_PRESS_SCALE = 0.94
const CONTROL_TRANSITION = spring({ stiffness: 150, damping: 16 })
const CONTROL_FADE_TRANSITION = spring({ stiffness: 260, damping: 35 })
const BUTTON_SCALE_TRANSITION = spring({ stiffness: 700, damping: 38 })
const CONTROL_VISIBLE_IOR = 1.5

export default function VideoControlsDemo() {
  const videoRef = useRef<FakeVideoHandle | null>(null)
  const controlTimeoutsRef = useRef<number[]>([])
  const [hovered, setHovered] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [sideButtonsVisible, setSideButtonsVisible] = useState(false)
  const [paused, setPaused] = useState(true)

  function clearControlTimers() {
    for (const timeout of controlTimeoutsRef.current) {
      window.clearTimeout(timeout)
    }
    controlTimeoutsRef.current = []
  }

  function setControlTimeout(callback: () => void, delay: number) {
    const timeout = window.setTimeout(() => {
      controlTimeoutsRef.current = controlTimeoutsRef.current.filter((entry) => entry !== timeout)
      callback()
    }, delay)
    controlTimeoutsRef.current.push(timeout)
  }

  function setVideoHover(nextHovered: boolean) {
    setHovered(nextHovered)
  }

  function togglePlayback() {
    const video = videoRef.current
    if (!video) {
      return
    }

    if (video.paused) {
      void video.play().catch(() => setPaused(true))
    } else {
      video.pause()
    }
  }

  function seekBy(seconds: number) {
    const video = videoRef.current
    if (!video) {
      return
    }

    const duration = Number.isFinite(video.duration) ? video.duration : Infinity
    video.currentTime = clamp(video.currentTime + seconds, 0, duration)
  }

  useEffect(() => {
    clearControlTimers()

    if (hovered || paused) {
      setControlsVisible(true)
      if (hovered) {
        setControlTimeout(() => setSideButtonsVisible(true), SIDE_BUTTON_APPEAR_DELAY)
      } else {
        setSideButtonsVisible(false)
      }
      return undefined
    }

    setSideButtonsVisible(false)
    setControlTimeout(() => setControlsVisible(false), CONTROLS_DISAPPEAR_DELAY)
    return undefined
  }, [hovered, paused])

  useEffect(() => clearControlTimers, [])

  const playButtonInteractive = hovered || paused
  const sideButtonInteractive = hovered && sideButtonsVisible

  return (
    <section
      className={styles.root}
      onPointerEnter={() => setVideoHover(true)}
      onPointerLeave={() => setVideoHover(false)}
    >
      <LiquidCanvas
        className={styles.canvasShell}
        canvasClassName={styles.canvas}
      >
        <ZStack alignment="center">
          <Html zIndex={-2} sizing="fill">
            <FakeVideo
              ref={videoRef}
              className={styles.video}
              onPause={() => setPaused(true)}
              onPlay={() => setPaused(false)}
            />
          </Html>

          <Frame maxWidth={Infinity} maxHeight={Infinity}>
            <GlassContainer
              opacity={controlsVisible ? 1 : 0}
              ior={controlsVisible ? CONTROL_VISIBLE_IOR : 1}
              blur={4}
              spacing={24}
              bezelWidth={30}
              tint={{ r: 0, g: 0, b: 0, a: 0.25 }}
              shadowColor={{ r: 0, g: 0, b: 0, a: 0.22 }}
              shadowOffsetY={8}
              shadowBlur={22}
              specularOpacity={0.54}
              transition={{ opacity: CONTROL_FADE_TRANSITION, ior: CONTROL_FADE_TRANSITION }}
              thickness={30}
            >
              <ZStack alignment="center">
                <ControlButton
                  label="Rewind 10 seconds"
                  size={SIDE_BUTTON_SIZE}
                  x={sideButtonsVisible ? -SIDE_BUTTON_OFFSET : 0}
                  visible={sideButtonInteractive}
                  contentVisible={sideButtonsVisible}
                  contentBlur
                  onClick={() => seekBy(-10)}
                >
                  <SkipIcon direction="back" />
                </ControlButton>

                <ControlButton
                  label="Forward 10 seconds"
                  size={SIDE_BUTTON_SIZE}
                  x={sideButtonsVisible ? SIDE_BUTTON_OFFSET : 0}
                  visible={sideButtonInteractive}
                  contentVisible={sideButtonsVisible}
                  contentBlur
                  onClick={() => seekBy(10)}
                >
                  <SkipIcon direction="forward" />
                </ControlButton>

                <ControlButton
                  label={paused ? 'Play' : 'Pause'}
                  size={PLAY_BUTTON_SIZE}
                  visible={playButtonInteractive}
                  contentVisible={controlsVisible}
                  onClick={togglePlayback}
                >
                  <PlayPauseIcon paused={paused} />
                </ControlButton>
              </ZStack>
            </GlassContainer>
          </Frame>
        </ZStack>
      </LiquidCanvas>
    </section>
  )
}

function ControlButton({
  children,
  label,
  onClick,
  size,
  visible,
  contentVisible,
  contentBlur = false,
  x = 0,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  size: number
  visible: boolean
  contentVisible: boolean
  contentBlur?: boolean
  x?: number
}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const scale = pressed ? BUTTON_PRESS_SCALE : hovered ? BUTTON_HOVER_SCALE : 1

  useEffect(() => {
    if (!visible) {
      setHovered(false)
      setPressed(false)
    }
  }, [visible])

  return (
    <Transform
      x={x}
      scaleX={scale}
      scaleY={scale}
      origin={{ x: 0.5, y: 0.5 }}
      transition={{
        x: CONTROL_TRANSITION,
        scaleX: BUTTON_SCALE_TRANSITION,
        scaleY: BUTTON_SCALE_TRANSITION,
      }}
    >
      <Frame width={size} height={size}>
        <Glass
          cornerRadius={size / 2}
          pointerEvents={visible}
          onClick={onClick}
          onHover={setHovered}
          onPress={setPressed}
        >
          <Html sizing="fill">
            <div
              className={styles.iconContent}
              aria-label={label}
              data-visible={contentVisible}
              data-blur={contentBlur}
            >
              {children}
            </div>
          </Html>
        </Glass>
      </Frame>
    </Transform>
  )
}

function PlayPauseIcon({ paused }: { paused: boolean }) {
  if (!paused) {
    return (
      <svg className={styles.playIcon} viewBox="0 0 32 32" aria-hidden="true">
        <rect x="9" y="7" width="5" height="18" rx="1.5" fill="currentColor" />
        <rect x="18" y="7" width="5" height="18" rx="1.5" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg className={styles.playIcon} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11 7.8v16.4c0 1.1 1.2 1.8 2.2 1.2l12.4-8.2c0.9-0.6 0.9-1.9 0-2.5L13.2 6.5C12.2 5.9 11 6.6 11 7.8Z" fill="currentColor" />
    </svg>
  )
}

function SkipIcon({ direction }: { direction: 'back' | 'forward' }) {
  const path = direction === 'back'
    ? 'M28 54.402c13.055 0 23.906-10.828 23.906-23.906c0-11.531-8.437-21.305-19.383-23.46v-3.33c0-1.664-1.148-2.11-2.437-1.195l-7.477 5.226c-1.054.75-1.078 1.875 0 2.649l7.453 5.25c1.313.937 2.461.492 2.461-1.196v-3.35c8.86 2.015 15.375 9.914 15.375 19.406A19.84 19.84 0 0 1 28 50.418c-11.063 0-19.945-8.86-19.922-19.922c.023-6.656 3.258-12.539 8.25-16.101c.961-.727 1.266-1.829.656-2.813c-.562-.96-1.851-1.219-2.883-.422C8.055 15.543 4.094 22.621 4.094 30.496c0 13.078 10.828 23.906 23.906 23.906m5.648-14.039c3.891 0 6.446-3.68 6.446-9.304c0-5.672-2.555-9.399-6.446-9.399s-6.445 3.727-6.445 9.399c0 5.625 2.555 9.304 6.445 9.304m-12.21-.281c.913 0 1.5-.633 1.5-1.617V23.723c0-1.149-.61-1.875-1.665-1.875c-.633 0-1.078.21-1.922.773l-3.257 2.18c-.516.375-.774.797-.774 1.36c0 .773.61 1.429 1.36 1.429c.445 0 .656-.094 1.125-.422l2.18-1.594v12.89c0 .962.585 1.618 1.452 1.618m12.21-2.555c-2.062 0-3.398-2.46-3.398-6.468c0-4.079 1.312-6.563 3.398-6.563c2.11 0 3.375 2.461 3.375 6.563c0 4.007-1.289 6.468-3.375 6.468'
    : 'M28 54.402c13.055 0 23.906-10.828 23.906-23.906c0-7.875-3.984-14.953-10.008-19.336c-1.03-.797-2.32-.539-2.906.422c-.586.984-.281 2.086.656 2.813c4.993 3.562 8.25 9.445 8.274 16.101C47.945 41.56 39.039 50.418 28 50.418c-11.063 0-19.899-8.86-19.899-19.922c0-9.492 6.516-17.39 15.376-19.406v3.375c0 1.664 1.148 2.11 2.413 1.195l7.5-5.25c1.055-.726 1.079-1.851 0-2.625l-7.476-5.25c-1.29-.937-2.437-.492-2.437 1.196v3.304C12.507 9.168 4.094 18.965 4.094 30.496c0 13.078 10.828 23.906 23.906 23.906m5.672-14.039c3.89 0 6.422-3.68 6.422-9.304c0-5.672-2.532-9.399-6.422-9.399s-6.445 3.727-6.445 9.399c0 5.625 2.554 9.304 6.445 9.304m-12.235-.281c.914 0 1.524-.633 1.524-1.617V23.723c0-1.149-.633-1.875-1.688-1.875c-.633 0-1.054.21-1.922.773l-3.234 2.18c-.539.375-.773.797-.773 1.36c0 .773.609 1.429 1.359 1.429c.422 0 .656-.094 1.125-.422l2.18-1.594v12.89c0 .962.562 1.618 1.43 1.618m12.235-2.555c-2.086 0-3.399-2.46-3.399-6.468c0-4.079 1.29-6.563 3.399-6.563c2.086 0 3.351 2.461 3.351 6.563c0 4.007-1.289 6.468-3.351 6.468'

  return (
    <svg
      className={styles.skipIcon}
      viewBox="0 0 56 56"
      aria-hidden="true"
    >
      <path fill="currentColor" d={path} />
    </svg>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
