import { beforeAll } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { assertConnectedToTestDatabase, assertSafeTestDatabase } from '../../src/lib/test-db-guard.js';

/**
 * PHASE 15 — ด่านสุดท้ายก่อน integration test ทุกไฟล์จะเริ่มทำงาน
 *
 * แม้ vitest.config.ts จะตรวจ TEST_DATABASE_URL ตั้งแต่ตอนโหลด config แล้ว
 * ตรงนี้ยังตรวจซ้ำกับ "เซิร์ฟเวอร์จริง" อีกชั้น เพราะ:
 *   - connection อาจถูก override ระหว่างทาง
 *   - ผู้รันอาจตั้ง DATABASE_URL ทับจาก shell
 * ถ้าไม่ใช่ s2a_erp_test จะโยน error ทันทีและไม่มีเทสต์ไหนได้รัน
 */

let verified: string | null = null;

/** ยืนยันว่ากำลังต่อกับฐานข้อมูลทดสอบจริง — เรียกซ้ำได้ ผลลัพธ์ถูกจำไว้ */
export async function ensureTestDatabase(): Promise<string> {
  if (verified) return verified;

  // 1) ตรวจจากค่าที่ตั้งไว้ก่อน (ไม่ต้องต่อฐานข้อมูล)
  assertSafeTestDatabase(process.env.DATABASE_URL, undefined);

  // 2) ตรวจกับเซิร์ฟเวอร์จริงอีกชั้น
  verified = await assertConnectedToTestDatabase(async () => {
    const rows = await prisma.$queryRawUnsafe<{ db: string | null }[]>('SELECT DATABASE() AS db');
    return rows?.[0]?.db ?? null;
  });
  return verified;
}

beforeAll(async () => {
  await ensureTestDatabase();
});
