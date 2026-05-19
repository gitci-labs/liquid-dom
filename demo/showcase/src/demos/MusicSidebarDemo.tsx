import { useState } from 'react'
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
  Album,
  Clock3,
  Grid2X2,
  Grid3X3,
  House,
  MicVocal,
  Music,
  Radio,
  Search,
  SquareUserRound,
  Star,
  type LucideIcon,
} from 'lucide-react'
import styles from './MusicSidebarDemo.module.css'

const SIDEBAR_WIDTH = 260
const SIDEBAR_HEIGHT = 486
const SIDEBAR_X = -298

type SidebarItem = {
  Icon: LucideIcon
  label: string
  active?: boolean
}

const primaryItems: SidebarItem[] = [
  { Icon: Search, label: 'Search' },
  { Icon: House, label: 'Home', active: true },
  { Icon: Grid2X2, label: 'New' },
  { Icon: Radio, label: 'Radio' },
]

const libraryItems: SidebarItem[] = [
  { Icon: Clock3, label: 'Recently Added' },
  { Icon: MicVocal, label: 'Artists' },
  { Icon: Album, label: 'Albums' },
  { Icon: Music, label: 'Songs' },
  { Icon: SquareUserRound, label: 'Made for You' },
]

const playlistItems: SidebarItem[] = [
  { Icon: Grid3X3, label: 'All Playlists' },
  { Icon: Star, label: 'Favourite Songs' },
]

const albums = [
  { title: 'Low Tide', artist: 'June Static', color: '#ff6d00' },
  { title: 'After Hours', artist: 'Sora Lane', color: '#e91e63' },
  { title: 'Signal Drift', artist: 'Northstar', color: '#00a8ff' },
  { title: 'Night Run', artist: 'Ari Sol', color: '#304ffe' },
  { title: 'Lunar Echoes', artist: 'Mika Vale', color: '#8e24ff' },
  { title: 'Soft Focus', artist: 'Kite Club', color: '#00c853' },
  { title: 'Blue Rooms', artist: 'Vela Park', color: '#0091ea' },
  { title: 'Glasshouse', artist: 'Mara Vale', color: '#d500f9' },
  { title: 'Still Motion', artist: 'Canyon Air', color: '#ff1744' },
  { title: 'Wide Awake', artist: 'Studio North', color: '#00b8d4' },
  { title: 'Quiet Color', artist: 'Lina Grey', color: '#6200ea' },
  { title: 'Relay', artist: 'The Forms', color: '#ffab00' },
  { title: 'Bright Field', artist: 'Owen Night', color: '#64dd17' },
  { title: 'Parallel', artist: 'Nia Coast', color: '#00bfa5' },
  { title: 'Late Bloom', artist: 'Orchid Room', color: '#c51162' },
  { title: 'Static Blue', artist: 'Civic Light', color: '#2962ff' },
  { title: 'Morning Wire', artist: 'Nova House', color: '#ff3d00' },
  { title: 'Open Channel', artist: 'Echo Base', color: '#00e5ff' },
  { title: 'Red Line', artist: 'Metro Bloom', color: '#f50057' },
  { title: 'Neon Lake', artist: 'Cassia Blue', color: '#00e676' },
  { title: 'Cold Spark', artist: 'Luma Field', color: '#651fff' },
  { title: 'Fast Silver', artist: 'Aster Run', color: '#ffd600' },
  { title: 'Second Sun', artist: 'Violet Hour', color: '#ff9100' },
  { title: 'City Sleep', artist: 'Harbor Nine', color: '#2979ff' },
  { title: 'Pink Noise', artist: 'Rhea Station', color: '#ff4081' },
  { title: 'Green Room', artist: 'Atlas Pine', color: '#1de9b6' },
  { title: 'Future Past', artist: 'The Signal', color: '#aa00ff' },
  { title: 'Sun Cut', artist: 'Milo Vale', color: '#ffea00' },
  { title: 'Blacktop', artist: 'Night Palace', color: '#3d5afe' },
  { title: 'True North', artist: 'Sable Coast', color: '#00b0ff' },
  { title: 'Hot Glass', artist: 'Kira Moon', color: '#ff1744' },
  { title: 'Clear Static', artist: 'Mono Drive', color: '#76ff03' },
]

export default function MusicSidebarDemo() {
  return (
    <section className={styles.root}>
      <LiquidCanvas
        className={styles.canvasShell}
        canvasClassName={styles.canvas}
      >
        <ZStack alignment="center">
          <Html zIndex={-2} sizing="fill">
            <main className={styles.backdrop}>
              <AlbumGrid />
            </main>
          </Html>

          <Frame maxWidth={Infinity} maxHeight={Infinity}>
            <GlassContainer
              blur={200}
              bezelWidth={170}
              displacementBlur={25}
              thickness={0}
              // debugDisplacement
              shadowColor={{ r: 0, g: 0, b: 0, a: 0.28 }}
              shadowBlur={30}
              specularOpacity={0.3}
              surfaceProfile='concave'
              specularFalloff={2}
              tint={{ r: 0.15, g: 0.15, b: 0.15, a: 0.7 }}
            >
              <Transform x={SIDEBAR_X}>
                <Glass cornerRadius={50}>
                  <Frame width={SIDEBAR_WIDTH} height={SIDEBAR_HEIGHT}>
                    <Html sizing="fill">
                      <Sidebar />
                    </Html>
                  </Frame>
                </Glass>
              </Transform>
            </GlassContainer>
          </Frame>
        </ZStack>
      </LiquidCanvas>
    </section>
  )
}

function Sidebar() {
  const [selectedItem, setSelectedItem] = useState('Home')

  return (
    <nav className={styles.sidebarContent} aria-label="Music navigation">
      <SidebarGroup
        items={primaryItems}
        selectedItem={selectedItem}
        onSelect={setSelectedItem}
      />
      <SidebarGroup
        title="Library"
        items={libraryItems}
        selectedItem={selectedItem}
        onSelect={setSelectedItem}
      />
      <SidebarGroup
        title="Playlists"
        items={playlistItems}
        selectedItem={selectedItem}
        onSelect={setSelectedItem}
      />
    </nav>
  )
}

function SidebarGroup({
  title,
  items,
  selectedItem,
  onSelect,
}: {
  title?: string
  items: SidebarItem[]
  selectedItem: string
  onSelect: (label: string) => void
}) {
  return (
    <div className={styles.sidebarGroup}>
      {title ? <div className={styles.groupTitle}>{title}</div> : null}
      {items.map((item) => (
        <button
          key={item.label}
          className={[
            styles.sidebarItem,
            item.label === selectedItem ? styles.sidebarItemActive : '',
          ].join(' ')}
          type="button"
          aria-current={item.label === selectedItem ? 'page' : undefined}
          onClick={() => onSelect(item.label)}
        >
          <item.Icon className={styles.icon} aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

function AlbumGrid() {
  return (
    <section className={styles.albumGrid} aria-label="Albums">
      {albums.map((album) => (
        <article key={album.title} className={styles.albumCard}>
          <div className={styles.albumArt} style={{ backgroundColor: album.color }} />
          <div className={styles.albumTitle}>{album.title}</div>
          <div className={styles.albumArtist}>{album.artist}</div>
        </article>
      ))}
    </section>
  )
}
