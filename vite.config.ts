/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works both at the site root and under a
  // sub-path (e.g. GitHub Pages per-PR previews at `/<repo>/pr-preview/pr-N/`).
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
    },
  },
  // The routing engine runs in a Web Worker; Vite handles `new Worker(new URL(...))`.
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      // Multi-page: the app plus the standalone 3D temporal view (temporal3d.html).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        temporal3d: fileURLToPath(new URL('./temporal3d.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/fixtures/**'],
    },
  },
});
