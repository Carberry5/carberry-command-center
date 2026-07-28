import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const SIDECAR = process.env.SIDECAR_URL || 'http://127.0.0.1:8787'

/**
 * A GitHub Pages project site is served from /<repo>/, not the domain root, so
 * asset URLs need that prefix. Cloudflare Pages and the dev server both serve
 * from the root, hence the default. The deploy workflow sets this.
 *
 * src/store/auth.tsx reads the same value back as import.meta.env.BASE_URL to
 * build the magic-link redirect, so the two cannot drift apart.
 */
const BASE = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base: BASE,
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
