/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Frontend รันที่ port 1414 และ proxy /api ไป backend (port 1415)
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
