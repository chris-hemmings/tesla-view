import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const FRONTEND = resolve(__dirname, '../custom_components/tesla_view/frontend');

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, 'dev/public'),   // dev: /tesla_view/index.json + packs installed by tools/dev-assets.py (gitignored)
  build: {
    outDir: FRONTEND, emptyOutDir: false, copyPublicDir: false,
    lib: { entry: resolve(__dirname, 'src/tesla-view-card.ts'), formats: ['es'], fileName: () => 'tesla-view-card.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
    target: 'es2020', sourcemap: false, minify: 'esbuild',
  },
  server: { port: 5173, strictPort: true, open: false },
});
