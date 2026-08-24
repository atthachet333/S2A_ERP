import type { CostCompletionRow, CostCompletionSave } from './catalog';

/**
 * PHASE 21 — ตรรกะของหน้าเติมข้อมูลต้นทุน
 *
 * หลักที่ยึด:
 *  1) ช่องว่างกับเลข 0 ไม่ใช่สิ่งเดียวกัน — ว่าง = ยังไม่กรอก · 0 = ต้องยืนยันว่าเป็นศูนย์จริง
 *  2) บันทึกเฉพาะแถวที่ผู้ใช้กรอกเองเท่านั้น ไม่เขียนทั้งหน้าแบบเหมารวม
 *  3) สูตรต้นทุนใช้ตัวเดียวกับทั้งระบบ: ราคาซื้อ ÷ จำนวนที่ซื้อ ÷ อัตราแปลง
 *     (ห้ามสร้างสูตรที่สอง — ตรงกับ baseUnitCost ของ backend)
 */

export interface CostDraft {
  /** ค่าที่ผู้ใช้พิมพ์ — เก็บเป็นสตริงเพื่อแยก "ว่าง" ออกจาก "ศูนย์" ได้จริง */
  price: string;
  quantity: string;
  explicitZero: boolean;
  zeroReason: string;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** ต้นทุนต่อหน่วยฐาน — สูตรเดียวกับ backend ทุกประการ */
export function baseCostOf(purchasePrice: number, purchaseQuantity: number, purchaseToBaseFactor: number): number {
  const qty = n(purchaseQuantity) > 0 ? n(purchaseQuantity) : 1;
  const factor = n(purchaseToBaseFactor) > 0 ? n(purchaseToBaseFactor) : 1;
  return n(purchasePrice) / qty / factor;
}

/** แถวที่ถือว่า "ผู้ใช้กรอกแล้ว" — ต้องมีตัวเลขราคาจริง ไม่ใช่ช่องว่างหรือค่าที่พิมพ์ไม่จบ */
export function isFilled(draft: CostDraft | undefined): boolean {
  if (!draft) return false;
  const raw = draft.price.trim();
  if (raw === '') return false;
  const price = Number(raw);
  return Number.isFinite(price) && price >= 0;
}

export interface PendingRow {
  item: CostCompletionRow;
  purchasePrice: number;
  purchaseQuantity: number;
  explicitZero: boolean;
  zeroReason: string;
  newBaseCost: number;
}

export interface DraftSummary {
  /** แถวที่พร้อมบันทึก */
  rows: PendingRow[];
  /** แถวที่ใส่ 0 แต่ยังไม่ได้ยืนยัน — กันไว้ไม่ให้บันทึก */
  blocked: PendingRow[];
  payload: CostCompletionSave[];
}

/**
 * สรุปสิ่งที่ผู้ใช้กรอกไว้
 * แถวที่ใส่ 0 แต่ยังไม่ติ๊กยืนยัน จะไม่ถูกส่งไปบันทึก และถูกรายงานแยกให้เห็นชัด
 */
export function summarizeDraft(rows: CostCompletionRow[], draft: Record<string, CostDraft>): DraftSummary {
  const ready: PendingRow[] = [];
  const blocked: PendingRow[] = [];

  for (const item of rows) {
    const entry = draft[item.id];
    if (!isFilled(entry)) continue;
    const purchasePrice = n(entry!.price);
    const purchaseQuantity = n(entry!.quantity) > 0 ? n(entry!.quantity) : 1;
    const pending: PendingRow = {
      item, purchasePrice, purchaseQuantity,
      explicitZero: entry!.explicitZero,
      zeroReason: entry!.zeroReason,
      newBaseCost: baseCostOf(purchasePrice, purchaseQuantity, item.purchaseToBaseFactor),
    };
    if (purchasePrice === 0 && !entry!.explicitZero) blocked.push(pending);
    else ready.push(pending);
  }

  return {
    rows: ready,
    blocked,
    payload: ready.map((p) => ({
      itemId: p.item.id,
      purchasePrice: p.purchasePrice,
      purchaseQuantity: p.purchaseQuantity,
      ...(p.purchasePrice === 0 ? { explicitZero: true, zeroReason: p.zeroReason || undefined } : {}),
    })),
  };
}

/** เรียงตามผลกระทบจริง — backend เรียงมาให้แล้ว ฟังก์ชันนี้ไว้ให้เทสต์และการเรียงซ้ำฝั่งจอ */
export function buildCostRows(rows: CostCompletionRow[]): CostCompletionRow[] {
  return rows.slice().sort((a, b) =>
    b.recipesAffected - a.recipesAffected
    || b.menusAffected - a.menusAffected
    || a.code.localeCompare(b.code));
}

/* ---------- ผลกระทบต่อสูตรหลังบันทึกราคา ---------- */

export interface RecipeLineForPreview {
  itemId: string;
  /** ปริมาณในหน่วยฐานของวัตถุดิบ (คำนวณมาแล้วจากฝั่งที่รู้เรื่องหน่วย) */
  baseQuantity: number;
  currentUnitCost: number;
}

/**
 * ต้นทุนสูตร "หลังบันทึกราคานี้" — คำนวณจากปริมาณจริงเท่านั้น
 * ไม่ประมาณราคาของรายการที่ยังไม่รู้ต้นทุน (ยังคิดเป็น 0 ตามความจริงปัจจุบัน)
 */
export function projectedRecipeCost(lines: RecipeLineForPreview[], newCostByItem: Record<string, number>): number {
  return lines.reduce((sum, line) => {
    const unitCost = newCostByItem[line.itemId] ?? line.currentUnitCost;
    return sum + n(line.baseQuantity) * n(unitCost);
  }, 0);
}
