import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: ['lvh.me'],
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        ws: true,
      },
      '/v1': {
        target: 'http://localhost:8080',
        ws: true,
      },
      '/assets': {
        target: 'http://localhost:8080',
      },
    },
  },
})
