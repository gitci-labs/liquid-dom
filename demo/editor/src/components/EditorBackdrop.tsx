import heroImage from '../assets/hero.png'
import backgroundImage from '../assets/background.jpg'
import backgroundTwoImage from '../assets/background2.jpg'
import backgroundThreeImage from '../assets/background3.jpg'

export function EditorBackdrop() {
  return (
    <div className="editor-backdrop">
      <section className="editor-backdrop__hero">
        <div>
          <p className="editor-backdrop__eyebrow">liquid-glass-dom</p>
          <h1>Scene Graph Editor</h1>
          <p className="editor-backdrop__lede">
            Build nested groups, layered containers, and stylized glass shapes with the imperative
            API.
          </p>
        </div>
        <div className="editor-backdrop__badge">HTML painted into canvas</div>
      </section>
      <section className="editor-backdrop__feature">
        <div className="editor-backdrop__feature-copy">
          <p className="editor-backdrop__kicker">Oversized DOM Surface</p>
          <h2>Scroll the underlying HTML and let the glass sample live content.</h2>
          <p className="editor-backdrop__body editor-backdrop__body--large">
            This editor backdrop is intentionally taller than the viewport so the canvas child is a
            real scroll container rather than a static poster. The renderer paints this DOM subtree
            into the background texture and the glass containers refract that result.
          </p>
        </div>
        <img className="editor-backdrop__feature-image" src={heroImage} alt="Liquid glass hero" />
      </section>
      <section className="editor-backdrop__grid">
        <article className="editor-backdrop__card editor-backdrop__card--warm">
          <span>Hierarchy</span>
          <strong>Group transforms cascade to all descendants.</strong>
        </article>
        <article className="editor-backdrop__card editor-backdrop__card--cool">
          <span>Layering</span>
          <strong>Containers refract and reflect previously rendered layers.</strong>
        </article>
        <article className="editor-backdrop__card editor-backdrop__card--mint">
          <span>Profiles</span>
          <strong>Convex squircle, concave, and lip surface response.</strong>
        </article>
        <article className="editor-backdrop__card editor-backdrop__card--violet">
          <span>Specular</span>
          <strong>Direct control over strength, width, sharpness, and color behavior.</strong>
        </article>
      </section>
      <section className="editor-backdrop__ticker" aria-label="Feature list">
        <span>Scene</span>
        <span>Groups</span>
        <span>Containers</span>
        <span>Glass</span>
        <span>Transforms</span>
        <span>Layering</span>
        <span>Surface Profiles</span>
        <span>Specular</span>
      </section>
      <section className="editor-backdrop__story">
        <div>
          <p className="editor-backdrop__kicker">Mixed Scale Typography</p>
          <h2>Containers are layered independently, but their shapes still melt together inside each layer.</h2>
          <p className="editor-backdrop__body">
            A <strong>Container</strong> acts as one blended SDF field. Multiple glass shapes
            inside the same container fuse according to spacing, while separate containers stack by
            z-index and see the already-rendered result beneath them.
          </p>
          <p className="editor-backdrop__body">
            That makes the scene graph useful for both composition and rendering semantics. Groups
            are only about transform hierarchy; containers define the actual optical layer.
          </p>
        </div>
        <aside className="editor-backdrop__quote">
          <p>“The useful part of the API is not just the shader. It is the scene graph.”</p>
        </aside>
      </section>
      <section className="editor-backdrop__gallery">
        <figure className="editor-backdrop__photo editor-backdrop__photo--wide">
          <img src={backgroundImage} alt="Colorful collage background" />
          <figcaption>Dense color fields are useful for judging refraction and dispersion.</figcaption>
        </figure>
        <figure className="editor-backdrop__photo">
          <img src={backgroundTwoImage} alt="Alternative backdrop" />
          <figcaption>Use higher contrast regions to inspect specular falloff and tint.</figcaption>
        </figure>
        <figure className="editor-backdrop__photo">
          <img src={backgroundThreeImage} alt="Third backdrop" />
          <figcaption>Busy imagery makes overlap bugs in layered containers immediately visible.</figcaption>
        </figure>
      </section>
      <section className="editor-backdrop__columns">
        <article>
          <p className="editor-backdrop__kicker">Surface Model</p>
          <h3>Bezel width, thickness, IOR, and dispersion all push the displacement path.</h3>
          <p className="editor-backdrop__body">
            The surface profile defines the derivative used to build the beveled normal. From there
            the shader computes refraction and samples the underlying blurred texture, with optional
            edge color and reflection behavior layered on top.
          </p>
        </article>
        <article>
          <p className="editor-backdrop__kicker">Stylistic Highlighting</p>
          <h3>Narrow highlights live on the rim band rather than across the flat interior.</h3>
          <p className="editor-backdrop__body">
            Width and sharpness control the falloff. Opacity is applied after the specular response
            is computed, which keeps the overdriven look available without forcing the highlight to
            stay fully opaque.
          </p>
        </article>
        <article>
          <p className="editor-backdrop__kicker">Transform Hierarchy</p>
          <h3>Origins, rotation, scaling, and translation compose exactly like DOM transforms.</h3>
          <p className="editor-backdrop__body">
            The public coordinate system is top-left-origin with positive Y moving downward, matching
            the HTML content underneath. That keeps the editor and the library API aligned.
          </p>
        </article>
      </section>
      <section className="editor-backdrop__footer">
        <p className="editor-backdrop__kicker">Deep Scroll Region</p>
        <h2>Keep scrolling.</h2>
        <p className="editor-backdrop__body editor-backdrop__body--large">
          This last section exists mostly to guarantee overflow and make the backdrop behave like a
          document instead of a splash screen. If the glass still tracks and refracts correctly
          while this content scrolls, the DOM-in-canvas path is doing real work.
        </p>
      </section>
    </div>
  )
}
