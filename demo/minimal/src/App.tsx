import { useState } from 'react'
import { Leva } from 'leva'
import './App.css'
import AnimationDemo from './demos/AnimationDemo'
import DomMeasurementDemo from './demos/DomMeasurementDemo'
import DraggableGlassDemo from './demos/DraggableGlassDemo'
import HtmlLayersDemo from './demos/HtmlLayersDemo'
import LayoutSceneDemo from './demos/LayoutSceneDemo'
import PointerEventsDemo from './demos/PointerEventsDemo'
import SdfOverlapDemo from './demos/SdfOverlapDemo'
import SimpleLayoutSceneDemo from './demos/SimpleLayoutSceneDemo'
import TinyGlassDemo from './demos/TinyGlassDemo'
import type { DemoTab } from './demos/shared'

export default function App() {
  const [activeDemo, setActiveDemo] = useState<DemoTab>('tiny')

  return (
    <main className="minimal-app">
      <div className="app-shell">
        <aside className="demo-sidebar">
          <div className="demo-tabs" role="tablist" aria-orientation="vertical">
            <button
              type="button"
              role="tab"
              aria-selected={activeDemo === 'tiny'}
              className={activeDemo === 'tiny' ? 'demo-tab active' : 'demo-tab'}
              onClick={() => setActiveDemo('tiny')}
            >
              <span>Tiny glass</span>
              <small>HTML backdrop, HTML content, width slider</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDemo === 'draggable-glass'}
              className={activeDemo === 'draggable-glass' ? 'demo-tab active' : 'demo-tab'}
              onClick={() => setActiveDemo('draggable-glass')}
            >
              <span>Draggable glass</span>
              <small>Single rounded glass rectangle, drag to reposition</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDemo === 'layout-simple'}
              className={activeDemo === 'layout-simple' ? 'demo-tab active' : 'demo-tab'}
              onClick={() => setActiveDemo('layout-simple')}
            >
              <span>Simple layout</span>
              <small>One VStack, three HStacks, nine glass nodes</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDemo === 'sdf-overlap'}
              className={activeDemo === 'sdf-overlap' ? 'demo-tab active' : 'demo-tab'}
              onClick={() => setActiveDemo('sdf-overlap')}
            >
              <span>SDF overlap</span>
              <small>Two rounded rectangles, negative distance, spacing slider</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDemo === 'dom-measurement'}
              className={activeDemo === 'dom-measurement' ? 'demo-tab active' : 'demo-tab'}
              onClick={() => setActiveDemo('dom-measurement')}
            >
              <span>DOM measurement</span>
              <small>Intrinsic sizing, fixed axes, and DOM observation</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDemo === 'animation'}
              className={activeDemo === 'animation' ? 'demo-tab active' : 'demo-tab'}
              onClick={() => setActiveDemo('animation')}
            >
              <span>Animation</span>
              <small>Spring transitions, imperative refs, and timeline playback</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDemo === 'layout'}
              className={activeDemo === 'layout' ? 'demo-tab active' : 'demo-tab'}
              onClick={() => setActiveDemo('layout')}
            >
              <span>Layout scene</span>
              <small>Layout tree driving glass scene nodes</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDemo === 'pointer'}
              className={activeDemo === 'pointer' ? 'demo-tab active' : 'demo-tab'}
              onClick={() => setActiveDemo('pointer')}
            >
              <span>Pointer events</span>
              <small>Per-glass hit testing and DOM coexistence</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDemo === 'html'}
              className={activeDemo === 'html' ? 'demo-tab active' : 'demo-tab'}
              onClick={() => setActiveDemo('html')}
            >
              <span>HTML layers</span>
              <small>Scene Html layers and multiple glass Html children</small>
            </button>
          </div>
        </aside>

        <section className="demo-content">
          {activeDemo === 'tiny' ? (
            <TinyGlassDemo />
          ) : activeDemo === 'draggable-glass' ? (
            <DraggableGlassDemo />
          ) : activeDemo === 'sdf-overlap' ? (
            <SdfOverlapDemo />
          ) : activeDemo === 'layout-simple' ? (
            <SimpleLayoutSceneDemo />
          ) : activeDemo === 'dom-measurement' ? (
            <DomMeasurementDemo />
          ) : activeDemo === 'animation' ? (
            <AnimationDemo />
          ) : activeDemo === 'layout' ? (
            <LayoutSceneDemo />
          ) : activeDemo === 'pointer' ? (
            <PointerEventsDemo />
          ) : (
            <HtmlLayersDemo />
          )}
        </section>

        <aside className="leva-sidebar">
          <Leva
            fill
            flat
            collapsed={false}
            oneLineLabels
            titleBar={false}
            theme={{
              colors: {
                elevation1: 'transparent',
              }
            }}
          />
        </aside>
      </div>
    </main>
  )
}
