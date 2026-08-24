/**
 * PHASE 21 — สถานะข้อมูลต้นทุนของวัตถุดิบ
 *
 * ระบบต้องแยกสองอย่างนี้ออกจากกันให้ได้ ไม่ใช่เหมารวมว่า "ต้นทุน 0 = ยังไม่มีข้อมูล"
 *
 *   MISSING  ยังไม่เคยมีใครใส่ราคา — ต้นทุนสูตรที่ใช้ของชิ้นนี้จะต่ำกว่าความจริง ต้องเตือน
 *   ZERO     ยืนยันแล้วว่าต้นทุนเป็น 0 จริง (เช่น น้ำประปา ของแถม) — ถูกต้องแล้ว ไม่ต้องเตือน
 *   PRICED   มีต้นทุนมากกว่า 0
 *
 * ไม่ต้องเพิ่มคอลัมน์ใหม่: ItemPriceHistory.price เป็น Decimal ที่เก็บ 0 ได้อยู่แล้ว
 * และ source/note เป็น String? ที่บันทึกเจตนาและเหตุผลได้ครบ
 * "การมีแถวประวัติราคา" จึงเป็นหลักฐานว่ามีคนตัดสินใจแล้ว ส่วน "ไม่มีแถวเลย" คือยังไม่เคยตัดสินใจ
 */

export type CostStatus = 'PRICED' | 'ZERO' | 'MISSING';

/** ค่า source ที่ใช้ทำเครื่องหมายว่าเป็นการยืนยันต้นทุนศูนย์ */
export const EXPLICIT_ZERO_SOURCE = 'EXPLICIT_ZERO';

export interface CostStatusInput {
  lastCost: number;
  /** จำนวนแถวประวัติราคาของรายการนี้ (0 = ยังไม่เคยมีใครใส่ราคา) */
  priceRecordCount: number;
}

export function costStatusOf(input: CostStatusInput): CostStatus {
  if (input.lastCost > 0) return 'PRICED';
  // ต้นทุนเป็น 0 แต่มีคนบันทึกราคาไว้แล้ว = ตั้งใจให้เป็น 0
  return input.priceRecordCount > 0 ? 'ZERO' : 'MISSING';
}

export const isMissingCost = (input: CostStatusInput): boolean => costStatusOf(input) === 'MISSING';

/** ความครบถ้วนของข้อมูลต้นทุนในสูตรหนึ่ง — นับ "ยืนยันว่าศูนย์" เป็นข้อมูลครบ ไม่ใช่ขาด */
export interface CompletenessInput {
  status: CostStatus;
  /** บรรทัดที่ไม่ได้อ้างวัตถุดิบ (เช่น สูตรย่อย) ไม่นับในความครบถ้วนของราคาวัตถุดิบ */
  countsTowardCost: boolean;
}

export interface Completeness {
  total: number;
  priced: number;
  explicitZero: number;
  missing: number;
  /** สัดส่วนที่มีข้อมูลต้นทุนแล้ว 0–100 — ไม่มีบรรทัดที่นับได้เลยถือว่า 100 */
  percent: number;
  complete: boolean;
}

export function completenessOf(lines: CompletenessInput[]): Completeness {
  const counted = lines.filter((l) => l.countsTowardCost);
  const priced = counted.filter((l) => l.status === 'PRICED').length;
  const explicitZero = counted.filter((l) => l.status === 'ZERO').length;
  const missing = counted.filter((l) => l.status === 'MISSING').length;
  const known = priced + explicitZero;
  return {
    total: counted.length,
    priced, explicitZero, missing,
    percent: counted.length === 0 ? 100 : Math.round((known / counted.length) * 100),
    // มีของที่ยังไม่รู้ต้นทุนแม้ชิ้นเดียว = ยังบอกว่า "ต้นทุนครบ" ไม่ได้
    complete: missing === 0,
  };
}
