import { defineConfig } from 'vitest/config';

/**
 * PHASE 7B — config สำหรับ unit test ล้วน (ไม่แตะฐานข้อมูล)
 *
 * vitest.config.ts เดิมบังคับ TEST_DATABASE_URL ตั้งแต่ตอนโหลด config
 * ทำให้ไฟล์ *.unit.test.ts ซึ่งไม่ต้องใช้ DB เลย รันไม่ได้ตามไปด้วย
 * ไฟล์นี้จึงแยกออกมา โดยไม่แก้ config เดิมของ integration test
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.unit.test.ts'],
    env: { NODE_ENV: 'test', LOG_LEVEL: 'error' },
  },
});
