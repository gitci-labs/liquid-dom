import type { Glass, Html } from '../scene'
import type { Matrix2D } from '../matrix'

export const CONTENT_ATLAS_PADDING = 1

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
  atlasWidth: number
  atlasHeight: number
  contentU: number
  contentV: number
  inverseTransform: Matrix2D
}

type ContentLayoutRect = {
  x: number
  y: number
  width: number
  height: number
}

export type ContentAtlasLayout = {
  width: number
  height: number
  rects: Map<Html, ContentLayoutRect>
}

function nextPowerOfTwo(value: number) {
  let next = 1
  while (next < value) {
    next *= 2
  }
  return next
}

function getContentBucketSize(requiredSize: number) {
  return nextPowerOfTwo(Math.max(1, requiredSize))
}

function tryPackContentAtlas(entries: GlassContentEntry[], atlasWidth: number) {
  const rects = new Map<Html, ContentLayoutRect>()
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const entry of entries) {
    const rectWidth = getContentBucketSize(entry.deviceWidth) + CONTENT_ATLAS_PADDING * 2
    const rectHeight = getContentBucketSize(entry.deviceHeight) + CONTENT_ATLAS_PADDING * 2

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
      width: rectWidth,
      height: rectHeight,
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

export function packContentAtlas(entries: GlassContentEntry[], maxTextureSize: number): ContentAtlasLayout {
  if (entries.length === 0) {
    throw new Error('Cannot build a glass content atlas without any content entries.')
  }

  let maxEntryWidth = 1
  for (const entry of entries) {
    maxEntryWidth = Math.max(maxEntryWidth, getContentBucketSize(entry.deviceWidth) + CONTENT_ATLAS_PADDING * 2)
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
