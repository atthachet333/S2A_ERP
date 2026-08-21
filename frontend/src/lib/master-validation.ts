/**
 * PHASE 7 — แปล error ของ master data ให้เป็นภาษาคน
 *
 * ปัญหาเดิม: ผู้ใช้เห็นข้อความอย่าง "CONFLICT" / "P2002" / "DUPLICATE_UNIT"
 * ซึ่งไม่บอกว่าต้องทำอะไรต่อ
 *
 * ไฟล์นี้ไม่แตะ unique constraint และไม่เปลี่ยนพฤติกรรม backend
 * แค่ map รหัสที่ backend ส่งมาอยู่แล้วให้เป็นประโยคที่เข้าใจได้
 */

export type MasterKind = 'unit' | 'category' | 'ingredient' | 'packaging' | 'supplier' | 'warehouse' | 'item';

const NOUN: Record<MasterKind, string> = {
  unit: 'หน่วย',
  category: 'หมวดหมู่',
  ingredient: 'วัตถุดิบ',
  packaging: 'บรรจุภัณฑ์',
  supplier: 'ผู้จำหน่าย',
  warehouse: 'คลัง',
  item: 'รายการ',
};

/** รหัส conflict ที่ backend ใช้จริง (ตรวจจาก business.route.ts / item.route.ts / unit.route.ts) */
const CONFLICT_CODES = [
  'CONFLICT', 'DUPLICATE', 'DUPLICATE_UNIT', 'DUPLICATE_CATEGORY',
  'DUPLICATE_SUPPLIER', 'DUPLICATE_WAREHOUSE', 'DUPLICATE_ITEM', 'P2002',
];

const codeOf = (e: unknown): string => {
  if (e && typeof e === 'object' && 'code' in e) return String((e as { code?: unknown }).code ?? '');
  return '';
};
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : '');

export function isConflict(e: unknown): boolean {
  const code = codeOf(e).toUpperCase();
  if (CONFLICT_CODES.some((c) => code.includes(c))) return true;
  // backend บางเส้นทางส่งเฉพาะข้อความไทย ไม่ส่ง code
  return /อยู่แล้ว|ซ้ำ|duplicate/i.test(messageOf(e));
}

/**
 * ข้อความสำหรับผู้ใช้
 * ชื่อ/รหัสที่ซ้ำจะถูกใส่ในประโยคด้วย เพื่อให้รู้ทันทีว่าตัวไหนชน
 */
export function masterConflictMessage(e: unknown, kind: MasterKind, value?: string): string {
  if (isConflict(e)) {
    const noun = NOUN[kind];
    return value
      ? `มี${noun} ${value} อยู่ในระบบแล้ว — ใช้รายการเดิมหรือเปลี่ยนชื่อ/รหัสใหม่`
      : `มี${noun}นี้อยู่ในระบบแล้ว — ใช้รายการเดิมหรือเปลี่ยนชื่อ/รหัสใหม่`;
  }
  const msg = messageOf(e);
  if (/VALIDATION/i.test(codeOf(e)) || /required|invalid/i.test(msg)) {
    return msg || 'ข้อมูลยังไม่ครบหรือรูปแบบไม่ถูกต้อง';
  }
  if (/FORBIDDEN|403/i.test(codeOf(e))) return 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้';
  return msg || 'บันทึกไม่สำเร็จ';
}

/**
 * ข้อความเมื่อ "ลบไม่ได้เพราะถูกใช้งานอยู่"
 * เคารพ reference guard เดิมของ backend — ฝั่ง UI แค่บอกให้เข้าใจ
 */
export function inUseMessage(e: unknown, kind: MasterKind): string | null {
  const code = codeOf(e).toUpperCase();
  const msg = messageOf(e);
  if (code.includes('IN_USE') || /กำลังถูกใช้|ถูกใช้งาน|in use/i.test(msg)) {
    return `${NOUN[kind]}นี้กำลังถูกใช้งานอยู่ จึงไม่สามารถลบได้`;
  }
  return null;
}

/** ตรวจชื่อซ้ำฝั่ง UI ก่อนยิง API — กันสร้างซ้ำโดยไม่รอ error กลับมา */
export function findExisting<T extends { name: string; code?: string }>(rows: T[], query: string): T | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return rows.find((r) => r.name.trim().toLowerCase() === q || (r.code ?? '').trim().toLowerCase() === q) ?? null;
}
