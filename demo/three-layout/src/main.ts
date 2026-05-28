import './style.css'
import {
  AmbientLight,
  Color,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  PlaneGeometry,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Shape,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import titleFontUrl from 'three/examples/fonts/droid/droid_sans_regular.typeface.json?url'
import { LayoutEngine, Frame, Leaf, Layout, Padding, VStack } from '@liquid-dom/layout'
import { AnimationManager, spring } from '@liquid-dom/layout/animation'
import type {
  LayoutChild,
  LayoutDebugStats,
  LayoutMeasureInput,
  LayoutNode,
  LayoutPlaceInput,
  LeafNode,
  Rect,
  Size,
} from '@liquid-dom/layout'
import type { DataTexture, WebGLRenderTarget } from 'three'

type AnimatedRectView = {
  currentRect: RenderRect | null
  targetRect: RenderRect | null
}

type RectMeshView = AnimatedRectView & {
  mesh: Mesh<ExtrudeGeometry, MeshStandardMaterial | MeshPhysicalMaterial>
  geometryWidth: number
  geometryHeight: number
}

type TileView = RectMeshView & {
  node: LeafNode
  hitMesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  panelIndex: number
  tileIndex: number
  currentZ: number | null
  targetZ: number | null
}

type TitleView = AnimatedRectView & {
  node: LeafNode
  mesh: Mesh<TextGeometry, MeshStandardMaterial>
}

type PanelView = {
  node: LayoutNode
  grid: Grid2x3
  gridPadding: LayoutNode
  title: TitleView
  background: RectMeshView
  tiles: TileView[]
}

type HoverTarget = {
  panelIndex: number
  tileIndex: number
}

type GridLayoutProps = {
  columns: number
  rows: number
  columnGap: number
  rowGap: number
}

type RenderRect = {
  x: number
  y: number
  width: number
  height: number
}

type CornerRadii = {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

class MeasuredLeaf extends Leaf {
  private readonly measureFn: () => Size

  constructor(measure: () => Size, options: { measureKey?: unknown } = {}) {
    super(options)
    this.measureFn = measure
  }

  protected override measureLeaf(): Size {
    return this.measureFn()
  }
}

type CornerRadiiInput = number | CornerRadii

type EnvironmentMap = {
  background: DataTexture
  renderTarget: WebGLRenderTarget
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')
const tileSizeElement = document.querySelector<HTMLElement>('#tile-size')
const nodeCountElement = document.querySelector<HTMLElement>('#node-count')

if (!canvas || !tileSizeElement || !nodeCountElement) {
  throw new Error('Demo elements were not found.')
}

const sceneCanvas = canvas
const tileSizeReadout = tileSizeElement
const nodeCountReadout = nodeCountElement

// Grid layout
const GRID_COLUMNS = 3
const GRID_ROWS = 2
const PANEL_COUNT = 3
const HOVER_SCALE = 2
const NON_HOVER_SCALE = 0.85
const COLUMN_GAP_RATIO = 0.18
const ROW_GAP_RATIO = 0.21
const PANEL_STACK_GAP = 150

// Tile sizing and geometry
const TILE_MIN_SIZE = 52
const TILE_MAX_SIZE = 200
const TILE_CORNER_RADIUS = 24
const TILE_PANEL_CORNER_RADIUS = 60
const TILE_DEPTH = 30
const TILE_BEVEL_SIZE = 6
const TILE_BEVEL_THICKNESS = 5
const TILE_HOVER_Z_LIFT = 0

// Panel geometry
const BACKGROUND_PADDING = 35
const BACKGROUND_CORNER_RADIUS = TILE_PANEL_CORNER_RADIUS + BACKGROUND_PADDING
const HIT_PROXY_Z = TILE_DEPTH * 0.65
const ROOT_PANEL_Z = -TILE_DEPTH - 34

// Stage interaction
const STAGE_ROTATION_X = -0.34
const STAGE_ROTATION_Y = 0.18
const POINTER_ROTATION_X = 0.08
const POINTER_ROTATION_Y = 0.12

// Title text
const TITLE_Z = 10
const TITLE_SIZE = 42
const TITLE_DEPTH = 5
const TITLE_PANEL_GAP = 36

// Camera
const CAMERA_FOV = 32
const CAMERA_DISTANCE = 1400
const CAMERA_NEAR = 10
const CAMERA_FAR = 8000
const CAMERA_FIT_MARGIN = 1.24

// Animation
const LAYOUT_SPRING = spring({ stiffness: 300, damping: 20 })
const TILE_LIFT_SPRING = spring({ stiffness: 500, damping: 15 })

// Environment map
const ENVIRONMENT_MAP_URL =
  'https://raw.githack.com/pmndrs/drei-assets/456060a26bbeb8fdf79326f224b6d99b8bcce736/hdri/forest_slope_1k.hdr'
const ENVIRONMENT_BACKGROUND_BLUR = 0.2
const ENVIRONMENT_BACKGROUND_INTENSITY = 0.04
const ENVIRONMENT_LIGHTING_INTENSITY = 0.72

// Panel glass material
const PANEL_GLASS_COLOR = 0xffffff
const PANEL_GLASS_ATTENUATION_COLOR = 0xf4fff8
const PANEL_GLASS_ATTENUATION_DISTANCE = 180
const PANEL_GLASS_ENV_INTENSITY = 0.85
const PANEL_GLASS_IOR = 1.35
const PANEL_GLASS_OPACITY = 0.4
const PANEL_GLASS_ROUGHNESS = 0.2
const PANEL_GLASS_THICKNESS = 42
const PANEL_GLASS_TRANSMISSION = 0.68

// Tile material
const TILE_PASTEL_MIX = 0.12
const TILE_COLOR_INTENSITY = 0.82
const TILE_METALNESS = 0.08
const TILE_ROUGHNESS = 0.38

// Tile palette
const colorPalette = [
  0xe85d75,
  0x25a18e,
  0x725ac1,
  0xf3a712,
  0x2f80ed,
  0x7cb342,
]

const layoutState = {
  tileSize: 140,
  columnGap: 28,
  rowGap: 30,
  hoveredTile: null as HoverTarget | null,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeCornerRadii(width: number, height: number, input: CornerRadiiInput): CornerRadii {
  const halfWidth = width * 0.5
  const halfHeight = height * 0.5
  const radii = typeof input === 'number'
    ? {
        topLeft: input,
        topRight: input,
        bottomRight: input,
        bottomLeft: input,
      }
    : input

  return {
    topLeft: Math.min(radii.topLeft, halfWidth, halfHeight),
    topRight: Math.min(radii.topRight, halfWidth, halfHeight),
    bottomRight: Math.min(radii.bottomRight, halfWidth, halfHeight),
    bottomLeft: Math.min(radii.bottomLeft, halfWidth, halfHeight),
  }
}

function tileCornerRadii(tileIndex: number): CornerRadii {
  const column = tileIndex % GRID_COLUMNS
  const row = Math.floor(tileIndex / GRID_COLUMNS)

  return {
    topLeft: row === 0 && column === 0 ? TILE_PANEL_CORNER_RADIUS : TILE_CORNER_RADIUS,
    topRight: row === 0 && column === GRID_COLUMNS - 1 ? TILE_PANEL_CORNER_RADIUS : TILE_CORNER_RADIUS,
    bottomRight: row === GRID_ROWS - 1 && column === GRID_COLUMNS - 1 ? TILE_PANEL_CORNER_RADIUS : TILE_CORNER_RADIUS,
    bottomLeft: row === GRID_ROWS - 1 && column === 0 ? TILE_PANEL_CORNER_RADIUS : TILE_CORNER_RADIUS,
  }
}

function createTileGeometry(width: number, height: number, cornerRadii: CornerRadiiInput = TILE_CORNER_RADIUS) {
  const halfWidth = width * 0.5
  const halfHeight = height * 0.5
  const radii = normalizeCornerRadii(width, height, cornerRadii)
  const smallestRadius = Math.min(radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft)
  const depth = TILE_DEPTH
  const shape = new Shape()

  shape.moveTo(-halfWidth + radii.bottomLeft, -halfHeight)
  shape.lineTo(halfWidth - radii.bottomRight, -halfHeight)
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radii.bottomRight)
  shape.lineTo(halfWidth, halfHeight - radii.topRight)
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radii.topRight, halfHeight)
  shape.lineTo(-halfWidth + radii.topLeft, halfHeight)
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radii.topLeft)
  shape.lineTo(-halfWidth, -halfHeight + radii.bottomLeft)
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radii.bottomLeft, -halfHeight)
  shape.closePath()

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 14,
    bevelSize: Math.min(TILE_BEVEL_SIZE, smallestRadius * 0.35),
    bevelThickness: Math.min(TILE_BEVEL_THICKNESS, smallestRadius * 0.3),
    curveSegments: 20,
    steps: 1,
  })
  geometry.translate(0, 0, -depth * 0.5)
  geometry.computeVertexNormals()
  return geometry
}

function createTileMaterial(color: number) {
  const pastel = new Color(color).lerp(new Color(0xffffff), TILE_PASTEL_MIX).multiplyScalar(TILE_COLOR_INTENSITY)
  return new MeshStandardMaterial({
    color: pastel,
    metalness: TILE_METALNESS,
    roughness: TILE_ROUGHNESS,
  })
}

async function loadTitleFont() {
  const response = await fetch(titleFontUrl)
  if (!response.ok) {
    throw new Error(`Unable to load title font: ${response.status}`)
  }

  return new FontLoader().parse(await response.json())
}

function createTitleGeometry(text: string) {
  const geometry = new TextGeometry(text, {
    font: titleFont,
    size: TITLE_SIZE,
    depth: TITLE_DEPTH,
    curveSegments: 10,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.8,
    bevelThickness: 0.8,
  })

  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) {
    throw new Error('Unable to measure title geometry.')
  }

  const width = box.max.x - box.min.x
  const height = box.max.y - box.min.y
  geometry.translate(-box.min.x - width * 0.5, -box.min.y - height * 0.5, -TITLE_DEPTH * 0.5)
  geometry.computeVertexNormals()

  return { geometry, size: { width, height } }
}

async function loadEnvironmentMap(renderer: WebGLRenderer): Promise<EnvironmentMap> {
  const background = await new HDRLoader().loadAsync(ENVIRONMENT_MAP_URL)
  background.mapping = EquirectangularReflectionMapping

  const pmremGenerator = new PMREMGenerator(renderer)
  pmremGenerator.compileEquirectangularShader()
  const renderTarget = pmremGenerator.fromEquirectangular(background)
  pmremGenerator.dispose()

  return { background, renderTarget }
}

function tileSizeFor(panelIndex: number, tileIndex: number): Size {
  const hoveredTile = layoutState.hoveredTile?.panelIndex === panelIndex ? layoutState.hoveredTile.tileIndex : null
  const hoveredColumn = hoveredTile === null ? null : hoveredTile % GRID_COLUMNS
  const hoveredRow = hoveredTile === null ? null : Math.floor(hoveredTile / GRID_COLUMNS)
  const column = tileIndex % GRID_COLUMNS
  const row = Math.floor(tileIndex / GRID_COLUMNS)
  const widthScale = hoveredTile === null
    ? 1
    : hoveredColumn === column
      ? HOVER_SCALE
      : NON_HOVER_SCALE
  const heightScale = hoveredTile === null
    ? 1
    : hoveredRow === row
      ? HOVER_SCALE
      : NON_HOVER_SCALE

  return {
    width: layoutState.tileSize * widthScale,
    height: layoutState.tileSize * heightScale,
  }
}

function tileMeasureKey(panelIndex: number, tileIndex: number) {
  const size = tileSizeFor(panelIndex, tileIndex)
  return `${size.width}:${size.height}`
}

function gridProps(): GridLayoutProps {
  return {
    columns: GRID_COLUMNS,
    rows: GRID_ROWS,
    columnGap: layoutState.columnGap,
    rowGap: layoutState.rowGap,
  }
}

function measureGridTracks(children: LayoutChild[], props: GridLayoutProps) {
  const sizes = children.map((child) => child.measure({}))
  const columnWidths = Array.from({ length: props.columns }, () => 0)
  const rowHeights = Array.from({ length: props.rows }, () => 0)

  for (const [index, size] of sizes.entries()) {
    const column = index % props.columns
    const row = Math.floor(index / props.columns)
    if (row >= props.rows) continue

    columnWidths[column] = Math.max(columnWidths[column] ?? 0, size.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, size.height)
  }

  return { sizes, columnWidths, rowHeights }
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function gridSize(columnWidths: number[], rowHeights: number[], props: GridLayoutProps): Size {
  return {
    width: sum(columnWidths) + props.columnGap * Math.max(0, props.columns - 1),
    height: sum(rowHeights) + props.rowGap * Math.max(0, props.rows - 1),
  }
}

const hitProxyGeometry = new PlaneGeometry(1, 1)
const hitProxyMaterial = new MeshBasicMaterial({
  color: 0xffffff,
  colorWrite: false,
  depthWrite: false,
  opacity: 0,
  side: DoubleSide,
  transparent: true,
})

const titleFont = await loadTitleFont()
function createTitleView(panelIndex: number): TitleView {
  const titleGeometry = createTitleGeometry(`Section ${panelIndex + 1}`)
  const title: TitleView = {
    node: new MeasuredLeaf(
      () => titleGeometry.size,
      {
      measureKey: `${titleGeometry.size.width}:${titleGeometry.size.height}`,
      },
    ),
    mesh: new Mesh(
      titleGeometry.geometry.clone(),
      new MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.1,
        metalness: 0.02,
        roughness: 0.5,
      }),
    ),
    currentRect: null,
    targetRect: null,
  }
  title.mesh.position.z = TITLE_Z
  return title
}

function createPanelBackground(): RectMeshView {
  const background: RectMeshView = {
    mesh: new Mesh(
      createTileGeometry(1, 1, BACKGROUND_CORNER_RADIUS),
      new MeshPhysicalMaterial({
        color: PANEL_GLASS_COLOR,
        attenuationColor: PANEL_GLASS_ATTENUATION_COLOR,
        attenuationDistance: PANEL_GLASS_ATTENUATION_DISTANCE,
        envMapIntensity: PANEL_GLASS_ENV_INTENSITY,
        ior: PANEL_GLASS_IOR,
        metalness: 0,
        opacity: PANEL_GLASS_OPACITY,
        roughness: PANEL_GLASS_ROUGHNESS,
        thickness: PANEL_GLASS_THICKNESS,
        transmission: PANEL_GLASS_TRANSMISSION,
        transparent: true,
      }),
    ),
    geometryWidth: 1,
    geometryHeight: 1,
    currentRect: null,
    targetRect: null,
  }
  background.mesh.position.z = ROOT_PANEL_Z
  return background
}

class Grid2x3 extends Layout {
  private _props: GridLayoutProps

  constructor(props: GridLayoutProps) {
    super('grid-2x3')
    this._props = props
  }

  get props(): GridLayoutProps {
    return this._props
  }

  set props(value: GridLayoutProps) {
    if (Object.is(this._props, value)) return
    this._props = value
    this.markMeasureDirty('props')
  }

  override measureSelf({ children }: LayoutMeasureInput): Size {
    const { columnWidths, rowHeights } = measureGridTracks(children, this._props)
    return gridSize(columnWidths, rowHeights, this._props)
  }

  override placeChildren({ bounds, children }: LayoutPlaceInput): void {
    const { sizes, columnWidths, rowHeights } = measureGridTracks(children, this._props)
    let y = bounds.y

    for (let row = 0; row < this._props.rows; row += 1) {
      let x = bounds.x
      const rowHeight = rowHeights[row] ?? 0

      for (let column = 0; column < this._props.columns; column += 1) {
        const index = row * this._props.columns + column
        const child = children[index]
        const size = sizes[index]
        const columnWidth = columnWidths[column] ?? 0

        if (child && size) {
          child.place({
            x: x + (columnWidth - size.width) * 0.5,
            y: y + (rowHeight - size.height) * 0.5,
            width: size.width,
            height: size.height,
          }, size)
        }

        x += columnWidth + this._props.columnGap
      }

      y += rowHeight + this._props.rowGap
    }
  }
}

function createGrid(tiles: TileView[]) {
  return new Grid2x3(gridProps()).append(tiles.map((tile) => tile.node))
}

function createPanel(panelIndex: number): PanelView {
  const title = createTitleView(panelIndex)
  const tiles: TileView[] = colorPalette.map((color, tileIndex) => {
    const node = new MeasuredLeaf(
      () => tileSizeFor(panelIndex, tileIndex),
      {
      measureKey: tileMeasureKey(panelIndex, tileIndex),
      },
    )
    const geometrySize = tileSizeFor(panelIndex, tileIndex)
    const mesh = new Mesh(
      createTileGeometry(geometrySize.width, geometrySize.height, tileCornerRadii(tileIndex)),
      createTileMaterial(color),
    )
    const hitMesh = new Mesh(hitProxyGeometry, hitProxyMaterial)
    hitMesh.position.z = HIT_PROXY_Z
    return {
      node,
      mesh,
      hitMesh,
      panelIndex,
      tileIndex,
      geometryWidth: geometrySize.width,
      geometryHeight: geometrySize.height,
      currentRect: null,
      targetRect: null,
      currentZ: null,
      targetZ: null,
    }
  })
  const grid = createGrid(tiles)
  const gridPadding = new Padding(BACKGROUND_PADDING).append(grid)

  return {
    node: new VStack({ alignment: 'center', spacing: TITLE_PANEL_GAP }).append(title.node, gridPadding),
    grid,
    gridPadding,
    title,
    background: createPanelBackground(),
    tiles,
  }
}

const panels = Array.from({ length: PANEL_COUNT }, (_, index) => createPanel(index))
const tiles = panels.flatMap((panel) => panel.tiles)
const rootStack = new VStack({ alignment: 'center', spacing: PANEL_STACK_GAP }).append(panels.map((panel) => panel.node))
const root = new Frame({
  maxWidth: 'infinity',
  maxHeight: 'infinity',
  alignment: 'center',
}).append(rootStack)
const layoutEngine = new LayoutEngine({ root })
const animationManager = new AnimationManager()

const renderer = new WebGLRenderer({
  canvas: sceneCanvas,
  antialias: true,
  alpha: false,
})
renderer.outputColorSpace = SRGBColorSpace
const environmentMap = await loadEnvironmentMap(renderer)

const raycaster = new Raycaster()
const pointer = new Vector2()

const scene = new Scene()
scene.background = environmentMap.background
scene.backgroundBlurriness = ENVIRONMENT_BACKGROUND_BLUR
scene.backgroundIntensity = ENVIRONMENT_BACKGROUND_INTENSITY
scene.environment = environmentMap.renderTarget.texture
scene.environmentIntensity = ENVIRONMENT_LIGHTING_INTENSITY

const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR)
camera.position.set(0, 0, CAMERA_DISTANCE)
camera.lookAt(0, 0, 0)
const cameraLookTarget = new Vector3()
const cameraWorldTarget = new Vector3()

const stage = new Group()
stage.rotation.x = STAGE_ROTATION_X
stage.rotation.y = STAGE_ROTATION_Y
scene.add(stage)
for (const panel of panels) {
  stage.add(panel.background.mesh)
  stage.add(panel.title.mesh)
  for (const tile of panel.tiles) {
    stage.add(tile.mesh)
    stage.add(tile.hitMesh)
  }
}

scene.add(new AmbientLight(0xffffff, 1.8))
const keyLight = new DirectionalLight(0xffffff, 3.2)
keyLight.position.set(-260, -320, 560)
scene.add(keyLight)

const coralLight = new PointLight(0xff7a59, 44000, 1200)
coralLight.position.set(-320, 210, 360)
scene.add(coralLight)

const tealLight = new PointLight(0x2dd4bf, 32000, 1000)
tealLight.position.set(360, -180, 300)
scene.add(tealLight)

let lastWidth = 0
let lastHeight = 0
let lastDpr = 0
let animationFrameId: number | null = null
let lastAnimationTime = 0

function showMessage(message: string) {
  const element = document.createElement('main')
  element.className = 'message'
  element.textContent = message
  document.body.replaceChildren(element)
}

function measureLayout(width: number, height: number) {
  layoutState.tileSize = clamp(Math.min(width * 0.145, height * 0.25), TILE_MIN_SIZE, TILE_MAX_SIZE)
  layoutState.columnGap = clamp(layoutState.tileSize * COLUMN_GAP_RATIO, 10, 30)
  layoutState.rowGap = clamp(layoutState.tileSize * ROW_GAP_RATIO, 12, 36)

  for (const panel of panels) {
    panel.grid.props = gridProps()
  }

  for (const tile of tiles) {
    tile.node.measureKey = tileMeasureKey(tile.panelIndex, tile.tileIndex)
  }

  return layoutEngine.layout({ width, height })
}

function absoluteRect(node: LayoutNode): Rect | undefined {
  const ownRect = node.layout?.rect
  if (!ownRect) return undefined

  let x = ownRect.x
  let y = ownRect.y
  let parent = node.parent
  while (parent) {
    const parentRect = parent.layout?.rect
    if (parentRect) {
      x += parentRect.x
      y += parentRect.y
    }
    parent = parent.parent
  }

  return {
    x,
    y,
    width: ownRect.width,
    height: ownRect.height,
  }
}

function stackRenderOffsetY() {
  return layoutState.hoveredTile === null ? 0 : (layoutState.tileSize * (HOVER_SCALE - 1)) * 0.5
}

function renderRectForLayoutRect(rect: Rect, width: number, height: number): RenderRect {
  return {
    x: rect.x + rect.width * 0.5 - width * 0.5,
    y: height * 0.5 - (rect.y + rect.height * 0.5) + stackRenderOffsetY(),
    width: rect.width,
    height: rect.height,
  }
}

function applyRectMesh(view: RectMeshView, rect: RenderRect, cornerRadii: CornerRadiiInput = TILE_CORNER_RADIUS) {
  if (Math.abs(view.geometryWidth - rect.width) > 0.1 || Math.abs(view.geometryHeight - rect.height) > 0.1) {
    view.mesh.geometry.dispose()
    view.mesh.geometry = createTileGeometry(rect.width, rect.height, cornerRadii)
    view.geometryWidth = rect.width
    view.geometryHeight = rect.height
  }

  view.mesh.position.x = rect.x
  view.mesh.position.y = rect.y
  view.mesh.scale.set(1, 1, 1)
}

function applyTileRect(tile: TileView, rect: RenderRect) {
  applyRectMesh(tile, rect, tileCornerRadii(tile.tileIndex))
  tile.mesh.position.z = tile.currentZ ?? 0

  const column = tile.tileIndex % GRID_COLUMNS
  const row = Math.floor(tile.tileIndex / GRID_COLUMNS)
  const leftMargin = column === 0 ? 0 : layoutState.columnGap * 0.5
  const rightMargin = column === GRID_COLUMNS - 1 ? 0 : layoutState.columnGap * 0.5
  const topMargin = row === 0 ? 0 : layoutState.rowGap * 0.5
  const bottomMargin = row === GRID_ROWS - 1 ? 0 : layoutState.rowGap * 0.5
  const proxyLeft = rect.x - rect.width * 0.5 - leftMargin
  const proxyRight = rect.x + rect.width * 0.5 + rightMargin
  const proxyTop = rect.y + rect.height * 0.5 + topMargin
  const proxyBottom = rect.y - rect.height * 0.5 - bottomMargin

  tile.hitMesh.position.x = (proxyLeft + proxyRight) * 0.5
  tile.hitMesh.position.y = (proxyTop + proxyBottom) * 0.5
  tile.hitMesh.scale.set(proxyRight - proxyLeft, proxyTop - proxyBottom, 1)
}

function applyTitleRect(title: TitleView, rect: RenderRect) {
  title.mesh.position.x = rect.x
  title.mesh.position.y = rect.y
}

function setRectTarget(
  view: AnimatedRectView,
  targetRect: RenderRect,
  immediate: boolean,
  applyRect: (rect: RenderRect) => void,
) {
  view.targetRect = targetRect

  if (immediate || !view.currentRect) {
    animationManager.stop(view, ['currentRect'])
    view.currentRect = targetRect
    applyRect(targetRect)
  } else {
    animationManager.animate(view, { currentRect: targetRect }, LAYOUT_SPRING)
  }
}

function tileTargetZ(tile: TileView) {
  return layoutState.hoveredTile?.panelIndex === tile.panelIndex &&
    layoutState.hoveredTile.tileIndex === tile.tileIndex
    ? TILE_HOVER_Z_LIFT
    : 0
}

function setTileZTarget(tile: TileView, targetZ: number, immediate: boolean) {
  tile.targetZ = targetZ

  if (immediate || tile.currentZ === null) {
    animationManager.stop(tile, ['currentZ'])
    tile.currentZ = targetZ
    tile.mesh.position.z = targetZ
  } else {
    animationManager.animate(tile, { currentZ: targetZ }, TILE_LIFT_SPRING)
  }
}

function distanceToFitRect(rect: RenderRect, viewportWidth: number, viewportHeight: number) {
  const verticalFov = (camera.fov * Math.PI) / 180
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * (viewportWidth / Math.max(viewportHeight, 1)))
  const distanceForHeight = rect.height / (2 * Math.tan(verticalFov * 0.5))
  const distanceForWidth = rect.width / (2 * Math.tan(horizontalFov * 0.5))
  return Math.max(distanceForHeight, distanceForWidth, CAMERA_DISTANCE) * CAMERA_FIT_MARGIN
}

function frameCameraToRootStack(width: number, height: number) {
  const stackRect = absoluteRect(rootStack)
  if (!stackRect) {
    camera.position.set(0, 0, CAMERA_DISTANCE)
    camera.lookAt(0, 0, 0)
    return
  }

  const renderRect = renderRectForLayoutRect(stackRect, width, height)
  stage.updateWorldMatrix(true, false)
  cameraLookTarget.set(renderRect.x, renderRect.y, 0)
  cameraWorldTarget.copy(cameraLookTarget)
  stage.localToWorld(cameraWorldTarget)
  camera.position.set(
    cameraWorldTarget.x,
    cameraWorldTarget.y,
    cameraWorldTarget.z + distanceToFitRect(renderRect, width, height),
  )
  camera.lookAt(cameraWorldTarget)
}

function updateLayoutTargets(width: number, height: number, stats: LayoutDebugStats, immediate: boolean) {
  for (const panel of panels) {
    const titleRect = absoluteRect(panel.title.node)
    if (titleRect) {
      setRectTarget(panel.title, renderRectForLayoutRect(titleRect, width, height), immediate, (rect) =>
        applyTitleRect(panel.title, rect),
      )
    }

    const panelRect = absoluteRect(panel.gridPadding)
    if (panelRect) {
      setRectTarget(
        panel.background,
        renderRectForLayoutRect(panelRect, width, height),
        immediate,
        (rect) => applyRectMesh(panel.background, rect, BACKGROUND_CORNER_RADIUS),
      )
    }

    for (const tile of panel.tiles) {
      const rect = absoluteRect(tile.node)
      if (!rect) continue

      setRectTarget(tile, renderRectForLayoutRect(rect, width, height), immediate, (nextRect) => applyTileRect(tile, nextRect))
      setTileZTarget(tile, tileTargetZ(tile), immediate)
    }
  }

  tileSizeReadout.textContent = `${Math.round(
    layoutState.hoveredTile === null ? layoutState.tileSize : layoutState.tileSize * HOVER_SCALE,
  )} px`
  nodeCountReadout.textContent = String(stats.nodes)
  if (layoutState.hoveredTile === null) {
    frameCameraToRootStack(width, height)
  }
}

function syncViewport() {
  const width = Math.max(1, sceneCanvas.clientWidth)
  const height = Math.max(1, sceneCanvas.clientHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  if (width !== lastWidth || height !== lastHeight || dpr !== lastDpr) {
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()

    lastWidth = width
    lastHeight = height
    lastDpr = dpr
  }

  return { width, height }
}

function finishAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  for (const panel of panels) {
    animationManager.stop(panel.background, ['currentRect'])
    animationManager.stop(panel.title, ['currentRect'])
    for (const tile of panel.tiles) {
      animationManager.stop(tile, ['currentRect'])
      animationManager.stop(tile, ['currentZ'])
    }
  }
}

function renderCurrentLayout() {
  for (const panel of panels) {
    if (panel.title.currentRect) {
      applyTitleRect(panel.title, panel.title.currentRect)
    }

    if (panel.background.currentRect) {
      applyRectMesh(panel.background, panel.background.currentRect, BACKGROUND_CORNER_RADIUS)
    }

    for (const tile of panel.tiles) {
      if (!tile.currentRect) continue
      applyTileRect(tile, tile.currentRect)
    }
  }

  renderer.render(scene, camera)
}

function animateLayout(now: number) {
  const delta = lastAnimationTime === 0 ? 16.7 : now - lastAnimationTime
  lastAnimationTime = now
  animationManager.tick(delta)
  renderCurrentLayout()

  if (animationManager.active) {
    animationFrameId = requestAnimationFrame(animateLayout)
    return
  }

  animationFrameId = null
  lastAnimationTime = 0
}

function startLayoutAnimation() {
  if (animationFrameId === null) {
    lastAnimationTime = 0
    animationFrameId = requestAnimationFrame(animateLayout)
  }
}

function layoutAndRender({ immediate = false }: { immediate?: boolean } = {}) {
  const { width, height } = syncViewport()
  const stats = measureLayout(width, height)
  updateLayoutTargets(width, height, stats, immediate)

  if (immediate) {
    finishAnimation()
    renderCurrentLayout()
  } else {
    startLayoutAnimation()
  }
}

function sameHoverTarget(a: HoverTarget | null, b: HoverTarget | null) {
  return a?.panelIndex === b?.panelIndex && a?.tileIndex === b?.tileIndex
}

function setHoveredTile(target: HoverTarget | null) {
  if (sameHoverTarget(layoutState.hoveredTile, target)) return false

  layoutState.hoveredTile = target
  sceneCanvas.style.cursor = 'default'
  layoutAndRender()
  return true
}

function updateStageRotationFromPointer() {
  stage.rotation.x = STAGE_ROTATION_X + pointer.y * POINTER_ROTATION_X
  stage.rotation.y = STAGE_ROTATION_Y + pointer.x * POINTER_ROTATION_Y
}

function handlePointerMove(event: PointerEvent) {
  const bounds = sceneCanvas.getBoundingClientRect()
  pointer.x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1
  pointer.y = -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1)
  updateStageRotationFromPointer()
  raycaster.setFromCamera(pointer, camera)

  const hit = raycaster.intersectObjects(tiles.map((tile) => tile.hitMesh), false)[0]
  const tile = hit ? tiles.find((tile) => tile.hitMesh === hit.object) : undefined
  const didChangeHover = setHoveredTile(tile ? { panelIndex: tile.panelIndex, tileIndex: tile.tileIndex } : null)
  if (!didChangeHover && animationFrameId === null) {
    renderCurrentLayout()
  }
}

sceneCanvas.addEventListener('pointermove', handlePointerMove)
sceneCanvas.addEventListener('pointerleave', () => {
  pointer.set(0, 0)
  updateStageRotationFromPointer()
  const didChangeHover = setHoveredTile(null)
  if (!didChangeHover && animationFrameId === null) {
    renderCurrentLayout()
  }
})
window.addEventListener('resize', () => layoutAndRender({ immediate: true }))
window.addEventListener('pagehide', () => {
  finishAnimation()
  layoutEngine.dispose()
  for (const panel of panels) {
    panel.title.mesh.geometry.dispose()
    panel.title.mesh.material.dispose()
    panel.background.mesh.geometry.dispose()
    panel.background.mesh.material.dispose()
    for (const tile of panel.tiles) {
      tile.mesh.geometry.dispose()
      tile.mesh.material.dispose()
    }
  }
  hitProxyGeometry.dispose()
  hitProxyMaterial.dispose()
  environmentMap.background.dispose()
  environmentMap.renderTarget.dispose()
  renderer.dispose()
})

try {
  layoutAndRender({ immediate: true })
} catch (error) {
  console.error(error)
  showMessage(error instanceof Error ? error.message : 'Unable to start the Three.js layout demo.')
}
