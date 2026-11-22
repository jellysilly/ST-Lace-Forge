import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The build is committed to dist/: SillyTavern installs extensions with a plain git clone, no build step.
// Relative base so the page works from /scripts/extensions/third-party/<folder>/dist/ whatever the folder is called.
// Stable file names keep updates to a small diff and let the loader cache-bust with ?v=.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
