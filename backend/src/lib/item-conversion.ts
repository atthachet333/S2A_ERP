import { universalFactor, type ConvEdge } from './unit-convert.js';

/**
 * PHASE 20B — ด่านเดียวของระบบสำหรับตรวจอัตราแปลงหน่วยของสินค้า
 *
 * ความหมายที่ระบบยึด: purchaseToBaseFactor = "หนึ่งหน่วยซื้อ มีกี่หน่วยฐาน"
 *   1 KG = 1,000 G → factor = 1000 (ไม่ใช่ 0.001 ซึ่งเป็นทิศกลับ)
 *   ต้นทุนต่อหน่วยฐาน = ราคา ÷ จำนวนที่ซื้อ ÷ factor
 *
 * ถ้ารับค่าผิดทิศไว้ ต้นทุนจะกลายเป็น 350 ÷ 0.001 = 350,000 บาท/G แทนที่จะเป็น 0.35
 *
 * ทุกเส้นทางที่เขียน purchaseUnitId / baseUnitId / purchaseToBaseFactor
 * ต้องเรียกผ่านที่นี่ ห้ามมีด่านที่สอง
 */

export interface FactorConflict {
  expected: number;
  received: number;
}

/** ตัวอ่านอัตราแปลงมาตรฐานจากฐานข้อมูล (รับเฉพาะส่วนที่ต้องใช้ เพื่อให้เทสต์ส่งของจำลองได้) */
export type ConversionReader = () => Promise<ConvEdge[]>;

export const formatFactorValue = (value: number): string =>
  value.toLocaleString('en-US', { maximumFractionDigits: 6 });

export const factorConflictMessage = (conflict: FactorConflict): string =>
  `อัตราแปลงหน่วยไม่ถูกต้อง — ระบบมีอัตรามาตรฐานอยู่แล้วว่าต้องเป็น ${formatFactorValue(conflict.expected)} แต่ได้รับ ${formatFactorValue(conflict.received)}`;

/**
 * ตรวจว่าอัตราที่ส่งมาขัดกับอัตราแปลงมาตรฐานหรือไม่
 *
 * คืน null (ผ่าน) เมื่อ:
 *   - ไม่มีหน่วยซื้อแยก หรือหน่วยซื้อเป็นหน่วยเดียวกับหน่วยฐาน
 *   - คู่หน่วยนี้ไม่มีอัตรามาตรฐานให้เทียบ (อัตราเฉพาะรายการ เช่น 1 กระสอบ = 25 KG)
 *   - ค่าที่ส่งมาตรงกับอัตรามาตรฐาน (ยอมให้คลาดเคลื่อนจากการปัดเศษได้เล็กน้อย)
 */
export async function checkStandardFactor(
  baseUnitId: string | null | undefined,
  purchaseUnitId: string | null | undefined,
  factor: number,
  readEdges: ConversionReader,
): Promise<FactorConflict | null> {
  if (!baseUnitId || !purchaseUnitId || purchaseUnitId === baseUnitId) return null;

  const expected = universalFactor(purchaseUnitId, baseUnitId, await readEdges());
  if (expected == null) return null;

  if (!Number.isFinite(factor) || factor <= 0) return { expected, received: factor };
  // ทิศกลับ (0.001 แทน 1000) ต่างกันมากจนไม่มีทางผ่านเกณฑ์นี้
  if (Math.abs(factor - expected) <= Math.abs(expected) * 1e-9) return null;
  return { expected, received: factor };
}
