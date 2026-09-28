import { defineConfig } from 'vite';

// `vite build --mode share` keeps everything in one script so scripts/make-share.mjs can inline it into Warstrike.html.
export default defineConfig(({ mode }) => ({
  server: { port: 5180 },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: mode === 'share' ? { output: { codeSplitting: false } } : {},
  },
}));
