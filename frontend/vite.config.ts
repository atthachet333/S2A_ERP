/// <reference types="vitest/config" />

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Frontend รันที่ port 1414 และ proxy /api ไป backend (port 1415)
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(
        fileURLToPath(new URL('.', import.meta.url)),
        'src',
      ),
    },
  },

  server: {
    port: 1414,
    strictPort: true,

    proxy: {
      '/api': {
        target: 'http://localhost:1415',
        changeOrigin: true,
        ws: true, // เผื่อ WebSocket / SSE ในอนาคต
      },
    },
  },

  preview: {
    port: 1414,
    strictPort: true,

    allowedHosts: [
      's2aerp.s2aconsultant.com',
      'localhost',
      '127.0.0.1',
    ],
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});