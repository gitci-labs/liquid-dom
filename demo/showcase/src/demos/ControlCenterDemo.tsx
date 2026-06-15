import {
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import {
  type AnimateFunction,
  type AnimationControls,
  Frame,
  Glass,
  GlassContainer,
  type GlassContainerRef,
  HStack,
  Html,
  LiquidCanvas,
  spring,
  useAnimate,
  ZStack,
} from '@liquid-dom/react'
import {
  Bluetooth,
  Plane,
  Play,
  Podcast,
  Radio,
  RotateCcw,
  RotateCw,
  Wifi,
} from 'lucide-react'
import albumArtUrl from '../assets/always-sunny.jpg'
import backgroundUrl from '../assets/narrow-background.jpg'
import styles from './ControlCenterDemo.module.css'

const CARD_SIZE = 248
const CARD_RADIUS = 75
const DEFAULT_LIGHT_DIRECTION = -Math.PI / 6
const LIGHT_RESET_TRANSITION = spring({
  stiffness: 180,
  damping: 24,
  restDelta: 0.001,
})

export default function ControlCenterDemo() {
  const glassContainerRef = useRef<GlassContainerRef | null>(null)
  const animateRef = useRef<AnimateFunction | null>(null)
  const lightHandlers = useMouseLightDirection(glassContainerRef, animateRef)

  return (
    <section className={styles.root} {...lightHandlers}>
      <LiquidCanvas
        className={styles.canvasShell}
        canvasClassName={styles.canvas}
      >
        <LightAnimationBinder animateRef={animateRef} />
        <ZStack alignment="center">
          <Html zIndex={-2} sizing="fill">
            <div className={styles.backdrop}>
              <img
                alt=""
                className={styles.backgroundImage}
                src={backgroundUrl}
              />
            </div>
          </Html>

          <Frame
            maxWidth={Infinity}
            maxHeight={Infinity}
          >
            <GlassContainer
              ref={glassContainerRef}
              blendSupportGating={false}
              lightDirection={DEFAULT_LIGHT_DIRECTION}
              bezelWidth={44}
              tint={{ r: 1, g: 1, b: 1, a: 0.12 }}
              shadowColor={{ r: 0, g: 0, b: 0, a: 0.1 }}
              shadowOffsetY={14}
              shadowBlur={30}
              specularOpacity={0.7}
              specularFalloff={1}
              specularWidth={1}
              specularStrength={1}
              specularSharpness={3}
              oppositeSpecularStrength={0.5}
            >
              <HStack spacing={27}>
                <ControlCard>
                  <ConnectivityCard />
                </ControlCard>
                <ControlCard>
                  <MediaCard />
                </ControlCard>
              </HStack>
            </GlassContainer>
          </Frame>
        </ZStack>
      </LiquidCanvas>
    </section>
  )
}

function useMouseLightDirection(
  glassContainerRef: MutableRefObject<GlassContainerRef | null>,
  animateRef: MutableRefObject<AnimateFunction | null>,
) {
  const lightDirectionRef = useRef(DEFAULT_LIGHT_DIRECTION)
  const lightResetAnimationRef = useRef<AnimationControls | null>(null)

  const setLightDirection = useCallback((lightDirection: number) => {
    lightDirectionRef.current = lightDirection

    if (glassContainerRef.current) {
      glassContainerRef.current.lightDirection = lightDirection
    }
  }, [glassContainerRef])

  const stopLightResetAnimation = useCallback(() => {
    lightResetAnimationRef.current?.stop()
    lightResetAnimationRef.current = null
  }, [])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    stopLightResetAnimation()

    const { left, width } = event.currentTarget.getBoundingClientRect()
    const progress = Math.min(1, Math.max(0, (event.clientX - left) / width))
    const lightDirection = progress * Math.PI - Math.PI / 2

    setLightDirection(lightDirection)
  }, [setLightDirection, stopLightResetAnimation])

  const handlePointerLeave = useCallback(() => {
    stopLightResetAnimation()

    const animate = animateRef.current
    const glassContainer = glassContainerRef.current
    if (!animate || !glassContainer) {
      setLightDirection(DEFAULT_LIGHT_DIRECTION)
      return
    }

    const controls = animate(
      glassContainer,
      { lightDirection: DEFAULT_LIGHT_DIRECTION },
      LIGHT_RESET_TRANSITION,
    )
    lightResetAnimationRef.current = controls

    void controls.finished.then(() => {
      if (lightResetAnimationRef.current !== controls) {
        return
      }

      lightResetAnimationRef.current = null
      lightDirectionRef.current = glassContainer.lightDirection
    })
  }, [animateRef, glassContainerRef, setLightDirection, stopLightResetAnimation])

  useEffect(() => () => {
    lightResetAnimationRef.current?.stop()
  }, [])

  return {
    onPointerMove: handlePointerMove,
    onPointerLeave: handlePointerLeave,
  }
}

function LightAnimationBinder({
  animateRef,
}: {
  animateRef: MutableRefObject<AnimateFunction | null>
}) {
  const animate = useAnimate()

  useEffect(() => {
    animateRef.current = animate

    return () => {
      if (animateRef.current === animate) {
        animateRef.current = null
      }
    }
  }, [animate, animateRef])

  return null
}

function ControlCard({ children }: { children: ReactNode }) {
  return (
    <Glass cornerRadius={CARD_RADIUS}>
      <Frame width={CARD_SIZE} height={CARD_SIZE}>
        <Html sizing="fill">
          <div className={styles.cardContent}>{children}</div>
        </Html>
      </Frame>
    </Glass>
  )
}

function ConnectivityCard() {
  return (
    <div className={styles.connectivityCard} aria-label="Connectivity controls">
      <IconButton className={styles.airplaneButton}>
        <Plane className={styles.largeIcon} />
      </IconButton>
      <IconButton className={styles.airdropButton}>
        <Podcast className={styles.largeIcon} />
      </IconButton>
      <IconButton className={styles.wifiButton}>
        <Wifi className={styles.largeIcon} />
      </IconButton>
      <button className={styles.smallButtonGroup} type="button">
        <span className={[styles.groupButton, styles.cellularButton].join(' ')}>
          <CellularBars />
        </span>
        <span className={[styles.groupButton, styles.bluetoothButton].join(' ')}>
          <Bluetooth className={styles.smallIcon} />
        </span>
        <span className={[styles.groupButton, styles.satelliteButton].join(' ')}>
          <Radio className={styles.smallIcon} />
        </span>
        <span className={[styles.groupButton, styles.antennaButton].join(' ')}>
          <Podcast className={styles.smallIcon} />
        </span>
      </button>
    </div>
  )
}

function MediaCard() {
  return (
    <div className={styles.mediaCard} aria-label="Now playing">
      <img
        alt=""
        className={styles.albumArt}
        src={albumArtUrl}
      />
      <IconButton className={styles.airplayButton}>
        <Podcast className={styles.antennaIcon} />
      </IconButton>
      <div className={styles.trackInfo}>
        <div className={styles.trackTitle}>Dennis and Dee Go on Welfare</div>
        <div className={styles.trackSubtitle}>The Always Sunny Podcast</div>
      </div>
      <div className={styles.transport}>
        <SkipButton direction="back" />
        <button
          className={[styles.mediaButton, styles.playButton].join(' ')}
          type="button"
          aria-label="Play"
        >
          <Play className={styles.playIcon} fill="currentColor" />
        </button>
        <SkipButton direction="forward" />
      </div>
    </div>
  )
}

function IconButton({
  children,
  className,
}: {
  children: ReactNode
  className: string
}) {
  return (
    <button
      className={[styles.iconButton, className].join(' ')}
      type="button"
    >
      {children}
    </button>
  )
}

function SkipButton({ direction }: { direction: 'back' | 'forward' }) {
  const Icon = direction === 'back' ? RotateCcw : RotateCw

  return (
    <button
      className={[styles.mediaButton, styles.skipButton].join(' ')}
      type="button"
      aria-label={direction === 'back' ? 'Back 15 seconds' : 'Forward 15 seconds'}
    >
      <Icon className={styles.skipIcon} />
      <span>15</span>
    </button>
  )
}

function CellularBars() {
  return (
    <span className={styles.cellBars}>
      <span />
      <span />
      <span />
      <span />
    </span>
  )
}
