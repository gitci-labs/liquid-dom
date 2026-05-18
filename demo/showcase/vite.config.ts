import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const liquidCoreDist = fileURLToPath(new URL('../../packages/core/dist', import.meta.url))
const liquidR3FDist = fileURLToPath(new URL('../../packages/r3f/dist', import.meta.url))
const liquidReactDist = fileURLToPath(new URL('../../packages/react/dist', import.meta.url))
const liquidThreeDist = fileURLToPath(new URL('../../packages/three/dist', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ['@liquid-dom/core', '@liquid-dom/react', '@liquid-dom/r3f', '@liquid-dom/three'],
  },
  server: {
    host: '0.0.0.0',
    watch: {
      ignored: [
        `!${liquidCoreDist}/**`,
        `!${liquidReactDist}/**`,
        `!${liquidR3FDist}/**`,
        `!${liquidThreeDist}/**`,
      ],
    },
  },
})
