import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const SERVER = 'http://localhost:2567';

export default defineConfig({
  server: {
    // Never open a browser: the person running this may have sound on.
    open: false,
    port: 5173,
    strictPort: true,
    proxy: {
      // The client talks to /colyseus in dev; the prefix is stripped so the server sees its own paths.
      '/colyseus': { target: SERVER, ws: true, rewrite: (path) => path.replace(/^\/colyseus/, '') },
      '/healthz': SERVER,
    },
  },
  preview: { open: false },
  build: {
    target: 'es2022',
    // Phaser is one large module on purpose; splitting it would not make the first load smaller.
    chunkSizeWarningLimit: 2_000,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // A separate registerSW.js file, so the page needs no inline script.
      injectRegister: 'script',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Nebotok',
        short_name: 'Nebotok',
        description: 'Collect creatures across floating sky islands, together.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#8fd3ff',
        theme_color: '#2b6cb0',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: 'index.html',
        // Server endpoints must always reach the network. WebSockets never pass through a service worker.
        navigateFallbackDenylist: [/^\/healthz/, /^\/matchmake/, /^\/colyseus/],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
