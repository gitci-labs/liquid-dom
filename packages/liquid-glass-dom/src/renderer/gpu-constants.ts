/** Numeric GPUBufferUsage flags used without relying on DOM runtime globals. */
export const GPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  COPY_DST: 0x0008,
} as const

/** Numeric GPUTextureUsage flags used without relying on DOM runtime globals. */
export const GPU_TEXTURE_USAGE = {
  COPY_SRC: 0x01,
  TEXTURE_BINDING: 0x04,
  COPY_DST: 0x02,
  RENDER_ATTACHMENT: 0x10,
} as const
