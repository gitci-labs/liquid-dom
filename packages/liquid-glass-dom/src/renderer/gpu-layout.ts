const FLOATS_PER_VEC4 = 4
const BYTES_PER_FLOAT = Float32Array.BYTES_PER_ELEMENT

/** Definition for one vec4 lane in a generated WGSL/TypeScript struct. */
type Vec4Definition<Fields extends readonly string[]> = {
  readonly type: 'vec4f'
  readonly fields: Fields
}

/** Map of struct lane names to their vec4 field definitions. */
export type StructDefinition = Record<string, Vec4Definition<readonly string[]>>

/** Value object accepted by a typed GPU struct layout writer. */
type StructValues<Definition extends StructDefinition> = {
  [Lane in keyof Definition]: Record<Definition[Lane]['fields'][number], number>
}

/** Extracts the schema definition from a concrete GPU struct layout. */
export type GpuStructDefinition<Layout extends GpuStructLayout<StructDefinition>> =
  Layout extends GpuStructLayout<infer Definition> ? Definition : never

/** Shared schema object that can generate WGSL structs and pack matching data. */
export type GpuStructLayout<Definition extends StructDefinition> = {
  readonly floatCount: number
  readonly byteSize: number
  createArray(count?: number): Float32Array
  wgsl(name: string): string
  write(target: Float32Array, values: StructValues<Definition>): void
  writeAt(target: Float32Array, index: number, values: StructValues<Definition>): void
}

/** Declares a vec4 lane for a generated GPU struct layout. */
export function vec4<const Fields extends readonly string[]>(...fields: Fields): Vec4Definition<Fields> {
  if (fields.length > FLOATS_PER_VEC4) {
    throw new Error('A vec4 layout lane cannot contain more than four fields.')
  }

  return {
    type: 'vec4f',
    fields,
  }
}

/**
 * Creates a schema that keeps WGSL vec4-lane structs and TypeScript buffer
 * writes aligned.
 */
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

    /** Creates CPU-side storage for one or more struct values. */
    createArray(count = 1) {
      return new Float32Array(Math.max(count, 1) * floatCount)
    },

    /** Generates the WGSL struct declaration matching this layout. */
    wgsl(name: string) {
      const members = lanes.map((lane) => `  ${lane}: vec4f,`).join('\n')
      return `struct ${name} {\n${members}\n};`
    },

    /** Writes one struct value at the beginning of a target array. */
    write(target: Float32Array, values: StructValues<Definition>) {
      writeAt(target, 0, values)
    },

    /** Writes one struct value at a specific struct index in a target array. */
    writeAt,
  }
}

/** Fixed-size GPU buffer for one typed uniform or storage struct. */
export class GpuStructBuffer<Definition extends StructDefinition> {
  /** CPU-side staging data written before queue upload. */
  readonly data: Float32Array
  /** GPU buffer backing this struct. */
  readonly buffer: GPUBuffer

  /** Allocates the GPU buffer for the provided layout and usage flags. */
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

  /** Binding resource for a bind group entry. */
  get bindingResource(): GPUBindingResource {
    return { buffer: this.buffer }
  }

  /** Packs and uploads a complete struct value. */
  write(values: StructValues<Definition>) {
    this.layout.write(this.data, values)
    this.device.queue.writeBuffer(this.buffer, 0, this.data)
  }

  /** Destroys the underlying GPU buffer. */
  destroy() {
    this.buffer.destroy()
  }
}

/** Growable GPU buffer for arrays of typed structs. */
export class GpuStructArrayBuffer<Definition extends StructDefinition> {
  /** CPU-side staging data sized to the current capacity. */
  data: Float32Array
  /** GPU buffer backing the array, allocated on demand. */
  buffer: GPUBuffer | null = null
  /** Number of struct elements currently allocated. */
  capacity = 0

  /** Creates a growable struct-array buffer manager. */
  constructor(
    private readonly device: GPUDevice,
    private readonly layout: GpuStructLayout<Definition>,
    private readonly usage: GPUBufferUsageFlags,
  ) {
    this.data = layout.createArray()
  }

  /** Binding resource for a bind group entry. */
  get bindingResource(): GPUBindingResource {
    if (!this.buffer) {
      throw new Error('GPU struct array buffer has not been allocated.')
    }

    return { buffer: this.buffer }
  }

  /** Ensures the GPU and staging buffers can hold the requested element count. */
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

  /** Writes one struct value into the CPU-side staging array. */
  writeAt(index: number, values: StructValues<Definition>) {
    this.layout.writeAt(this.data, index, values)
  }

  /** Uploads the active prefix of the staging array to the GPU buffer. */
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

  /** Destroys the GPU buffer and resets allocation state. */
  destroy() {
    this.buffer?.destroy()
    this.buffer = null
    this.capacity = 0
  }
}
