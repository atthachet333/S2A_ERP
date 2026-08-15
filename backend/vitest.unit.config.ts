import { defineConfig } from 'vitest/config';

/** Config สำหรับ unit test แบบบริสุทธิ์ (ไม่ต่อฐานข้อมูล) — ใช้กับ *.unit.test.ts เท่านั้น
 *  รันด้วย: npx vitest run --config vitest.unit.config.ts */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.unit.test.ts'],
  },
});
