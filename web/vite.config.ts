/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // In dev, /api/* is forwarded to the Express backend, so no CORS or URL config is needed.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  build: { sourcemap: true },
  test: { globals: true, environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], css: false },
});
