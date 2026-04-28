import type { Glass, Html } from '../scene'
import type { Matrix2D } from '../matrix'

/** Padding in atlas pixels around each HTML content copy to reduce edge bleeding. */
export const CONTENT_ATLAS_PADDING = 1

/** Runtime metadata for one HTML node packed into the glass content atlas. */
export type GlassContentEntry = {
  html: Html
  glass: Glass
  elementVersion: number
  width: number
  height: number
  deviceWidth: number
  deviceHeight: number
  copiedDeviceWidth: number
  copiedDeviceHeight: number
  atlasX: number
  atlasY: number
  inverseTransform: Matrix2D
}

/** Pixel-space rectangle assigned to one content entry inside the atlas. */
type ContentLayoutRect = {
  x: number
  y: number
}

/** Result of packing glass-attached HTML nodes into a single atlas texture. */
export type ContentAtlasLayout = {
  width: number
  height: number
  rects: Map<Html, ContentLayoutRect>
}

/** Returns the smallest power of two greater than or equal to the value. */
function nextPowerOfTwo(value: number) {
  let next = 1
  while (next < value) {
    next *= 2
  }
  return next
}

/**
 * Buckets a required device-pixel size to the texture allocation size used for
 * resize stability.
 */
export function getTextureBucketSize(requiredSize: number, maxTextureSize = Number.POSITIVE_INFINITY) {
  if (requiredSize > maxTextureSize) {
    throw new Error(`Texture size ${requiredSize} exceeds the maximum supported size ${maxTextureSize}.`)
  }

  return Math.min(nextPowerOfTwo(Math.max(1, requiredSize)), maxTextureSize)
}

/** Attempts row-based packing for a fixed atlas width. */
function tryPackContentAtlas(entries: GlassContentEntry[], atlasWidth: number) {
  const rects = new Map<Html, ContentLayoutRect>()
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const entry of entries) {
    const rectWidth = getTextureBucketSize(entry.deviceWidth) + CONTENT_ATLAS_PADDING * 2
    const rectHeight = getTextureBucketSize(entry.deviceHeight) + CONTENT_ATLAS_PADDING * 2

    if (rectWidth > atlasWidth) {
      return null
    }

    if (cursorX > 0 && cursorX + rectWidth > atlasWidth) {
      cursorX = 0
      cursorY += rowHeight
      rowHeight = 0
    }

    rects.set(entry.html, {
      x: cursorX,
      y: cursorY,
    })

    cursorX += rectWidth
    rowHeight = Math.max(rowHeight, rectHeight)
  }

  return {
    width: atlasWidth,
    height: cursorY + rowHeight,
    rects,
  }
}

/**
 * Packs glass-attached HTML entries into a power-of-two atlas that fits within
 * the device texture limit.
 */
export function packContentAtlas(entries: GlassContentEntry[], maxTextureSize: number): ContentAtlasLayout {
  if (entries.length === 0) {
    throw new Error('Cannot build a glass content atlas without any content entries.')
  }

  let maxEntryWidth = 1
  for (const entry of entries) {
    maxEntryWidth = Math.max(maxEntryWidth, getTextureBucketSize(entry.deviceWidth) + CONTENT_ATLAS_PADDING * 2)
  }

  let atlasWidth = nextPowerOfTwo(maxEntryWidth)
  while (atlasWidth <= maxTextureSize) {
    const layout = tryPackContentAtlas(entries, atlasWidth)
    if (layout) {
      const atlasHeight = nextPowerOfTwo(layout.height)
      if (atlasHeight <= maxTextureSize) {
        return {
          ...layout,
          height: atlasHeight,
        }
      }
    }

    atlasWidth *= 2
  }

  throw new Error('Glass content atlas exceeds the maximum supported texture size.')
}
