import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useDrag } from '@use-gesture/react'
import type { GlassPointerEvent } from '@liquid-dom/core'
import {
  Frame,
  Glass,
  GlassContainer,
  HStack,
  Html,
  LiquidCanvas,
  Padding,
  Spacer,
  spring,
  Transform,
  useAnimate,
  useFrame,
  useInvalidateFrame,
  ZStack,
  type AnimationControls,
  type GlassContainerRef,
  type GlassProps,
  type TransformRef,
} from '@liquid-dom/react'
import {
  BookOpen,
  Camera,
  CloudSun,
  Compass,
  Dumbbell,
  Flashlight,
  Folder,
  HeartPulse,
  House,
  Image,
  Mail,
  Map,
  MessageCircle,
  MoonStar,
  Music,
  Newspaper,
  Podcast,
  ShoppingBag,
  StickyNote,
  WalletCards,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import abstractShapesUrl from '../assets/narrow-background.jpg'
import styles from './NotificationCenterDemo.module.css'

const PANEL_OPEN_Y = 0
const PANEL_CLOSED_Y = -380
const PANEL_CORNER_RADIUS = 70
const PANEL_RUBBERBAND = 0.16
const PANEL_IOR_TRANSITION_DISTANCE = 170
const PANEL_BASE_IOR = 1.5
const PANEL_OPEN_IOR = 1
const PANEL_BASE_DISPERSION = 0.2
const PANEL_OPEN_DISPERSION = 0

const BUTTON_SIZE = 50
const BUTTON_HOVER_SCALE = 1.08
const BUTTON_PRESS_SCALE = 0.94

const PANEL_TRANSITION = spring({ stiffness: 360, damping: 42 })
const BUTTON_SCALE_TRANSITION = spring({ stiffness: 720, damping: 42 })
const APP_ICON_OPACITY_TRANSITION = spring({ stiffness: 420, damping: 42 })

type GlassDragBind = Pick<GlassProps, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>
type AppIconSpec = {
  label: string
  color: string
  Icon: LucideIcon
}

const appIcons: AppIconSpec[] = [
  { label: 'Music', color: '#ff2d55', Icon: Music },
  { label: 'Photos', color: '#ff9500', Icon: Image },
  { label: 'Maps', color: '#34c759', Icon: Map },
  { label: 'Mail', color: '#007aff', Icon: Mail },
  { label: 'Files', color: '#5856d6', Icon: Folder },
  { label: 'Notes', color: '#ffcc00', Icon: StickyNote },
  { label: 'Health', color: '#ff3b30', Icon: HeartPulse },
  { label: 'Home', color: '#00c7be', Icon: House },
  { label: 'Weather', color: '#32ade6', Icon: CloudSun },
  { label: 'Wallet', color: '#af52de', Icon: WalletCards },
  { label: 'Books', color: '#ff9f0a', Icon: BookOpen },
  { label: 'Store', color: '#5e5ce6', Icon: ShoppingBag },
  { label: 'News', color: '#ff453a', Icon: Newspaper },
  { label: 'Fitness', color: '#30d158', Icon: Dumbbell },
  { label: 'Podcasts', color: '#bf5af2', Icon: Podcast },
]

const trayIcons: AppIconSpec[] = [
  { label: 'Camera', color: '#8e8e93', Icon: Camera },
  { label: 'Safari', color: '#0a84ff', Icon: Compass },
  { label: 'Shortcuts', color: '#bf5af2', Icon: Workflow },
  { label: 'Messages', color: '#30d158', Icon: MessageCircle },
]

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getPanelIor(panelY: number) {
  const progress = getPanelOpenTransitionProgress(panelY)

  return PANEL_BASE_IOR + (PANEL_OPEN_IOR - PANEL_BASE_IOR) * progress
}

function getPanelDispersion(panelY: number) {
  const progress = getPanelOpenTransitionProgress(panelY)

  return PANEL_BASE_DISPERSION + (PANEL_OPEN_DISPERSION - PANEL_BASE_DISPERSION) * progress
}

function getPanelOpenTransitionProgress(panelY: number) {
  return clamp(
    (panelY - (PANEL_OPEN_Y - PANEL_IOR_TRANSITION_DISTANCE)) / PANEL_IOR_TRANSITION_DISTANCE,
    0,
    1,
  )
}

export default function NotificationCenterDemo() {
  return (
    <section className={styles.root}>
      <LiquidCanvas
        className={styles.canvasShell}
        canvasClassName={styles.canvas}
      >
        <NotificationCenterScene />
      </LiquidCanvas>
    </section>
  )
}

function NotificationCenterScene() {
  const animate = useAnimate()
  const invalidateFrame = useInvalidateFrame()
  const [dragging, setDragging] = useState(false)
  const [appIconsVisible, setAppIconsVisible] = useState(false)
  const panelContainerRef = useRef<GlassContainerRef | null>(null)
  const panelTransformRef = useRef<TransformRef | null>(null)
  const controlsTransformRef = useRef<TransformRef | null>(null)
  const yRef = useRef(PANEL_OPEN_Y)
  const panelAnimationRef = useRef<AnimationControls | null>(null)
  const controlsAnimationRef = useRef<AnimationControls | null>(null)

  function setPanelY(panelY: number) {
    yRef.current = panelY

    if (panelTransformRef.current) {
      panelTransformRef.current.y = panelY
    }

    if (controlsTransformRef.current) {
      controlsTransformRef.current.y = panelY
    }

    if (panelContainerRef.current) {
      panelContainerRef.current.ior = getPanelIor(panelY)
      panelContainerRef.current.dispersion = getPanelDispersion(panelY)
    }

    invalidateFrame()
  }

  function cancelPanelAnimation() {
    panelAnimationRef.current?.stop()
    controlsAnimationRef.current?.stop()
    panelAnimationRef.current = null
    controlsAnimationRef.current = null

    if (panelTransformRef.current) {
      yRef.current = panelTransformRef.current.y
    }
  }

  function animatePanelY(targetY: number) {
    cancelPanelAnimation()

    const panelTransform = panelTransformRef.current
    const controlsTransform = controlsTransformRef.current

    if (!panelTransform || !controlsTransform) {
      setPanelY(targetY)
      return
    }

    const panelControls = animate(panelTransform, { y: targetY }, PANEL_TRANSITION)
    const buttonControls = animate(controlsTransform, { y: targetY }, PANEL_TRANSITION)
    panelAnimationRef.current = panelControls
    controlsAnimationRef.current = buttonControls

    void panelControls.finished.then(() => {
      if (panelAnimationRef.current !== panelControls) {
        return
      }

      panelAnimationRef.current = null
      controlsAnimationRef.current = null
      setPanelY(panelTransform.y)
    })
  }

  useEffect(() => {
    setPanelY(yRef.current)
    return cancelPanelAnimation
  }, [])

  useFrame(() => {
    if (!panelAnimationRef.current || !panelTransformRef.current || !panelContainerRef.current) {
      return
    }

    panelContainerRef.current.ior = getPanelIor(panelTransformRef.current.y)
    panelContainerRef.current.dispersion = getPanelDispersion(panelTransformRef.current.y)
  })

  const bind = useDrag<GlassPointerEvent | PointerEvent>(({
    active,
    first,
    last,
    offset: [, panelY],
  }) => {
    if (first) {
      setDragging(true)
      cancelPanelAnimation()
    }

    if (last || !active) {
      const boundedY = clamp(panelY, PANEL_CLOSED_Y, PANEL_OPEN_Y)
      const openProgress = (boundedY - PANEL_CLOSED_Y) / (PANEL_OPEN_Y - PANEL_CLOSED_Y)
      const targetY = openProgress > 0.45 ? PANEL_OPEN_Y : PANEL_CLOSED_Y
      setDragging(false)
      setAppIconsVisible(targetY === PANEL_CLOSED_Y)
      animatePanelY(targetY)
      return
    }

    setPanelY(panelY)
  }, {
    bounds: { top: PANEL_CLOSED_Y, bottom: PANEL_OPEN_Y },
    from: () => [0, panelTransformRef.current?.y ?? yRef.current],
    preventDefault: true,
    rubberband: [0, PANEL_RUBBERBAND],
    pointer: {
      capture: false,
      keys: false,
    },
  })

  const glassBind = bind() as GlassDragBind

  return (
    <ZStack alignment="center">
      <Html zIndex={-3} sizing="fill">
        <div className={styles.backdrop}>
          <img
            alt=""
            className={styles.backgroundImage}
            src={abstractShapesUrl}
          />
        </div>
      </Html>

      <Html
        zIndex={-2}
        sizing="fill"
        opacity={appIconsVisible ? 1 : 0}
        transition={{ opacity: APP_ICON_OPACITY_TRANSITION }}
      >
        <div className={styles.iconBackdrop}>
          <div
            className={styles.appGrid}
            aria-hidden="true"
          >
            {appIcons.map((app) => (
              <div key={app.label} className={styles.appItem}>
                <div
                  className={styles.appIcon}
                  style={{ '--app-color': app.color } as CSSProperties}
                >
                  <app.Icon className={styles.appIconGlyph} aria-hidden="true" />
                </div>
                <div className={styles.appLabel}>{app.label}</div>
              </div>
            ))}
          </div>
        </div>
      </Html>

      <Frame
        maxWidth={Infinity}
        maxHeight={Infinity}
        alignment="bottom"
      >
        <Padding insets={{ bottom: 19 }}>
          <GlassContainer
            opacity={appIconsVisible ? 1 : 0}
            transition={{ opacity: APP_ICON_OPACITY_TRANSITION }}
            blur={8}
            bezelWidth={20}
            thickness={90}
            displacementBlur={6}
            tint={{ r: 1, g: 1, b: 1, a: 0.1 }}
            shadowColor={{ r: 0, g: 0, b: 0, a: 0.05 }}
            shadowOffsetY={10}
            shadowBlur={24}
            specularOpacity={0.2}
            specularFalloff={1}
          >
            <Glass cornerRadius={36}>
              <Padding insets={{ horizontal: 18, vertical: 18 }}>
              <Html
                sizing="intrinsic"
                opacity={appIconsVisible ? 1 : 0}
                transition={{ opacity: APP_ICON_OPACITY_TRANSITION }}
              >
                <div className={styles.trayContent}>
                  {trayIcons.map((app) => (
                    <div
                      key={app.label}
                      className={styles.appIcon}
                      style={{ '--app-color': app.color } as CSSProperties}
                    >
                      <app.Icon className={styles.appIconGlyph} aria-hidden="true" />
                    </div>
                  ))}
                </div>
              </Html></Padding>
            </Glass>
          </GlassContainer>
        </Padding>
      </Frame>

      <Frame maxWidth={Infinity} maxHeight={Infinity}>
        <GlassContainer
          ref={panelContainerRef}
          ior={getPanelIor(PANEL_OPEN_Y)}
          dispersion={getPanelDispersion(PANEL_OPEN_Y)}
          blur={0}
          bezelWidth={30}
          thickness={90}
          displacementBlur={0}
          tint={{ r: 1, g: 1, b: 1, a: 0.1 }}
          shadowColor={{ r: 0, g: 0, b: 0, a: 0.18 }}
          shadowOffsetY={24}
          shadowBlur={52}
          specularOpacity={0}
          specularFalloff={2.4}
        >
          <Transform
            ref={panelTransformRef}
            y={PANEL_OPEN_Y}
          >
            <Glass
              cornerRadius={PANEL_CORNER_RADIUS}
              pointerEvents
              {...glassBind}
            >
              <Html sizing="fill">
                <div className={styles.panelOverlay} data-dragging={dragging}>
                  <div className={styles.drawerInfo}>
                    <div className={styles.drawerMeta}>
                      <span>Tue 12</span>
                      <span className={styles.weather}>
                        <MoonStar className={styles.weatherIcon} aria-hidden="true" />
                        14°
                      </span>
                    </div>
                    <div className={styles.drawerTime}>22:30</div>
                  </div>
                  <div className={styles.homeIndicator} />
                </div>
              </Html>
            </Glass>
          </Transform>
        </GlassContainer>
      </Frame>

      <Frame maxWidth={Infinity} maxHeight={Infinity}>
        <GlassContainer
          blur={4}
          thickness={20}
          bezelWidth={10}
          tint={{ r: 1, g: 1, b: 1, a: 0.18 }}
          shadowColor={{ r: 0, g: 0, b: 0, a: 0.16 }}
          shadowOffsetY={10}
          shadowBlur={22}
          specularOpacity={0.5}
        >
          <Transform
            ref={controlsTransformRef}
            y={PANEL_OPEN_Y}
          >
            <Padding insets={{
              bottom: 30,
              horizontal: 30
            }}>
                <HStack alignment="end">
                  <CenterButton label="Flashlight">
                    <Flashlight className={styles.icon} aria-hidden="true" />
                  </CenterButton>

                  <Spacer />

                  <CenterButton label="Camera">
                    <Camera className={styles.icon} aria-hidden="true" />
                  </CenterButton>
                </HStack>
              </Padding>
            </Transform>
        </GlassContainer>
      </Frame>
    </ZStack>
  )
}

function CenterButton({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const scale = pressed ? BUTTON_PRESS_SCALE : hovered ? BUTTON_HOVER_SCALE : 1

  return (
    <Transform
      scaleX={scale}
      scaleY={scale}
      origin={{ x: 0.5, y: 0.5 }}
      transition={{
        scaleX: BUTTON_SCALE_TRANSITION,
        scaleY: BUTTON_SCALE_TRANSITION,
      }}
    >
      <Frame width={BUTTON_SIZE} height={BUTTON_SIZE}>
        <Glass
          cornerRadius={BUTTON_SIZE / 2}
          pointerEvents
          onHover={setHovered}
          onPress={setPressed}
        >
          <Html sizing="fill">
            <div className={styles.buttonContent} aria-label={label}>
              {children}
            </div>
          </Html>
        </Glass>
      </Frame>
    </Transform>
  )
}
