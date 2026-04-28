const FLOATS_PER_VEC4 = 4
const BYTES_PER_FLOAT = Float32Array.BYTES_PER_ELEMENT

// Keeps WGSL vec4-lane structs and TypeScript buffer writes on the same schema.
type Vec4Definition<Fields extends readonly string[]> = {
  readonly type: 'vec4f'
  readonly fields: Fields
}

export type StructDefinition = Record<string, Vec4Definition<readonly string[]>>

type StructValues<Definition extends StructDefinition> = {
  [Lane in keyof Definition]: Record<Definition[Lane]['fields'][number], number>
}

export type GpuStructDefinition<Layout extends GpuStructLayout<StructDefinition>> =
  Layout extends GpuStructLayout<infer Definition> ? Definition : never

export type GpuStructLayout<Definition extends StructDefinition> = {
  readonly floatCount: number
  readonly byteSize: number
  createArray(count?: number): Float32Array
  wgsl(name: string): string
  write(target: Float32Array, values: StructValues<Definition>): void
  writeAt(target: Float32Array, index: number, values: StructValues<Definition>): void
}

export function vec4<const Fields extends readonly string[]>(...fields: Fields): Vec4Definition<Fields> {
  if (fields.length > FLOATS_PER_VEC4) {
    throw new Error('A vec4 layout lane cannot contain more than four fields.')
  }

  return {
    type: 'vec4f',
    fields,
  }
}

export function structLayout<const Definition extends StructDefinition>(
  definition: Definition,
): GpuStructLayout<Definition> {
  const lanes = Object.keys(definition) as Array<keyof Definition & string>
  const floatCount = lanes.length * FLOATS_PER_VEC4
  const byteSize = floatCount * BYTES_PER_FLOAT
  const writeAt = (target: Float32Array, index: number, values: StructValues<Definition>) => {
    const baseOffset = index * floatCount
    if (baseOffset < 0 || baseOffset + floatCount > target.length) {
      throw new RangeError('GPU struct write is outside the target buffer.')
    }

    target.fill(0, baseOffset, baseOffset + floatCount)
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const lane = lanes[laneIndex]
      const fields = definition[lane].fields
      const laneValues = values[lane] as Record<string, number>
      const laneOffset = baseOffset + laneIndex * FLOATS_PER_VEC4

      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
        target[laneOffset + fieldIndex] = laneValues[fields[fieldIndex]]
      }
    }
  }

  return {
    floatCount,
    byteSize,

    createArray(count = 1) {
      return new Float32Array(Math.max(count, 1) * floatCount)
    },

    wgsl(name: string) {
      const members = lanes.map((lane) => `  ${lane}: vec4f,`).join('\n')
      return `struct ${name} {\n${members}\n};`
    },

    write(target: Float32Array, values: StructValues<Definition>) {
      writeAt(target, 0, values)
    },

    writeAt,
  }
}

export class GpuStructBuffer<Definition extends StructDefinition> {
  readonly data: Float32Array
  readonly buffer: GPUBuffer

  constructor(
    private readonly device: GPUDevice,
    private readonly layout: GpuStructLayout<Definition>,
    usage: GPUBufferUsageFlags,
  ) {
    this.data = layout.createArray()
    this.buffer = device.createBuffer({
      size: layout.byteSize,
      usage,
    })
  }

  get bindingResource(): GPUBindingResource {
    return { buffer: this.buffer }
  }

  write(values: StructValues<Definition>) {
    this.layout.write(this.data, values)
    this.device.queue.writeBuffer(this.buffer, 0, this.data)
  }

  destroy() {
    this.buffer.destroy()
  }
}

export class GpuStructArrayBuffer<Definition extends StructDefinition> {
  data: Float32Array
  buffer: GPUBuffer | null = null
  capacity = 0

  constructor(
    private readonly device: GPUDevice,
    private readonly layout: GpuStructLayout<Definition>,
    private readonly usage: GPUBufferUsageFlags,
  ) {
    this.data = layout.createArray()
  }

  get bindingResource(): GPUBindingResource {
    if (!this.buffer) {
      throw new Error('GPU struct array buffer has not been allocated.')
    }

    return { buffer: this.buffer }
  }

  ensureCapacity(requiredCount: number) {
    const nextCapacity = Math.max(requiredCount, 1)
    if (this.buffer && nextCapacity <= this.capacity) {
      return
    }

    this.buffer?.destroy()
    this.buffer = this.device.createBuffer({
      size: nextCapacity * this.layout.byteSize,
      usage: this.usage,
    })
    this.data = this.layout.createArray(nextCapacity)
    this.capacity = nextCapacity
  }

  writeAt(index: number, values: StructValues<Definition>) {
    this.layout.writeAt(this.data, index, values)
  }

  upload(count: number) {
    if (!this.buffer) {
      return
    }

    this.device.queue.writeBuffer(
      this.buffer,
      0,
      this.data,
      0,
      Math.max(count, 1) * this.layout.floatCount,
    )
  }

  destroy() {
    this.buffer?.destroy()
    this.buffer = null
    this.capacity = 0
  }
}
