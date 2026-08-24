import { prisma } from '../../src/lib/prisma.js';
import { ensureTestDatabase } from './integration-setup.js';
import { NEVER_TOUCH, TEST_CLEANUP_TABLES } from './cleanup-tables.js';

/**
 * PHASE 15 — ล้างข้อมูลในฐานข้อมูลทดสอบให้ integration test รันซ้ำได้
 *
 * ข้อบังคับ: ต้องผ่าน ensureTestDatabase() ก่อนเสมอ
 * ฟังก์ชันนี้จะไม่ทำงานเลยถ้าไม่ได้เชื่อมต่ออยู่กับ s2a_erp_test
 * (fail closed — โยน error ออกไป ไม่ลบอะไรทั้งสิ้น)
 */

/**
 * ลำดับการลบตามความสัมพันธ์ FK: ลูกก่อน พ่อแม่ทีหลัง
 * ตารางที่ไม่มีอยู่จริงจะถูกข้ามอย่างเงียบ ๆ เพื่อให้ทนต่อการเปลี่ยน schema
 */

/** ตารางที่ห้ามแตะแม้อยู่ในฐานข้อมูลทดสอบ */

/**
 * ล้างข้อมูลทั้งหมดในฐานข้อมูลทดสอบ
 * ปิด FK check ชั่วคราวเพื่อให้ลบได้ครบโดยไม่ต้องพึ่งลำดับที่สมบูรณ์แบบ
 * แล้วเปิดคืนเสมอแม้เกิดข้อผิดพลาด
 */
export async function resetTestData(): Promise<void> {
  // ⬇️ ด่านสำคัญที่สุด — ถ้าไม่ใช่ฐานข้อมูลทดสอบจะโยน error ตรงนี้และไม่ลบอะไรเลย
  await ensureTestDatabase();

  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of TEST_CLEANUP_TABLES) {
      if (NEVER_TOUCH.has(table)) continue;
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
      } catch {
        /* ตารางยังไม่มีใน schema นี้ — ข้ามไป ไม่ถือเป็นข้อผิดพลาด */
      }
    }
  } finally {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  }
}

