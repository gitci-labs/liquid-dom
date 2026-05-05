import './style.css'
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RenderTarget,
  RGBAFormat,
  Scene as ThreeScene,
  SRGBColorSpace,
  TorusKnotGeometry,
  UnsignedByteType,
  WebGPURenderer,
} from 'three/webgpu'
import { Container, Glass, Html, Scene as GlassScene, WebGpuDomContentSource } from 'liquid-glass-dom'
import { ThreeGlassRenderer } from 'liquid-glass-three'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')
const blurInput = document.querySelector<HTMLInputElement>('#blur')
const spacingInput = document.querySelector<HTMLInputElement>('#spacing')
const distanceInput = document.querySelector<HTMLInputElement>('#distance')
const tintInput = document.querySelector<HTMLInputElement>('#tint')

if (!canvas || !blurInput || !spacingInput || !distanceInput || !tintInput) {
  throw new Error('Demo controls were not found.')
}

const sceneCanvas = canvas
const blurControl = blurInput
const spacingControl = spacingInput
const distanceControl = distanceInput
const tintControl = tintInput

function showMessage(message: string) {
  document.body.innerHTML = `<main class="message">${message}</main>`
}

function createGlassContent(kind: 'left' | 'right') {
  const card = document.createElement('div')
  card.className = `glass-content glass-content--${kind}`

  const eyebrow = document.createElement('span')
  eyebrow.className = 'glass-content__eyebrow'
  eyebrow.textContent = kind === 'left' ? 'Scene sample' : 'GPU pass'

  const value = document.createElement('strong')
  value.className = 'glass-content__value'
  value.textContent = kind === 'left' ? 'Three.js' : 'WebGPU'

  const detail = document.createElement('span')
  detail.className = 'glass-content__detail'
  detail.textContent = kind === 'left'
    ? 'DOM content refracted inside the glass'
    : 'Shared liquid glass core'

  card.append(eyebrow, value, detail)
  return card
}

function createGlassScene() {
  const scene = new GlassScene()
  const container = scene.add(new Container({
    blur: Number(blurControl.value),
    spacing: Number(spacingControl.value),
    bezelWidth: 16,
    thickness: 80,
    displacementFactor: 0.9,
    displacementBlur: 8,
    ior: 1.45,
    tint: { r: 0.9, g: 0.9, b: 0.9, a: Number(tintControl.value) },
    specularOpacity: 0.28,
    reflectionOffset: 26,
    shadowColor: { r: 0, g: 0, b: 0, a: 0.24 },
    shadowBlur: 22,
    shadowOffsetY: 12,
    contentDepth: 4,
  }))

  const left = container.add(new Glass({
    width: 280,
    height: 150,
    x: 0,
    y: 0,
    cornerRadius: 38,
    origin: { x: 140, y: 75 },
  }))
  const right = container.add(new Glass({
    width: 220,
    height: 150,
    x: left.width + Number(distanceControl.value),
    y: 0,
    cornerRadius: 38,
    origin: { x: 110, y: 75 },
  }))
  left.add(new Html({
    width: 232,
    height: 94,
    x: 24,
    y: 28,
    element: createGlassContent('left'),
  }))
  right.add(new Html({
    width: 164,
    height: 86,
    x: 28,
    y: 32,
    element: createGlassContent('right'),
  }))

  return { scene, container, left, right }
}

async function main() {
  if (!('gpu' in navigator)) {
    showMessage('This demo needs WebGPU enabled in the browser.')
    return
  }

  sceneCanvas.setAttribute('layoutsubtree', 'true')
  const renderer = new WebGPURenderer({
    canvas: sceneCanvas,
    antialias: false,
    alpha: false,
  })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  await renderer.init()
  renderer.getContext()

  const backgroundTarget = new RenderTarget(1, 1, {
    format: RGBAFormat,
    type: UnsignedByteType,
    colorSpace: SRGBColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  })
  backgroundTarget.texture.name = 'liquid-glass-three-backdrop'

  const threeScene = new ThreeScene()
  threeScene.background = new Color(0x171126)

  const camera = new PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 1.2, 5)

  const torus = new Mesh(
    new TorusKnotGeometry(0.8, 0.24, 180, 24),
    new MeshStandardMaterial({
      color: 0xffc857,
      emissive: 0x2c1645,
      emissiveIntensity: 0.22,
      metalness: 0.38,
      roughness: 0.24,
    }),
  )
  torus.position.y = 0.45
  threeScene.add(torus)

  const floor = new Mesh(
    new PlaneGeometry(9, 9, 16, 16),
    new MeshStandardMaterial({
      color: 0x312a6d,
      roughness: 0.68,
      side: DoubleSide,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -1
  threeScene.add(floor)

  const boxColors = [
    0xff5c8a,
    0x43d9ad,
    0x7b61ff,
    0xffa23a,
    0x4cc9f0,
    0xf8f32b,
    0xf15bb5,
  ]
  for (let index = 0; index < 14; index += 1) {
    const box = new Mesh(
      new BoxGeometry(0.32, 0.32, 0.32),
      new MeshStandardMaterial({
        color: boxColors[index % boxColors.length],
        emissive: boxColors[(index + 2) % boxColors.length],
        emissiveIntensity: 0.08,
        roughness: 0.42,
      }),
    )
    box.position.set((index - 6.5) * 0.45, -0.72, -1.7 + (index % 4) * 0.5)
    box.rotation.set(index * 0.22, index * 0.31, 0)
    threeScene.add(box)
  }

  threeScene.add(new AmbientLight(0xffffff, 0.52))
  const keyLight = new DirectionalLight(0xfff3d1, 2.2)
  keyLight.position.set(2.5, 4, 3)
  threeScene.add(keyLight)
  const magentaLight = new PointLight(0xff4fd8, 18, 6)
  magentaLight.position.set(-2.6, 1.4, 2.2)
  threeScene.add(magentaLight)
  const cyanLight = new PointLight(0x35d6ff, 16, 6)
  cyanLight.position.set(2.4, 0.8, 1.4)
  threeScene.add(cyanLight)

  const glassScene = createGlassScene()
  const contentSource = new WebGpuDomContentSource({
    targetCanvas: sceneCanvas,
    getCurrentDpr: () => renderer.getPixelRatio(),
    scene: glassScene.scene,
  })
  const glass = new ThreeGlassRenderer({
    renderer,
    scene: glassScene.scene,
    contentSource,
  })
  contentSource.setDevice(glass.device, glass.format)
  let lastCssWidth = 0
  let lastCssHeight = 0
  let lastDpr = 0

  function syncControls() {
    glassScene.container.blur = Number(blurControl.value)
    glassScene.container.spacing = Number(spacingControl.value)
    glassScene.right.x = glassScene.left.width + Number(distanceControl.value)
    glassScene.container.tint = {
      r: 0.9,
      g: 0.9,
      b: 0.9,
      a: Number(tintControl.value),
    }
  }

  function resize() {
    const width = sceneCanvas.clientWidth
    const height = sceneCanvas.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (width !== lastCssWidth || height !== lastCssHeight || dpr !== lastDpr) {
      renderer.setPixelRatio(dpr)
      renderer.setSize(width, height, false)
      backgroundTarget.setSize(Math.max(1, sceneCanvas.width), Math.max(1, sceneCanvas.height))
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
      lastCssWidth = width
      lastCssHeight = height
      lastDpr = dpr
    }

    glassScene.container.x = width * 0.5 - 250
    glassScene.container.y = height * 0.5 - 75
    glassScene.left.x = 0
  }

  blurControl.addEventListener('input', syncControls)
  spacingControl.addEventListener('input', syncControls)
  distanceControl.addEventListener('input', syncControls)
  tintControl.addEventListener('input', syncControls)
  window.addEventListener('resize', resize)

  function frame(time: number) {
    resize()
    syncControls()

    torus.rotation.x = time * 0.00035
    torus.rotation.y = time * 0.00055

    renderer.setRenderTarget(backgroundTarget)
    renderer.render(threeScene, camera)
    renderer.setRenderTarget(null)

    contentSource.sync()
    glass.render({
      backdrop: backgroundTarget,
      width: sceneCanvas.width,
      height: sceneCanvas.height,
      dpr: renderer.getPixelRatio(),
    })

    requestAnimationFrame(frame)
  }

  resize()
  window.addEventListener('pagehide', () => {
    contentSource.destroy()
    glass.destroy()
    backgroundTarget.dispose()
  })
  requestAnimationFrame(frame)
}

void main().catch((error) => {
  console.error(error)
  showMessage(error instanceof Error ? error.message : 'Unable to start the demo.')
})
