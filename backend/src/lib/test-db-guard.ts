/**
 * PHASE 15 — ด่านความปลอดภัยของฐานข้อมูลทดสอบ
 *
 * วัตถุประสงค์เดียวของไฟล์นี้: ทำให้ integration test
 * "ไม่มีทาง" ไปลบ/แก้ข้อมูลใน production ได้แม้จะตั้งค่าผิด
 *
 * หลักการ: fail closed — ถ้าไม่มั่นใจว่าเป็นฐานข้อมูลทดสอบ ให้โยน error ทันที
 * ห้ามมี code path ไหนที่ "ผ่านเพราะไม่รู้"
 */

/** ชื่อฐานข้อมูลที่ห้ามแตะเด็ดขาด ไม่ว่าจะตั้งค่ามายังไง */
export const FORBIDDEN_DATABASES = ['s2a_erp'] as const;

/** ชื่อฐานข้อมูลทดสอบที่อนุญาต */
export const ALLOWED_TEST_DATABASE = 's2a_erp_test';

export class TestDatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestDatabaseGuardError';
  }
}

const fail = (reason: string): never => {
  throw new TestDatabaseGuardError(`ปฏิเสธการทำงานกับฐานข้อมูล: ${reason}`);
};

/** อ่านชื่อฐานข้อมูลจาก connection URL — รูปแบบผิดถือว่าไม่ปลอดภัย */
export function databaseNameFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail('รูปแบบ connection URL ไม่ถูกต้อง');
  }
  if (!/^mysql:?$/.test(parsed.protocol.replace(':', '') + ':')) {
    // รองรับเฉพาะ mysql/mariadb ตามที่ระบบใช้จริง
    if (parsed.protocol !== 'mysql:') return fail(`ไม่รองรับ protocol "${parsed.protocol}"`);
  }
  const name = parsed.pathname.replace(/^\//, '').trim();
  if (!name) return fail('connection URL ไม่ได้ระบุชื่อฐานข้อมูล');
  return name;
}

/**
 * ตรวจว่า URL ที่ให้มาเป็นฐานข้อมูลทดสอบที่ปลอดภัยจริง
 *
 * @param testUrl        TEST_DATABASE_URL
 * @param productionUrl  DATABASE_URL ของ production (ถ้ามี) เพื่อกันชี้ซ้ำ
 * @returns ชื่อฐานข้อมูลทดสอบที่ผ่านการตรวจแล้ว
 */
export function assertSafeTestDatabase(
  testUrl: string | undefined | null,
  productionUrl?: string | null,
): string {
  if (!testUrl || !testUrl.trim()) return fail('ไม่ได้ตั้งค่า TEST_DATABASE_URL');

  const testName = databaseNameFromUrl(testUrl);

  // 1) ห้ามเป็นชื่อ production ไม่ว่ากรณีใด
  if ((FORBIDDEN_DATABASES as readonly string[]).includes(testName)) {
    return fail(`"${testName}" เป็นฐานข้อมูล production`);
  }

  // 2) ต้องเป็นชื่อที่อนุญาตเท่านั้น (allowlist ไม่ใช่ blocklist)
  if (testName !== ALLOWED_TEST_DATABASE) {
    return fail(`อนุญาตเฉพาะฐานข้อมูล "${ALLOWED_TEST_DATABASE}" แต่ได้รับ "${testName}"`);
  }

  // 3) ห้าม TEST_DATABASE_URL ตรงกับ DATABASE_URL
  if (productionUrl && testUrl.trim() === productionUrl.trim()) {
    return fail('TEST_DATABASE_URL ตรงกับ DATABASE_URL ของ production');
  }

  // 4) ถ้ามี production URL ต้องคนละฐานข้อมูลกันจริง ๆ
  if (productionUrl) {
    let productionName: string | null = null;
    try { productionName = databaseNameFromUrl(productionUrl); } catch { productionName = null; }
    if (productionName && productionName === testName) {
      return fail('TEST_DATABASE_URL ชี้ไปฐานข้อมูลเดียวกับ production');
    }
  }

  return testName;
}

/**
 * ยืนยันกับเซิร์ฟเวอร์จริงว่ากำลังต่ออยู่กับฐานข้อมูลทดสอบ
 * ใช้ก่อนคำสั่งล้างข้อมูลทุกครั้ง — ป้องกันกรณี URL ถูกต้องแต่ connection ถูก override
 *
 * @param queryDatabaseName ฟังก์ชันที่คืนชื่อฐานข้อมูลจาก SELECT DATABASE()
 */
export async function assertConnectedToTestDatabase(
  queryDatabaseName: () => Promise<string | null | undefined>,
): Promise<string> {
  const actual = (await queryDatabaseName())?.trim();
  if (!actual) return fail('ตรวจสอบชื่อฐานข้อมูลที่เชื่อมต่ออยู่ไม่ได้');
  if ((FORBIDDEN_DATABASES as readonly string[]).includes(actual)) {
    return fail(`กำลังเชื่อมต่อกับ production "${actual}"`);
  }
  if (actual !== ALLOWED_TEST_DATABASE) {
    return fail(`เชื่อมต่ออยู่กับ "${actual}" ซึ่งไม่ใช่ฐานข้อมูลทดสอบ`);
  }
  return actual;
}
