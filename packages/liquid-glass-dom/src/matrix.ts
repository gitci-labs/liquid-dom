import type { Transform } from './types'

export type Matrix2D = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export function identityMatrix(): Matrix2D {
  return {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
  }
}

function multiply(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

function translationMatrix(x: number, y: number): Matrix2D {
  return {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: x,
    f: y,
  }
}

function scaleMatrix(x: number, y: number): Matrix2D {
  return {
    a: x,
    b: 0,
    c: 0,
    d: y,
    e: 0,
    f: 0,
  }
}

function rotationMatrix(rotation: number): Matrix2D {
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)

  return {
    a: cosine,
    b: sine,
    c: -sine,
    d: cosine,
    e: 0,
    f: 0,
  }
}

export function composeTransform(transform: Transform): Matrix2D {
  return multiply(
    translationMatrix(transform.x, transform.y),
    multiply(
      translationMatrix(transform.origin.x, transform.origin.y),
      multiply(
        rotationMatrix(transform.rotation),
        multiply(
          scaleMatrix(transform.scaleX, transform.scaleY),
          translationMatrix(-transform.origin.x, -transform.origin.y),
        ),
      ),
    ),
  )
}

export function multiplyMatrices(left: Matrix2D, right: Matrix2D): Matrix2D {
  return multiply(left, right)
}

export function invertMatrix(matrix: Matrix2D): Matrix2D | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (Math.abs(determinant) < 0.000001) {
    return null
  }

  const inverseDeterminant = 1 / determinant

  return {
    a: matrix.d * inverseDeterminant,
    b: -matrix.b * inverseDeterminant,
    c: -matrix.c * inverseDeterminant,
    d: matrix.a * inverseDeterminant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) * inverseDeterminant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) * inverseDeterminant,
  }
}

export function scaleOutputMatrix(matrix: Matrix2D, factor: number): Matrix2D {
  return {
    a: matrix.a * factor,
    b: matrix.b * factor,
    c: matrix.c * factor,
    d: matrix.d * factor,
    e: matrix.e * factor,
    f: matrix.f * factor,
  }
}

export function getMinimumScale(matrix: Matrix2D): number {
  const scaleX = Math.hypot(matrix.a, matrix.b)
  const scaleY = Math.hypot(matrix.c, matrix.d)
  return Math.max(Math.min(scaleX, scaleY), 0.0001)
}
