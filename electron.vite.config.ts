import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: resolve('src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve('src/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.js' } } } },
  renderer: { root: resolve('src/renderer'), plugins: [react()], build: { minify: 'esbuild', cssMinify: true, rollupOptions: { input: resolve('src/renderer/index.html') } } },
});
