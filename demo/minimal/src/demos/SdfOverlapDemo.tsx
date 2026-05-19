import { useEffect, useRef, useState } from 'react'
import { button, folder, useControls } from 'leva'
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidCanvas,
  Transform,
  ZStack,
} from '@liquid-dom/react'
import {
  deleteStoredBackgroundImage,
  loadStoredBackgroundImage,
  saveStoredBackgroundImage,
} from './backgroundImageStore'

const GLASS_WIDTH = 220
const GLASS_HEIGHT = 132
const GLASS_ORIGIN = { x: 0.5, y: 0.5 }
const INITIAL_DISTANCE = 34
const INITIAL_VERTICAL_OFFSET = 0
const INITIAL_SHAPE_SCALE_X = 1
const INITIAL_SHAPE_SCALE_Y = 1
const INITIAL_CONTAINER_SPACING = 12
const INITIAL_NORMAL_DIVERGENCE_BLEND_ENABLED = true
const INITIAL_NORMAL_DIVERGENCE_BLEND_POWER = 0.5
const INITIAL_BLUR = 7
const INITIAL_BEZEL_WIDTH = 18
const INITIAL_DISPLACEMENT_BLUR = 8
const INITIAL_CORNER_RADIUS = 60
const INITIAL_TINT_HEX = '#bababa'
const INITIAL_TINT_OPACITY = 45
const INITIAL_SHADOW_HEX = '#000000'
const INITIAL_SHADOW_OPACITY = 20
const INITIAL_SHADOW_OFFSET_X = 0
const INITIAL_SHADOW_OFFSET_Y = 4
const INITIAL_SHADOW_BLUR = 34
const INITIAL_SHADOW_SPREAD = 0

export default function SdfOverlapDemo() {
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null)
  const [backgroundImageName, setBackgroundImageName] = useState('')
  const backgroundImageUrlRef = useRef<string | null>(null)
  const backgroundImageInputRef = useRef<HTMLInputElement | null>(null)
  const {
    distance,
    verticalOffset,
    shapeScaleX,
    shapeScaleY,
    containerSpacing,
    normalDivergenceBlendEnabled,
    normalDivergenceBlendPower,
    blur,
    bezelWidth,
    displacementBlur,
    cornerRadius,
    tintHex,
    tintOpacity,
    shadowHex,
    shadowOpacity,
    shadowOffsetX,
    shadowOffsetY,
    shadowBlur,
    shadowSpread,
    showCheckerboard,
    debugDisplacement,
  } = useControls('SDF overlap', {
    geometry: folder({
      distance: {
        value: INITIAL_DISTANCE,
        min: -GLASS_WIDTH,
        max: 180,
        step: 1,
        label: 'Edge distance',
      },
      verticalOffset: {
        value: INITIAL_VERTICAL_OFFSET,
        min: -220,
        max: 220,
        step: 1,
        label: 'Vertical offset',
      },
      shapeScaleX: {
        value: INITIAL_SHAPE_SCALE_X,
        min: 0.25,
        max: 50,
        step: 0.01,
        label: 'Scale X',
      },
      shapeScaleY: {
        value: INITIAL_SHAPE_SCALE_Y,
        min: 0.25,
        max: 2.5,
        step: 0.01,
        label: 'Scale Y',
      },
      containerSpacing: {
        value: INITIAL_CONTAINER_SPACING,
        min: 0,
        max: 90,
        step: 1,
        label: 'Container spacing',
      },
      normalDivergenceBlendPower: {
        value: INITIAL_NORMAL_DIVERGENCE_BLEND_POWER,
        min: 0.1,
        max: 12,
        step: 0.1,
        label: 'Normal gate power',
      },
      normalDivergenceBlendEnabled: {
        value: INITIAL_NORMAL_DIVERGENCE_BLEND_ENABLED,
        label: 'Normal gating',
      },
      cornerRadius: {
        value: INITIAL_CORNER_RADIUS,
        min: 0,
        max: 120,
        step: 1,
        label: 'Corner radius',
      },
    }, { collapsed: false }),
    glass: folder({
      blur: {
        value: INITIAL_BLUR,
        min: 0,
        max: 80,
        step: 0.1,
        label: 'Blur',
      },
      bezelWidth: {
        value: INITIAL_BEZEL_WIDTH,
        min: 0,
        max: 80,
        step: 1,
        label: 'Bezel width',
      },
      displacementBlur: {
        value: INITIAL_DISPLACEMENT_BLUR,
        min: 0,
        max: 32,
        step: 1,
        label: 'Displacement blur',
      },
      tintHex: {
        value: INITIAL_TINT_HEX,
        label: 'Tint',
      },
      tintOpacity: {
        value: INITIAL_TINT_OPACITY,
        min: 0,
        max: 100,
        step: 1,
        label: 'Tint opacity',
      },
    }, { collapsed: false }),
    shadow: folder({
      shadowHex: {
        value: INITIAL_SHADOW_HEX,
        label: 'Shadow color',
      },
      shadowOpacity: {
        value: INITIAL_SHADOW_OPACITY,
        min: 0,
        max: 100,
        step: 1,
        label: 'Shadow opacity',
      },
      shadowOffsetX: {
        value: INITIAL_SHADOW_OFFSET_X,
        min: -120,
        max: 120,
        step: 1,
        label: 'Shadow X',
      },
      shadowOffsetY: {
        value: INITIAL_SHADOW_OFFSET_Y,
        min: -120,
        max: 160,
        step: 1,
        label: 'Shadow Y',
      },
      shadowBlur: {
        value: INITIAL_SHADOW_BLUR,
        min: 0,
        max: 120,
        step: 1,
        label: 'Shadow blur',
      },
      shadowSpread: {
        value: INITIAL_SHADOW_SPREAD,
        min: -80,
        max: 120,
        step: 1,
        label: 'Shadow spread',
      },
    }, { collapsed: false }),
    debug: folder({
      showCheckerboard: {
        value: true,
        label: 'Checkerboard',
      },
      debugDisplacement: {
        value: false,
        label: 'Debug displacement',
      },
    }, { collapsed: false }),
  })
  const [, setBackgroundImageControls] = useControls('SDF background image', () => ({
    currentImage: {
      value: 'None',
      label: 'Current image',
      editable: false,
    },
    'Choose image': button(() => backgroundImageInputRef.current?.click()),
    'Clear image': button(clearBackgroundImage),
  }))
  const centerOffset = (GLASS_WIDTH * shapeScaleX + distance) / 2
  const verticalCenterOffset = verticalOffset / 2
  const tintColor = hexToRgb(tintHex)
  const shadowColor = hexToRgb(shadowHex)

  useEffect(() => {
    setBackgroundImageControls({ currentImage: backgroundImageName || 'None' })
  }, [backgroundImageName, setBackgroundImageControls])

  useEffect(() => {
    let isMounted = true

    loadStoredBackgroundImage()
      .then((storedImage) => {
        if (!isMounted || !storedImage) {
          return
        }

        setBackgroundImage(storedImage.blob, storedImage.name)
      })
      .catch((error: unknown) => {
        console.error(error)
      })

    return () => {
      isMounted = false
      clearBackgroundImageUrl()
    }
  }, [])

  function clearBackgroundImageUrl() {
    if (backgroundImageUrlRef.current) {
      URL.revokeObjectURL(backgroundImageUrlRef.current)
      backgroundImageUrlRef.current = null
    }
  }

  function setBackgroundImage(blob: Blob, name: string) {
    const nextUrl = URL.createObjectURL(blob)
    clearBackgroundImageUrl()
    backgroundImageUrlRef.current = nextUrl
    setBackgroundImageUrl(nextUrl)
    setBackgroundImageName(name)
  }

  function updateBackgroundImage(file: File) {
    setBackgroundImage(file, file.name)
    saveStoredBackgroundImage(file, file.name).catch((error: unknown) => {
      console.error(error)
    })
  }

  function clearBackgroundImage() {
    clearBackgroundImageUrl()
    setBackgroundImageUrl(null)
    setBackgroundImageName('')
    deleteStoredBackgroundImage().catch((error: unknown) => {
      console.error(error)
    })
  }

  return (
    <section className="sdf-overlap-demo">
      <LiquidCanvas className="canvas-shell sdf-overlap-canvas-shell" canvasClassName="demo-canvas">
        <ZStack alignment="center">
          {showCheckerboard ? (
            <Html zIndex={-2} sizing="fill">
              <div className="sdf-overlap-checkerboard" />
            </Html>
          ) : null}

          {backgroundImageUrl ? (
            <Html zIndex={-1} sizing="fill">
              <img
                alt=""
                className="sdf-overlap-background-image"
                src={backgroundImageUrl}
              />
            </Html>
          ) : null}

          <Frame maxWidth={Infinity} maxHeight={Infinity}>
            <GlassContainer
              blur={blur}
              spacing={containerSpacing}
              normalDivergenceBlendEnabled={normalDivergenceBlendEnabled}
              normalDivergenceBlendPower={normalDivergenceBlendPower}
              bezelWidth={bezelWidth}
              displacementBlur={displacementBlur}
              thickness={86}
              contentDepth={18}
              debugDisplacement={debugDisplacement}
              tint={{ ...tintColor, a: tintOpacity / 100 }}
              shadowColor={{ ...shadowColor, a: shadowOpacity / 100 }}
              shadowOffsetX={shadowOffsetX}
              shadowOffsetY={shadowOffsetY}
              shadowBlur={shadowBlur}
              shadowSpread={shadowSpread}
              specularOpacity={0.7}
            >
              <ZStack alignment="center">
                <Transform
                  x={-centerOffset}
                  y={-verticalCenterOffset}
                  scaleX={shapeScaleX}
                  scaleY={shapeScaleY}
                  origin={GLASS_ORIGIN}
                >
                  <OverlapGlass cornerRadius={cornerRadius} />
                </Transform>
                <Transform
                  x={centerOffset}
                  y={verticalCenterOffset}
                  scaleX={shapeScaleX}
                  scaleY={shapeScaleY}
                  origin={GLASS_ORIGIN}
                >
                  <OverlapGlass cornerRadius={cornerRadius} />
                </Transform>
              </ZStack>
            </GlassContainer>
          </Frame>
        </ZStack>
      </LiquidCanvas>
      <input
        ref={backgroundImageInputRef}
        className="sdf-overlap-file-input"
        type="file"
        accept="image/*"
        aria-label="Background image"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''

          if (file) {
            updateBackgroundImage(file)
          }
        }}
      />
    </section>
  )
}

function OverlapGlass({ cornerRadius }: { cornerRadius: number }) {
  return (
    <Glass cornerRadius={cornerRadius}>
      <Frame width={GLASS_WIDTH} height={GLASS_HEIGHT} />
    </Glass>
  )
}

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)

  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  }
}
