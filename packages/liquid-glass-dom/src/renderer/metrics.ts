import type { BackdropMetrics } from '../types'

/** Width and height, in pixels, of the low-resolution backdrop metrics target. */
export const BACKDROP_METRICS_SIZE = 32
/** Required row stride for copying the metrics texture into a readback buffer. */
export const BACKDROP_METRICS_BYTES_PER_ROW = 256
/** Total byte size of the backdrop metrics readback buffer. */
export const BACKDROP_METRICS_BUFFER_SIZE = BACKDROP_METRICS_BYTES_PER_ROW * BACKDROP_METRICS_SIZE

/** Axis-aligned device-pixel bounds used to restrict metrics and blur work. */
export type BoundsRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Restricts a number to an inclusive range. */
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** Creates an initially empty bounds accumulator. */
export function createEmptyBounds(): BoundsRect {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  }
}

/** Expands a bounds accumulator to include one point. */
export function expandBounds(bounds: BoundsRect, x: number, y: number) {
  bounds.minX = Math.min(bounds.minX, x)
  bounds.minY = Math.min(bounds.minY, y)
  bounds.maxX = Math.max(bounds.maxX, x)
  bounds.maxY = Math.max(bounds.maxY, y)
}

/** Returns whether a bounds accumulator contains a finite non-empty area. */
export function hasBounds(bounds: BoundsRect) {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    bounds.maxX > bounds.minX &&
    bounds.maxY > bounds.minY
  )
}

/** Computes a linearly interpolated percentile from a sorted numeric array. */
function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0
  }

  if (values.length === 1) {
    return values[0]
  }

  const index = clamp((values.length - 1) * p, 0, values.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const blend = index - lower
  return values[lower] + (values[upper] - values[lower]) * blend
}

/**
 * Reads the mapped backdrop metrics buffer and summarizes color and luminance
 * over visible pixels.
 */
export function parseBackdropMetrics(buffer: GPUBuffer): BackdropMetrics | null {
  const bytes = new Uint8Array(buffer.getMappedRange())
  const luminances: number[] = []
  let red = 0
  let green = 0
  let blue = 0

  for (let y = 0; y < BACKDROP_METRICS_SIZE; y += 1) {
    const rowOffset = y * BACKDROP_METRICS_BYTES_PER_ROW

    for (let x = 0; x < BACKDROP_METRICS_SIZE; x += 1) {
      const offset = rowOffset + x * 4
      const alpha = bytes[offset + 3] / 255
      if (alpha <= 0.5) {
        continue
      }

      const linearRed = bytes[offset] / 255
      const linearGreen = bytes[offset + 1] / 255
      const linearBlue = bytes[offset + 2] / 255
      const luminance = linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722

      red += linearRed
      green += linearGreen
      blue += linearBlue
      luminances.push(luminance)
    }
  }

  if (luminances.length === 0) {
    return null
  }

  luminances.sort((left, right) => left - right)

  const count = luminances.length
  return {
    averageLinearColor: {
      r: red / count,
      g: green / count,
      b: blue / count,
    },
    averageLuminance: luminances.reduce((sum, value) => sum + value, 0) / count,
    luminanceP10: percentile(luminances, 0.1),
    luminanceP50: percentile(luminances, 0.5),
    luminanceP90: percentile(luminances, 0.9),
  }
}
