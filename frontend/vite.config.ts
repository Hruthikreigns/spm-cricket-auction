import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // The 3D chunk is lazy and only fetched by the home hero on capable
    // devices; it is expected to be large.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // Charts only load on the admin dashboard, so keep them out of the
        // bundle everyone in the stands downloads.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          // Interface animation runtime, shared by every page. GSAP is
          // imported lazily and gets its own chunk.
          motion: ['motion/react'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1 rather than localhost on purpose. On Windows, Node resolves
      // localhost to ::1 first, while uvicorn listens on 127.0.0.1 — which
      // shows up as ECONNREFUSED even though the API is running fine.
      // ws: true is required too: the live auction feed is a WebSocket
      // upgrade on the same /api prefix, and without it the dev server
      // silently drops the connection.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, ws: true },
      '/uploads': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
