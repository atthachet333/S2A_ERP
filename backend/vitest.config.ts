import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const testEnv = loadEnv('test', process.cwd(), '');

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      JWT_SECRET: 'test-secret-key',
      FRONTEND_URL: 'http://localhost:1414',
      LOG_LEVEL: 'error',
    },
  },
});
