import { Prisma } from '@prisma/client';

/**
 * PHASE 16/17 — การลองใหม่ของ transaction ที่ชนกันเรื่องล็อก
 *
 * ฐานข้อมูลย้อน transaction ทั้งใบไปแล้วก่อนที่เราจะลองใหม่ จึงไม่มีผลข้างเคียงค้าง
 * กติกาที่ยึดตลอด:
 *  - ลองใหม่เฉพาะ "การชนกันของล็อก" หรือ "การแย่งเลขเอกสาร" เท่านั้น
 *  - ห้ามลองใหม่กับสต็อกไม่พอ ข้อมูลไม่ถูกต้อง สิทธิ์ไม่พอ หรือคำสั่งซ้ำทางธุรกิจ
 *  - จำกัดจำนวนครั้ง ครบแล้วโยน error เดิมออกไปตามจริง ไม่กลบ
 *  - ต้องเรียกใช้อย่างตั้งใจทีละจุด ไม่ใช่ตัวห่อทั่วระบบ
 */

/** 1213 = deadlock, 1205 = lock wait timeout, 1020 = ER_CHECKREAD (แถวถูกแก้หลัง snapshot) */
const LOCK_CONFLICT_CODES = ['1213', '1205', '1020'];

/** unique key ที่เกี่ยวกับเลขเอกสารโดยตรง */
const DOCUMENT_NUMBER_TARGETS = ['document_counters', 'orderNo', 'receiptNo', 'issueNo', 'adjustmentNo'];

const known = (error: unknown): Prisma.PrismaClientKnownRequestError | null =>
  error instanceof Prisma.PrismaClientKnownRequestError ? error : null;

/** รหัสข้อผิดพลาดของ MariaDB ที่ซ่อนอยู่ใน error ของ Prisma (raw query จะพกมาในข้อความ) */
export function mysqlErrorCode(error: unknown): string | null {
  const prismaError = known(error);
  if (prismaError?.code === 'P2010') {
    const code = (prismaError.meta as { code?: unknown } | undefined)?.code;
    if (code !== undefined && code !== null) return String(code);
  }
  if (error instanceof Error) {
    const matched = /Code: `(\d+)`/.exec(error.message);
    if (matched) return matched[1];
  }
  return null;
}

/** true เมื่อ transaction ล้มเพราะแย่งล็อกกัน ไม่ใช่เพราะข้อมูลหรือกติกาธุรกิจ */
export function isLockConflict(error: unknown): boolean {
  if (known(error)?.code === 'P2034') return true;   // write conflict / deadlock ที่ Prisma จัดหมวดไว้แล้ว
  const code = mysqlErrorCode(error);
  return code !== null && LOCK_CONFLICT_CODES.includes(code);
}

/** true เมื่อข้อผิดพลาดคือการแย่งกันออกเลขเอกสาร */
export function isDocumentNumberRace(error: unknown): boolean {
  if (isLockConflict(error)) return true;
  const prismaError = known(error);
  if (prismaError?.code !== 'P2002') return false;
  const target = JSON.stringify((prismaError.meta as { target?: unknown } | undefined)?.target ?? '');
  return DOCUMENT_NUMBER_TARGETS.some((name) => target.includes(name));
}

/**
 * PHASE 17 — การชนกันที่แถวยอดคงเหลือ
 * ครอบเฉพาะการแย่งล็อกเท่านั้น สต็อกไม่พอ (InsufficientStockError) จะไม่ถูกลองใหม่เด็ดขาด
 */
export const isStockLockConflict = isLockConflict;

async function withRetry<T>(run: () => Promise<T>, retryable: (error: unknown) => boolean, maxAttempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!retryable(error)) throw error;
      lastError = error;
      // ถอยแบบสุ่มเล็กน้อยเพื่อไม่ให้คำขอที่ชนกันกลับมาพร้อมกันอีก
      await new Promise((resolve) => setTimeout(resolve, attempt * 10 + Math.floor(Math.random() * 15)));
    }
  }
  throw lastError;
}

/** transaction ที่ออกเลขเอกสาร (และมักย้ายสต็อกด้วย) */
export const withDocumentNumberRetry = <T>(run: () => Promise<T>, maxAttempts = 8): Promise<T> =>
  withRetry(run, (error) => isDocumentNumberRace(error), maxAttempts);

/** transaction ที่แตะยอดคงเหลือแต่ไม่ได้ออกเลขเอกสารใหม่ เช่น การยืนยันหรือกลับรายการ */
export const withStockLockRetry = <T>(run: () => Promise<T>, maxAttempts = 8): Promise<T> =>
  withRetry(run, (error) => isStockLockConflict(error), maxAttempts);
