import { Leaf } from './layouts'
import type { ProposedSize, Size } from './types'

export type DomLeafSizing = 'intrinsic' | 'constrained-width' | 'fill'

export type DomMeasureOptions = {
  sizing?: DomLeafSizing
}

export type DomLeafOptions = DomMeasureOptions & {
  element: HTMLElement
  measureKey?: unknown
}

export class DomLeaf extends Leaf {
  private _element: HTMLElement
  private _sizing: DomLeafSizing
  private cleanup: (() => void) | undefined

  constructor(options: DomLeafOptions) {
    super({
      measureKey: options.measureKey ?? domMeasureKey(options.element, options),
    })
    this._element = options.element
    this._sizing = options.sizing ?? 'intrinsic'
  }

  get element(): HTMLElement {
    return this._element
  }

  set element(value: HTMLElement) {
    if (this._element === value) return
    this.stopObserving()
    this._element = value
    if (this.isLayoutActive()) this.startObserving()
    this.invalidateMeasure('element')
  }

  get sizing(): DomLeafSizing {
    return this._sizing
  }

  set sizing(value: DomLeafSizing | undefined) {
    const next = value ?? 'intrinsic'
    if (this._sizing === next) return
    this._sizing = next
    this.invalidateMeasure('sizing')
  }

  override dispose() {
    this.stopObserving()
    super.dispose()
  }

  protected override measureLeaf(proposal: ProposedSize): Size {
    return measureDomElement(this._element, proposal, { sizing: this._sizing })
  }

  protected override onLayoutActive(): void {
    this.startObserving()
  }

  protected override onLayoutInactive(): void {
    this.stopObserving()
  }

  private startObserving() {
    if (this.cleanup) return
    this.cleanup = subscribeDomElement(this._element, (cause) => this.invalidateMeasure(cause))
  }

  private stopObserving() {
    this.cleanup?.()
    this.cleanup = undefined
  }
}

export function measureDomElement(
  element: HTMLElement,
  proposal: ProposedSize = {},
  options: DomMeasureOptions = {},
): Size {
  const sizing = options.sizing ?? 'intrinsic'
  const proposedWidth = proposal.width
  const proposedHeight = proposal.height
  const acceptsWidth = (sizing === 'constrained-width' || sizing === 'fill') && proposedWidth !== undefined
  const acceptsHeight = sizing === 'fill' && proposedHeight !== undefined
  const acceptedWidth = acceptsWidth ? Math.max(0, proposedWidth!) : undefined
  const acceptedHeight = acceptsHeight ? Math.max(0, proposedHeight!) : undefined
  const wrapper = document.createElement('div')
  const clone = element.cloneNode(true) as HTMLElement
  clone.removeAttribute('id')
  wrapper.style.position = 'absolute'
  wrapper.style.visibility = 'hidden'
  wrapper.style.pointerEvents = 'none'
  wrapper.style.contain = 'layout style paint'
  wrapper.style.left = '-100000px'
  wrapper.style.top = '0'
  wrapper.style.display = 'inline-block'
  wrapper.style.width = 'max-content'
  wrapper.style.maxWidth = 'none'
  wrapper.style.height = 'auto'
  wrapper.style.maxHeight = 'none'
  clone.style.pointerEvents = 'none'
  clone.style.transform = 'none'

  if (acceptedWidth !== undefined) {
    const width = `${acceptedWidth}px`
    wrapper.style.width = width
    wrapper.style.maxWidth = width
    clone.style.width = width
    clone.style.maxWidth = width
  }

  if (acceptedHeight !== undefined) {
    const height = `${acceptedHeight}px`
    wrapper.style.height = height
    wrapper.style.maxHeight = height
    clone.style.height = height
    clone.style.maxHeight = height
  } else if (sizing === 'constrained-width' || acceptedWidth !== undefined) {
    clone.style.height = 'auto'
    clone.style.minHeight = element.style.minHeight
    clone.style.maxHeight = 'none'
  }

  clone.style.boxSizing = 'border-box'
  wrapper.append(clone)
  document.body.append(wrapper)

  const rect = clone.getBoundingClientRect()
  const wrapperRect = wrapper.getBoundingClientRect()
  const size = {
    width: acceptedWidth !== undefined
      ? acceptedWidth
      : (rect.width || clone.offsetWidth || clone.scrollWidth || wrapperRect.width || 0),
    height: acceptedHeight !== undefined
      ? acceptedHeight
      : (rect.height || clone.offsetHeight || clone.scrollHeight || wrapperRect.height || 0),
  }

  wrapper.remove()

  return size
}

export function subscribeDomElement(
  element: HTMLElement,
  notify: (cause?: unknown) => void,
): () => void {
  const cleanups: (() => void)[] = []
  let lastSize = readObservedSize(element)

  if ('ResizeObserver' in globalThis) {
    const observer = new ResizeObserver((entries) => {
      const nextSize = readObservedSize(element, entries[0])
      if (!sizeChanged(lastSize, nextSize)) return

      lastSize = nextSize
      notify('resize')
    })
    observer.observe(element)
    cleanups.push(() => observer.disconnect())
  }

  if ('MutationObserver' in globalThis) {
    const observer = new MutationObserver(() => notify('mutation'))
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['class', 'style'],
      characterData: true,
      childList: true,
      subtree: true,
    })
    cleanups.push(() => observer.disconnect())
  }

  const images = element instanceof HTMLImageElement ? [element] : [...element.querySelectorAll('img')]
  for (const image of images) {
    const listener = () => notify('image')
    image.addEventListener('load', listener)
    image.addEventListener('error', listener)
    cleanups.push(() => {
      image.removeEventListener('load', listener)
      image.removeEventListener('error', listener)
    })
  }

  const fonts = document.fonts
  if (fonts) {
    void fonts.ready.then(() => notify('font'))
    if ('addEventListener' in fonts && 'removeEventListener' in fonts) {
      const listener = () => notify('font')
      fonts.addEventListener('loadingdone', listener)
      fonts.addEventListener('loadingerror', listener)
      cleanups.push(() => {
        fonts.removeEventListener('loadingdone', listener)
        fonts.removeEventListener('loadingerror', listener)
      })
    }
  }

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}

function readObservedSize(element: HTMLElement, entry?: ResizeObserverEntry): Size {
  const borderBox = entry?.borderBoxSize
  const firstBorderBox = Array.isArray(borderBox) ? borderBox[0] : borderBox
  if (firstBorderBox) {
    return {
      width: firstBorderBox.inlineSize,
      height: firstBorderBox.blockSize,
    }
  }

  if (entry?.contentRect) {
    return {
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    }
  }

  const rect = element.getBoundingClientRect()
  return {
    width: rect.width || element.offsetWidth || element.scrollWidth,
    height: rect.height || element.offsetHeight || element.scrollHeight,
  }
}

function sizeChanged(left: Size, right: Size) {
  return Math.abs(left.width - right.width) > 0.5 || Math.abs(left.height - right.height) > 0.5
}

function domMeasureKey(element: HTMLElement, options: DomMeasureOptions) {
  return {
    sizing: options.sizing ?? 'intrinsic',
    className: element.className,
    textContent: element.textContent,
    inlineStyle: element.getAttribute('style'),
    childCount: element.childElementCount,
  }
}
