import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const testEnv = loadEnv('test', process.cwd(), '');
const testDatabaseUrl = testEnv.TEST_DATABASE_URL;

if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required for integration tests');
const testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
if (testDatabaseName !== 's2a_erp_test') {
  throw new Error('Integration tests are restricted to the s2a_erp_test database');
}

/* globalSetup รันในโปรเซสของ runner ซึ่งไม่ได้รับ `env` ของบล็อก test
   จึงต้องฉีดค่าที่ตรวจแล้วเข้า process.env ตรงนี้ */
process.env.TEST_DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    /* PHASE 15 — แยก integration ออกจาก unit ให้ชัด
       เดิม pattern นี้กิน *.unit.test.ts ไปด้วย ทำให้รายงานจำนวนปนกัน */
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.unit.test.ts', 'node_modules/**'],
    /* integration test แตะฐานข้อมูลเดียวกัน จึงห้ามรันขนานกัน */
    fileParallelism: false,
    setupFiles: ['tests/helpers/integration-setup.ts'],
    /* PHASE 15B — ล้าง+seed ครั้งเดียวก่อนทั้งชุด ทำให้รันซ้ำได้ผลเท่าเดิม */
    globalSetup: ['tests/helpers/global-setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      TEST_DATABASE_URL: testDatabaseUrl,
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: 'test-secret-key',
      FRONTEND_URL: 'http://localhost:1414',
      LOG_LEVEL: 'error',
    },
  },
});
