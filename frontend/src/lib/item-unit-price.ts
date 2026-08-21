/**
 * PHASE 7 — ความสัมพันธ์ หน่วยซื้อ / หน่วยฐาน / ราคา
 *
 * นี่คือ "การนำเสนอ" ของ semantics เดิมเท่านั้น ไม่ใช่สูตรใหม่
 * ฝั่ง backend (item.route.ts) ใช้:
 *     pricePerPurchaseUnit = purchasePrice / purchaseQuantity
 *     lastCost (= baseUnitCost) = pricePerPurchaseUnit / (factor > 0 ? factor : 1)
 *
 * ไฟล์นี้ทำสองอย่าง
 *  1) forward  — ตอนคีย์ฟอร์ม: ราคาซื้อ → ต้นทุนต่อหน่วยฐาน (ให้เห็นก่อนกดบันทึก)
 *  2) inverse  — ตอนแสดงในตาราง: lastCost × factor = ราคาต่อหน่วยซื้อ
 *     (เป็นการกลับสมการเดิมเป๊ะ ๆ ไม่ใช่การตีความ lastCost ใหม่)
 *
 * เหตุผลที่ต้องมี: ผู้ใช้เห็น 0.047 แล้วไม่รู้ว่ามาจาก 47 ÷ 1000
 * ทำให้เกิดความสับสน "47 ต่อลิตร" กับ "47 ต่อมิลลิลิตร"
 */

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const fmtNum = (v: number, max = 6) => v.toLocaleString('en-US', { maximumFractionDigits: max });
const fmtBaht = (v: number, digits: number) =>
  `฿${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** สถานะของอัตราแปลงหน่วยของรายการหนึ่ง */
export type FactorState = 'same' | 'ok' | 'missing';

export interface UnitPricePreview {
  /** ราคาต่อ 1 หน่วยซื้อ (บาท) — null เมื่อยังไม่กรอกราคา */
  pricePerPurchaseUnit: number | null;
  /** ต้นทุนต่อ 1 หน่วยฐาน ที่ระบบจะบันทึกเป็น lastCost — null เมื่อคำนวณไม่ได้ */
  baseUnitCost: number | null;
  factorState: FactorState;
  /** ข้อความสมการ เช่น "47 ÷ 1000 = 0.047" — null เมื่อไม่ต้องแสดง */
  formula: string | null;
  /** บรรทัดอธิบายการแปลง เช่น "1 L = 1,000 ML" — null เมื่อหน่วยเดียวกัน */
  conversionText: string | null;
  /** ข้อความเตือนเมื่อยังใช้ราคานี้คิดต้นทุนไม่ได้ */
  warning: string | null;
}

export interface UnitPriceInput {
  purchasePrice: number | string;
  /** จำนวนที่ซื้อได้ในราคาข้างต้น (ค่าเริ่มต้น 1) */
  purchaseQuantity?: number | string;
  purchaseToBaseFactor: number | string;
  purchaseUnitCode?: string | null;
  baseUnitCode?: string | null;
}

/** ราคาต่อหน่วยซื้อ → ต้นทุนต่อหน่วยฐาน (ใช้ตอนคีย์ฟอร์ม) */
export function unitPricePreview(input: UnitPriceInput): UnitPricePreview {
  const price = n(input.purchasePrice);
  const qty = n(input.purchaseQuantity ?? 1);
  const factor = n(input.purchaseToBaseFactor);
  const pu = input.purchaseUnitCode || '';
  const bu = input.baseUnitCode || '';

  const factorState: FactorState = factor <= 0 ? 'missing' : factor === 1 ? 'same' : 'ok';
  const conversionText = factorState === 'ok' && pu && bu ? `1 ${pu} = ${fmtNum(factor)} ${bu}` : null;

  const perPurchase = qty > 0 && price > 0 ? price / qty : null;
  // factor ที่ใช้หารเป็นตัวเดียวกับ backend: ถ้าไม่ถูกต้อง backend จะใช้ 1
  const base = perPurchase != null && factor > 0 ? perPurchase / factor : null;

  let warning: string | null = null;
  if (factorState === 'missing') warning = 'กรุณากำหนดอัตราแปลงก่อนใช้ราคานี้คำนวณต้นทุน';

  let formula: string | null = null;
  if (perPurchase != null && factorState === 'ok' && base != null) {
    formula = `${fmtNum(perPurchase)} ÷ ${fmtNum(factor)} = ${fmtNum(base)}`;
  }

  return { pricePerPurchaseUnit: perPurchase, baseUnitCost: base, factorState, formula, conversionText, warning };
}

/**
 * ต้นทุนต่อหน่วยฐานที่เก็บไว้ → ราคาต่อหน่วยซื้อ (ใช้แสดงในตาราง)
 * เป็นการกลับสมการเดิม: baseUnitCost × factor = ราคาต่อหน่วยซื้อ
 * ไม่มีราคา (lastCost <= 0) → null เสมอ ไม่เดาเป็น 0
 */
export function purchasePriceFromBase(lastCost: number | string, factor: number | string): number | null {
  const c = n(lastCost);
  const f = n(factor);
  if (c <= 0 || f <= 0) return null;
  return c * f;
}

export interface ItemPriceDisplay {
  /** "฿47.00 / L" — null เมื่อยังไม่มีราคา */
  purchase: string | null;
  /** "฿0.0470 / ML" — null เมื่อยังไม่มีราคา */
  base: string | null;
  /** "1 L = 1,000 ML" — null เมื่อหน่วยเดียวกันหรือไม่มีอัตรา */
  conversion: string | null;
  factorState: FactorState;
}

/** ข้อความราคาสำหรับแถวในตาราง — surface ความสัมพันธ์ซื้อ/ฐานให้เห็นพร้อมกัน */
export function itemPriceDisplay(item: {
  lastCost: number | string;
  purchaseToBaseFactor: number | string;
  purchaseUnitCode?: string | null;
  baseUnitCode?: string | null;
}): ItemPriceDisplay {
  const lastCost = n(item.lastCost);
  const factor = n(item.purchaseToBaseFactor);
  const bu = item.baseUnitCode || '';
  // ไม่มีหน่วยซื้อแยก = ซื้อด้วยหน่วยฐาน
  const pu = item.purchaseUnitCode || bu;
  const factorState: FactorState = factor <= 0 ? 'missing' : factor === 1 ? 'same' : 'ok';

  const perPurchase = purchasePriceFromBase(lastCost, factor);
  return {
    purchase: perPurchase != null ? `${fmtBaht(perPurchase, 2)} / ${pu || '—'}` : null,
    base: lastCost > 0 ? `${fmtBaht(lastCost, 4)} / ${bu || '—'}` : null,
    conversion: factorState === 'ok' && pu && bu ? `1 ${pu} = ${fmtNum(factor)} ${bu}` : null,
    factorState,
  };
}

/**
 * รายการนี้ต้องตั้งอัตราแปลงหรือยัง
 * "ต้องตั้ง" = ระบุหน่วยซื้อที่ต่างจากหน่วยฐานไว้ แต่ factor ยังไม่ถูกต้อง
 * ถ้าไม่ได้ระบุหน่วยซื้อแยก ก็ไม่ถือว่าขาด (ซื้อด้วยหน่วยฐานตรง ๆ)
 */
export function needsConversion(item: {
  purchaseUnitId?: string | null;
  baseUnitId?: string | null;
  purchaseToBaseFactor: number | string;
}): boolean {
  const hasSeparatePurchaseUnit = Boolean(item.purchaseUnitId) && item.purchaseUnitId !== item.baseUnitId;
  return hasSeparatePurchaseUnit && n(item.purchaseToBaseFactor) <= 0;
}
