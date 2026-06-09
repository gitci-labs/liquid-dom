import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const liquidGlassDomDist = fileURLToPath(
  new URL('../../packages/core/dist', import.meta.url),
)

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@liquid-dom/core'],
  },
  server: {
    watch: {
      ignored: [`!${liquidGlassDomDist}/**`],
    },
  },
})
