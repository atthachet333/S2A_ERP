/**
 * PHASE 6C — พรีวิวการปรับปรุงสต็อก
 *
 * สูตรตรงกับที่หน้าเดิมใช้และตรงกับ backend (business.route.ts / inventory-ledger):
 *   INCREASE : change = +quantity
 *   DECREASE : change = -quantity
 *   SET      : change = countedQty - onHand
 *   after    = onHand + change
 *
 * ที่นี่เป็น presentation helper ล้วน ๆ — backend ยังเป็นผู้ตัดสินจริงเสมอ
 * (รวมถึงเรื่องห้ามติดลบ ซึ่ง applyMovement โยน InsufficientStockError อยู่แล้ว)
 */

export type AdjustMode = 'INCREASE' | 'DECREASE' | 'SET';

export interface AdjustmentPreview {
  mode: AdjustMode;
  before: number;
  /** จำนวนที่ผู้ใช้กรอก (SET = จำนวนที่นับได้จริง) */
  entered: number;
  change: number;
  after: number;
  /** ไม่มีการเปลี่ยนแปลง — บันทึกไม่ได้ ตรงกับ validation เดิมของหน้า */
  noChange: boolean;
  /** ผลลัพธ์จะติดลบ — backend บล็อกอยู่แล้ว ที่นี่แค่เตือนล่วงหน้า */
  wouldGoNegative: boolean;
  /** ข้อความสมการ เช่น "100 − 6 = 94" */
  equation: string;
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const fmt = (v: number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

/** เปลี่ยนแปลงตามโหมด — สูตรเดียวกับที่หน้าเดิมคำนวณ ไม่ได้เขียนใหม่ */
export function adjustmentChange(mode: AdjustMode, entered: number, onHand: number): number {
  const q = n(entered), cur = n(onHand);
  return mode === 'SET' ? q - cur : mode === 'INCREASE' ? q : -q;
}

export function adjustmentPreview(mode: AdjustMode, entered: number, onHand: number, unit = ''): AdjustmentPreview {
  const before = n(onHand);
  const change = adjustmentChange(mode, entered, before);
  const after = before + change;
  const u = unit ? ` ${unit}` : '';
  const sign = change < 0 ? '−' : '+';
  return {
    mode, before, entered: n(entered), change, after,
    noChange: change === 0,
    wouldGoNegative: after < 0,
    equation: `${fmt(before)}${u} ${sign} ${fmt(Math.abs(change))}${u} = ${fmt(after)}${u}`,
  };
}
