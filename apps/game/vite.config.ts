import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// scripts/dev.mjs moves both ports when another dev server already holds them.
const SERVER = `http://127.0.0.1:${process.env.NEBOTOK_SERVER_PORT ?? '2567'}`;

export default defineConfig({
  server: {
    // Never open a browser: the person running this may have sound on.
    open: false,
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.NEBOTOK_GAME_PORT ?? '5173'),
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
      // src/updates.ts registers the worker itself, to check for and take new builds.
      injectRegister: false,
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
        // index.html stays out of the precache: served cache-first, it kept old builds alive after a
        // deploy. Every other file is named by content hash or changes with the build, so cache-first
        // is right for those.
        globPatterns: ['**/*.{js,css,png,webmanifest}'],
        // vite-plugin-pwa sets these for autoUpdate only when it writes the registration itself.
        // Without them a new worker waits behind the old one while any page is open, which on an
        // iPad Home Screen app can be for ever.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // The page itself comes from the network, and from the cache only when the network is down
        // or slow. Every other navigation (the API, /healthz, /maps) never touches the worker, and
        // WebSockets never pass through one.
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nebotok-pages',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 4 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
