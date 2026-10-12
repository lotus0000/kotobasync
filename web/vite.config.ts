import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'KotobaSync',
        short_name: 'Kotoba',
        description: '日语生词收集与同步',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        background_color: '#fafaf9',
        theme_color: '#1c1917',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8900' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['fake-indexeddb/auto'],
  },
})
