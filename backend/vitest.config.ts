import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const testEnv = loadEnv('test', process.cwd(), '');
const testDatabaseUrl = testEnv.TEST_DATABASE_URL;

if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required for integration tests');
const testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
if (testDatabaseName !== 's2a_erp_test') {
  throw new Error('Integration tests are restricted to the s2a_erp_test database');
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: 'test-secret-key',
      FRONTEND_URL: 'http://localhost:1414',
      LOG_LEVEL: 'error',
    },
  },
});
