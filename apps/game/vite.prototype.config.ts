import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The throwaway battle-feel prototype (prototype-battle.html): its own build, with no service
// worker and no server, served from any folder.
export default defineConfig({
  base: './',
  preview: { open: false, host: '127.0.0.1', port: 8569, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist-prototype',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2_000,
    rolldownOptions: { input: fileURLToPath(new URL('prototype-battle.html', import.meta.url)) },
  },
});
