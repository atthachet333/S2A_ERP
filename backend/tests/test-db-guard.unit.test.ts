import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_TEST_DATABASE, FORBIDDEN_DATABASES, TestDatabaseGuardError,
  assertConnectedToTestDatabase, assertSafeTestDatabase, databaseNameFromUrl,
} from '../src/lib/test-db-guard.js';

/**
 * PHASE 15 — เทสต์ของ "ด่านความปลอดภัย" เอง
 *
 * นี่คือเป้าหมายหลักของเฟส: integration test ต้องไม่มีทางไปแตะ s2a_erp ได้
 * เทสต์ชุดนี้ไม่ต้องใช้ฐานข้อมูลจริง จึงรันได้ทันทีและกันการถอยหลังได้ตลอด
 */

const PROD = 'mysql://s2a_user:pw@127.0.0.1:3306/s2a_erp';
const TEST = 'mysql://s2a_user:pw@127.0.0.1:3306/s2a_erp_test';

describe('PHASE 15 — อ่านชื่อฐานข้อมูลจาก URL', () => {
  it('อ่านชื่อได้ถูกต้อง', () => {
    expect(databaseNameFromUrl(TEST)).toBe('s2a_erp_test');
    expect(databaseNameFromUrl(PROD)).toBe('s2a_erp');
  });

  it('URL ที่ไม่มีชื่อฐานข้อมูล = ไม่ปลอดภัย', () => {
    expect(() => databaseNameFromUrl('mysql://u:p@127.0.0.1:3306/')).toThrow(TestDatabaseGuardError);
    expect(() => databaseNameFromUrl('mysql://u:p@127.0.0.1:3306')).toThrow(TestDatabaseGuardError);
  });

  it('URL พังหรือคนละ protocol = ไม่ปลอดภัย', () => {
    expect(() => databaseNameFromUrl('ไม่ใช่ url')).toThrow(TestDatabaseGuardError);
    expect(() => databaseNameFromUrl('postgres://u:p@127.0.0.1:5432/s2a_erp_test')).toThrow(TestDatabaseGuardError);
  });
});

describe('PHASE 15 — ด่านกัน production', () => {
  it('ปฏิเสธฐานข้อมูล production ตรง ๆ', () => {
    expect(() => assertSafeTestDatabase(PROD)).toThrow(/production/);
  });

  it('ปฏิเสธเมื่อไม่ได้ตั้งค่า TEST_DATABASE_URL', () => {
    expect(() => assertSafeTestDatabase(undefined)).toThrow(/ไม่ได้ตั้งค่า/);
    expect(() => assertSafeTestDatabase('')).toThrow(/ไม่ได้ตั้งค่า/);
    expect(() => assertSafeTestDatabase('   ')).toThrow(/ไม่ได้ตั้งค่า/);
    expect(() => assertSafeTestDatabase(null)).toThrow(TestDatabaseGuardError);
  });

  it('ปฏิเสธเมื่อ TEST_DATABASE_URL ตรงกับ DATABASE_URL', () => {
    expect(() => assertSafeTestDatabase(PROD, PROD)).toThrow(TestDatabaseGuardError);
    expect(() => assertSafeTestDatabase(TEST, TEST)).toThrow(/ตรงกับ DATABASE_URL/);
  });

  it('ปฏิเสธชื่ออื่นที่ไม่ได้อยู่ใน allowlist แม้จะดูเหมือนชื่อทดสอบ', () => {
    for (const name of ['s2a_erp_staging', 'test_s2a_erp', 's2a_erp_test_2', 'mysql', 'information_schema']) {
      expect(() => assertSafeTestDatabase(`mysql://u:p@127.0.0.1:3306/${name}`), name)
        .toThrow(TestDatabaseGuardError);
    }
  });

  it('ปฏิเสธชื่อที่พยายามเลี่ยงด้วยตัวพิมพ์ใหญ่', () => {
    expect(() => assertSafeTestDatabase('mysql://u:p@127.0.0.1:3306/S2A_ERP')).toThrow(TestDatabaseGuardError);
  });

  it('อนุญาตเฉพาะ s2a_erp_test และคืนชื่อกลับมา', () => {
    expect(assertSafeTestDatabase(TEST)).toBe(ALLOWED_TEST_DATABASE);
    expect(assertSafeTestDatabase(TEST, PROD)).toBe(ALLOWED_TEST_DATABASE);
  });

  it('production อยู่ในบัญชีดำเสมอ', () => {
    expect(FORBIDDEN_DATABASES).toContain('s2a_erp');
  });
});

describe('PHASE 15 — ยืนยันกับเซิร์ฟเวอร์ก่อนล้างข้อมูล', () => {
  it('ผ่านเมื่อเชื่อมต่ออยู่กับฐานข้อมูลทดสอบจริง', async () => {
    await expect(assertConnectedToTestDatabase(async () => 's2a_erp_test')).resolves.toBe('s2a_erp_test');
  });

  it('ปฏิเสธทันทีถ้าเซิร์ฟเวอร์บอกว่าเป็น production — แม้ URL จะผ่านมาแล้ว', async () => {
    await expect(assertConnectedToTestDatabase(async () => 's2a_erp')).rejects.toThrow(/production/);
  });

  it('ปฏิเสธเมื่อถามชื่อฐานข้อมูลไม่ได้ (fail closed)', async () => {
    await expect(assertConnectedToTestDatabase(async () => null)).rejects.toThrow(TestDatabaseGuardError);
    await expect(assertConnectedToTestDatabase(async () => undefined)).rejects.toThrow(TestDatabaseGuardError);
    await expect(assertConnectedToTestDatabase(async () => '')).rejects.toThrow(TestDatabaseGuardError);
  });

  it('ปฏิเสธฐานข้อมูลอื่นที่ไม่ใช่ทดสอบ', async () => {
    await expect(assertConnectedToTestDatabase(async () => 'mysql')).rejects.toThrow(TestDatabaseGuardError);
  });
});

/* ============================================================
   ด่านที่อยู่ในไฟล์ config/สคริปต์ ต้องไม่ถูกถอดออก
   ============================================================ */
describe('PHASE 15 — ด่านในไฟล์ตั้งค่า', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('vitest.config.ts บังคับชื่อฐานข้อมูลทดสอบ', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toContain('TEST_DATABASE_URL');
    expect(cfg).toContain('s2a_erp_test');
    expect(cfg).toMatch(/throw new Error/);
  });

  it('vitest.config.ts ไม่ถอยไปใช้ DATABASE_URL ของ production', () => {
    const cfg = read('vitest.config.ts');
    // DATABASE_URL ที่ส่งให้เทสต์ต้องมาจาก testDatabaseUrl เท่านั้น
    expect(cfg).toMatch(/DATABASE_URL:\s*testDatabaseUrl/);
    expect(cfg).not.toMatch(/DATABASE_URL:\s*process\.env\.DATABASE_URL/);
  });

  it('สคริปต์เตรียมฐานข้อมูลปฏิเสธชื่ออื่น', () => {
    const script = read('scripts/setup-test-database.mjs');
    expect(script).toContain('s2a_erp_test');
    expect(script).toMatch(/Refusing to initialize any database other than/);
    // ต้องยืนยันกับเซิร์ฟเวอร์ด้วย ไม่ใช่เชื่อ URL อย่างเดียว
    expect(script).toContain('SELECT DATABASE()');
  });

  it('migrate deploy ของสคริปต์ชี้ไปฐานข้อมูลทดสอบเท่านั้น', () => {
    const script = read('scripts/setup-test-database.mjs');
    expect(script).toMatch(/DATABASE_URL:\s*testUrl/);
    expect(script).toMatch(/migrate',\s*'deploy'/);
    expect(script).not.toContain('migrate reset');
    expect(script).not.toContain('db push');
  });

  it('ไม่มีสคริปต์ไหนสั่ง migrate reset ที่อาจล้าง production', () => {
    const pkg = read('package.json');
    expect(pkg).not.toContain('migrate reset');
  });
});
