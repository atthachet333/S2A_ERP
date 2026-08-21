import type { Unit, UnitConversion } from './catalog';
import { unitFactor } from './recipe-preview';

/**
 * ตัวช่วยสำหรับหน้า "จัดการสูตรแปลงหน่วย"
 * แหล่งข้อมูลจริงยังเป็น UnitConversion (มาตรฐานระบบ) และ Item.purchaseToBaseFactor (เฉพาะวัตถุดิบ)
 * ไฟล์นี้ไม่คำนวณต้นทุน — ทำหน้าที่จัดหมวด/ตรวจความถูกต้อง/สร้างข้อความอธิบายเท่านั้น
 */

export type FormulaKind = 'WEIGHT' | 'VOLUME' | 'COUNT' | 'ITEM_SPECIFIC';

export const FORMULA_KIND_LABEL: Record<FormulaKind, string> = {
  WEIGHT: 'น้ำหนัก',
  VOLUME: 'ปริมาตร',
  COUNT: 'จำนวน/บรรจุภัณฑ์',
  ITEM_SPECIFIC: 'เฉพาะวัตถุดิบ',
};

const WEIGHT = ['KG', 'G', 'MG', 'ขีด', 'KHEED'];
const VOLUME = ['L', 'ML', 'CC'];

/** จัดหมวดสูตรจากรหัสหน่วยสองฝั่ง — ใช้สำหรับ filter ในหน้าจัดการ */
export function classifyFormula(fromCode: string, toCode: string): FormulaKind {
  const from = fromCode.trim().toUpperCase();
  const to = toCode.trim().toUpperCase();
  const bothIn = (list: string[]) => list.includes(from) && list.includes(to);
  if (bothIn(WEIGHT)) return 'WEIGHT';
  if (bothIn(VOLUME)) return 'VOLUME';
  // ข้ามมิติ (น้ำหนัก ↔ ปริมาตร) ต้องขึ้นกับความหนาแน่นของวัตถุดิบ
  const crossDimension = (WEIGHT.includes(from) && VOLUME.includes(to)) || (VOLUME.includes(from) && WEIGHT.includes(to));
  return crossDimension ? 'ITEM_SPECIFIC' : 'COUNT';
}

/** ประโยคอธิบายให้คนคีย์อ่านเข้าใจทันที */
export function describeFormula(fromQty: number, fromName: string, toQty: number, toName: string): string {
  const f = fromQty.toLocaleString('en-US', { maximumFractionDigits: 6 });
  const t = toQty.toLocaleString('en-US', { maximumFractionDigits: 6 });
  return `หมายถึง ${f} ${fromName} เท่ากับ ${t} ${toName}`;
}

/** ด้านกลับที่ระบบคำนวณให้เอง (ไม่ต้องเก็บแถวซ้ำใน DB) */
export function inverseText(fromCode: string, toCode: string, factor: number): string | null {
  if (!(factor > 0)) return null;
  const inv = (1 / factor).toLocaleString('en-US', { maximumFractionDigits: 8 });
  return `1 ${toCode} = ${inv} ${fromCode}`;
}

export interface FormulaDraft { fromQty: number; fromUnitId: string; toQty: number; toUnitId: string; note?: string }

/** factor ที่จะบันทึกจริง = ปลายทาง ÷ ต้นทาง (schema เก็บเป็น 1 fromUnit = factor toUnit) */
export function draftFactor(d: Pick<FormulaDraft, 'fromQty' | 'toQty'>): number | null {
  const from = Number(d.fromQty), to = Number(d.toQty);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return null;
  return to / from;
}

export type FormulaIssue =
  | { code: 'EMPTY_UNIT'; message: string }
  | { code: 'SAME_UNIT'; message: string }
  | { code: 'BAD_NUMBER'; message: string }
  | { code: 'DUPLICATE'; message: string }
  | { code: 'CONFLICT'; message: string };

/** ตรวจร่างสูตรก่อนบันทึก — คืน null เมื่อผ่าน */
export function validateFormula(d: FormulaDraft, existing: UnitConversion[], units: Unit[]): FormulaIssue | null {
  if (!d.fromUnitId || !d.toUnitId) return { code: 'EMPTY_UNIT', message: 'เลือกหน่วยต้นทางและหน่วยปลายทาง' };
  if (d.fromUnitId === d.toUnitId) return { code: 'SAME_UNIT', message: 'หน่วยต้นทางและปลายทางต้องต่างกัน' };
  const factor = draftFactor(d);
  if (factor == null) return { code: 'BAD_NUMBER', message: 'จำนวนทั้งสองฝั่งต้องมากกว่า 0' };

  const code = (id: string) => units.find((u) => u.id === id)?.code ?? '';
  const dup = existing.find((c) => c.fromUnitId === d.fromUnitId && c.toUnitId === d.toUnitId);
  if (dup && Math.abs(dup.factor - factor) > 1e-9) {
    return { code: 'DUPLICATE', message: `มีสูตรนี้อยู่แล้ว (1 ${code(d.fromUnitId)} = ${dup.factor} ${code(d.toUnitId)}) — บันทึกจะเป็นการอัปเดตค่าเดิม` };
  }
  // ขัดกับเส้นทางที่คำนวณได้จากสูตรอื่น เช่นตั้ง KG→G ทับค่าที่ได้จาก KG→ขีด→G
  const others = existing.filter((c) => !(c.fromUnitId === d.fromUnitId && c.toUnitId === d.toUnitId) && !(c.fromUnitId === d.toUnitId && c.toUnitId === d.fromUnitId));
  const derived = unitFactor(d.fromUnitId, d.toUnitId, others);
  if (derived != null && Math.abs(derived - factor) > Math.max(1e-6, Math.abs(derived) * 1e-6)) {
    return { code: 'CONFLICT', message: `ค่านี้ขัดกับสูตรอื่นที่ตั้งไว้ — ระบบคำนวณได้ 1 ${code(d.fromUnitId)} = ${derived} ${code(d.toUnitId)}` };
  }
  return null;
}

export interface RecommendedFormula { kind: FormulaKind; fromCode: string; toCode: string; toQty: number | null; hint: string; warn?: string }

/** สูตรแนะนำที่กดใช้ได้ทันที — toQty = null คือให้ผู้ใช้กรอกเอง */
export const RECOMMENDED: RecommendedFormula[] = [
  { kind: 'WEIGHT', fromCode: 'KG', toCode: 'G', toQty: 1000, hint: 'ซื้อเป็น KG แต่สูตรใช้ G → ตั้ง 1 KG = 1,000 G' },
  { kind: 'WEIGHT', fromCode: 'ขีด', toCode: 'G', toQty: 100, hint: 'ขีดเป็นหน่วยน้ำหนักไทย → 1 ขีด = 100 G' },
  { kind: 'VOLUME', fromCode: 'L', toCode: 'ML', toQty: 1000, hint: 'ซื้อเป็น L แต่สูตรใช้ ML → ตั้ง 1 L = 1,000 ML' },
  { kind: 'COUNT', fromCode: 'BOX', toCode: 'PCS', toQty: null, hint: 'กล่องหนึ่งมีกี่ชิ้น → เช่น 1 BOX = 12 PCS' },
  { kind: 'COUNT', fromCode: 'PACK', toCode: 'PCS', toQty: null, hint: 'แพ็กหนึ่งมีกี่ชิ้น → เช่น 1 PACK = 6 PCS' },
  { kind: 'COUNT', fromCode: 'BAG', toCode: 'PCS', toQty: null, hint: 'ถุงหนึ่งมีกี่ชิ้น → เช่น 1 BAG = 20 PCS' },
  {
    kind: 'ITEM_SPECIFIC', fromCode: 'KG', toCode: 'ML', toQty: null,
    hint: 'น้ำหนัก → ปริมาตร ขึ้นกับความหนาแน่นของวัตถุดิบแต่ละชนิด',
    warn: 'ใช้เฉพาะวัตถุดิบที่มีความหนาแน่นเฉพาะ เช่น น้ำมัน/ซอส — ห้ามตั้งเป็นสูตรกลางของทุกวัตถุดิบ ให้ไปตั้งที่หน้าวัตถุดิบ “อัตราแปลงหน่วยสำหรับสูตร” แทน',
  },
];
