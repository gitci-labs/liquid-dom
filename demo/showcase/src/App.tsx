import { type ComponentType, useState } from 'react'
import { Leva } from 'leva'
import SdfOverlapDemo from '../../minimal/src/demos/SdfOverlapDemo'
import IosNotificationDemo from './demos/IosNotificationDemo'
import VideoControlsDemo from './demos/VideoControlsDemo'
import styles from './App.module.css'

type Showcase = {
  id: string
  label: string
  Component: ComponentType
}

const showcases: Showcase[] = [
  { id: 'ios-notification', label: 'Notification', Component: IosNotificationDemo },
  { id: 'video-controls', label: 'Video Controls', Component: VideoControlsDemo },
  { id: 'sdf-overlap-b', label: 'Overlap B', Component: SdfOverlapDemo },
  { id: 'sdf-overlap-c', label: 'Overlap C', Component: SdfOverlapDemo },
]

export default function App() {
  const [selectedShowcaseId, setSelectedShowcaseId] = useState(showcases[0].id)
  const selectedShowcase =
    showcases.find((showcase) => showcase.id === selectedShowcaseId) ?? showcases[0]
  const SelectedShowcase = selectedShowcase.Component

  return (
    <>
      <Leva hidden />
      <main className={styles.root}>
        <aside
          aria-label="Showcases"
          className={styles.sidebar}
        >
          {showcases.map((showcase) => (
            <button
              key={showcase.id}
              className={[
                styles.sidebarButton,
                showcase.id === selectedShowcase.id ? styles.sidebarButtonActive : '',
              ].join(' ')}
              type="button"
              aria-pressed={showcase.id === selectedShowcase.id}
              onClick={() => setSelectedShowcaseId(showcase.id)}
            >
              {showcase.label}
            </button>
          ))}
        </aside>

        <section className={styles.showcaseFrame}>
          <SelectedShowcase key={selectedShowcase.id} />
        </section>
      </main>
    </>
  )
}
