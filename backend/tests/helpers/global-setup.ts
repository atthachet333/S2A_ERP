import { PrismaClient } from '@prisma/client';
import { assertConnectedToTestDatabase, assertSafeTestDatabase } from '../../src/lib/test-db-guard.js';
import { seedDatabase } from '../../prisma/seed.js';
import { TEST_CLEANUP_TABLES } from './cleanup-tables.js';

/**
 * PHASE 15B — เตรียมฐานข้อมูลทดสอบก่อนรัน integration ทั้งชุด
 *
 * ทำครั้งเดียวต่อการรัน: ตรวจด่าน → ล้างข้อมูลเก่า → seed ข้อมูลตั้งต้น
 * ผลคือรันกี่รอบก็ได้จำนวนแถวใกล้เคียงเดิม ไม่มีข้อมูลค้างสะสม
 *
 * ⚠️ ใช้ PrismaClient ของตัวเองที่ผูกกับ TEST_DATABASE_URL โดยตรง
 *    ห้ามพึ่ง process.env.DATABASE_URL ตอน globalSetup เพราะ vitest ยังไม่ได้ฉีด env ของเทสต์
 *    และค่าใน shell อาจเป็น production
 */
export default async function globalSetup() {
  const testUrl = process.env.TEST_DATABASE_URL;

  // ด่าน 1: ตรวจจากค่าที่ตั้งไว้ (ยังไม่ต่อฐานข้อมูล)
  const expected = assertSafeTestDatabase(testUrl);

  const db = new PrismaClient({ datasourceUrl: testUrl });
  try {
    // ด่าน 2: ถามเซิร์ฟเวอร์จริงว่ากำลังต่ออยู่กับฐานไหน
    const actual = await assertConnectedToTestDatabase(async () => {
      const rows = await db.$queryRawUnsafe<{ db: string | null }[]>('SELECT DATABASE() AS db');
      return rows?.[0]?.db ?? null;
    });
    if (actual !== expected) throw new Error(`ฐานข้อมูลไม่ตรงกับที่ตั้งค่าไว้: ${actual}`);

    // ล้างเฉพาะข้อมูล — ไม่แตะ schema และไม่แตะตาราง migration
    await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of TEST_CLEANUP_TABLES) {
        try { await db.$executeRawUnsafe(`DELETE FROM \`${table}\``); }
        catch { /* ตารางยังไม่มีใน schema นี้ — ข้ามไป */ }
      }
    } finally {
      await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    }

    // ข้อมูลตั้งต้นที่เทสต์เดิมต้องพึ่ง (roles/permissions, company, win/pueng, units, warehouse, supplier)
    /* PHASE 19 — ฐานทดสอบต้องได้สิทธิ์ตั้งต้นครบทุกครั้งเพื่อให้ผลการทดสอบเหมือนเดิมเสมอ
       จึงสั่งโหมด test อย่างชัดเจน ไม่พึ่งค่าเริ่มต้นซึ่งตั้งใจให้ปลอดภัยกับ production */
    await seedDatabase(db, { mode: 'test' });
  } finally {
    await db.$disconnect();
  }
}
