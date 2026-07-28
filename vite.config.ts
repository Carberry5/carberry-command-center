import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const SIDECAR = process.env.SIDECAR_URL || 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to 0.0.0.0 so the iPad and the TV browser can reach the dev server
    // over the wifi, which is the whole point of the home-server setup.
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: SIDECAR, changeOrigin: true },
      // Server-sent events for live vault changes — must not be buffered.
      '/events': { target: SIDECAR, changeOrigin: true, ws: false },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
