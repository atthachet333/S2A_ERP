import { stockInWarehouse, type StockItem } from './issue-stock';

/**
 * PHASE 18 — ตัวช่วยหน้า "โอนย้ายระหว่างคลัง"
 *
 * ใบโอนย้ายหนึ่งใบคือการเคลื่อนไหวสองขาที่แยกกันไม่ได้ หน้าจอจึงต้องแสดงผลทั้งสองฝั่งเสมอ
 * ไฟล์นี้คำนวณเฉพาะ "ตัวอย่างก่อนยืนยัน" จากยอดปัจจุบันที่ backend ส่งมา
 * ห้ามนำไปใช้แสดงผลย้อนหลังของเอกสารที่ยืนยันแล้ว — ค่านั้นต้องอ่านจากบัญชีเดินสต็อกเท่านั้น
 */

export interface TransferLine {
  key: string;
  itemId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
}

/** สินค้าที่โอนย้ายได้จากคลังต้นทาง พร้อมยอดของทั้งสองฝั่ง */
export interface TransferableItem {
  id: string; code: string; name: string; type: string; unit: string;
  sourceOnHand: number; sourceReserved: number; sourceAvailable: number;
  destOnHand: number;
}

export type LineIssue = 'NONE' | 'EMPTY' | 'OVER_AVAILABLE';

/**
 * สินค้าที่โอนได้ = มีของพร้อมใช้ในคลังต้นทางเท่านั้น
 * ปลายทางไม่จำเป็นต้องเคยมีสินค้านี้มาก่อน (ยอดเริ่มต้นเป็น 0 ได้)
 */
export function transferableItems(items: StockItem[], fromWarehouseId: string, toWarehouseId: string): TransferableItem[] {
  if (!fromWarehouseId || fromWarehouseId === toWarehouseId) return [];
  return items
    .map((item) => {
      const source = stockInWarehouse(item, fromWarehouseId);
      const dest = toWarehouseId ? stockInWarehouse(item, toWarehouseId) : { onHand: 0, reserved: 0, available: 0 };
      return {
        id: item.id, code: item.code, name: item.name, type: item.type,
        unit: item.baseUnit?.code ?? '-',
        sourceOnHand: source.onHand, sourceReserved: source.reserved, sourceAvailable: source.available,
        destOnHand: dest.onHand,
      };
    })
    .filter((x) => x.sourceAvailable > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

export function searchTransferable(list: TransferableItem[], term: string): TransferableItem[] {
  const q = term.trim().toLowerCase();
  if (!q) return list;
  return list.filter((x) => x.code.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
}

export type AddResult =
  | { ok: true; lines: TransferLine[] }
  | { ok: false; reason: 'DUPLICATE'; existingKey: string };

/** กันสินค้าซ้ำในใบเดียวกัน — backend ปฏิเสธด้วย DUPLICATE_ITEM อยู่แล้ว หน้าจอจึงต้องกันตั้งแต่ต้น */
export function addTransferLine(lines: TransferLine[], item: TransferableItem, keyFactory: () => string): AddResult {
  const existing = lines.find((l) => l.itemId === item.id);
  if (existing) return { ok: false, reason: 'DUPLICATE', existingKey: existing.key };
  return {
    ok: true,
    lines: [...lines, { key: keyFactory(), itemId: item.id, code: item.code, name: item.name, unit: item.unit, quantity: 0 }],
  };
}

const n = (v: number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** ยอดต้นทางหลังโอน (ติดลบได้ในตัวอย่าง เพื่อให้ผู้ใช้เห็นว่าเกิน) */
export const sourceAfter = (available: number, quantity: number) => n(available) - n(quantity);

/** ยอดปลายทางหลังโอน */
export const destAfter = (onHand: number, quantity: number) => n(onHand) + n(quantity);

export function validateTransferLine(quantity: number, sourceAvailable: number): LineIssue {
  const qty = n(quantity);
  if (qty <= 0) return 'EMPTY';
  if (qty > n(sourceAvailable)) return 'OVER_AVAILABLE';
  return 'NONE';
}

export interface TransferSummary {
  lineCount: number;
  totalQty: number;
  emptyQtyCount: number;
  insufficientCount: number;
  canSubmit: boolean;
}

/**
 * สรุปใบโอนย้าย — ส่งได้ก็ต่อเมื่อมีอย่างน้อยหนึ่งบรรทัด ทุกบรรทัดมีจำนวน และไม่มีบรรทัดใดเกินของที่พร้อมใช้
 * (backend ยังตรวจซ้ำเสมอ การกันที่หน้าจอเป็นเรื่องประสบการณ์ใช้งาน ไม่ใช่ความปลอดภัย)
 */
export function summarizeTransfer(lines: TransferLine[], availableOf: (itemId: string) => number): TransferSummary {
  let totalQty = 0;
  let emptyQtyCount = 0;
  let insufficientCount = 0;
  for (const line of lines) {
    const issue = validateTransferLine(line.quantity, availableOf(line.itemId));
    if (issue === 'EMPTY') emptyQtyCount += 1;
    if (issue === 'OVER_AVAILABLE') insufficientCount += 1;
    totalQty += n(line.quantity);
  }
  return {
    lineCount: lines.length,
    totalQty,
    emptyQtyCount,
    insufficientCount,
    canSubmit: lines.length > 0 && emptyQtyCount === 0 && insufficientCount === 0,
  };
}

/** ตรวจหัวเอกสารก่อนส่ง — คลังต้นทางและปลายทางต้องเลือกครบและต้องไม่ใช่คลังเดียวกัน */
export function warehouseIssue(fromWarehouseId: string, toWarehouseId: string): 'NONE' | 'MISSING' | 'SAME' {
  if (!fromWarehouseId || !toWarehouseId) return 'MISSING';
  if (fromWarehouseId === toWarehouseId) return 'SAME';
  return 'NONE';
}

export interface TransferPayload {
  fromWarehouseId: string;
  toWarehouseId: string;
  note?: string;
  confirm: boolean;
  items: { itemId: string; quantity: number }[];
}

export function buildTransferPayload(input: {
  fromWarehouseId: string; toWarehouseId: string; note?: string; confirm: boolean; lines: TransferLine[];
}): TransferPayload {
  return {
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    ...(input.note ? { note: input.note } : {}),
    confirm: input.confirm,
    items: input.lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
  };
}

/* ---------- ผลกระทบย้อนหลังจากบัญชีเดินสต็อกจริง ---------- */

export interface TransferMovement {
  itemCode: string;
  warehouseCode: string;
  movementType: string;
  reason?: string | null;
  beforeQty: number | null;
  qtyIn: number;
  qtyOut: number;
  balanceAfter: number;
}

export interface SideImpact { before: number | null; change: number; after: number }

/**
 * ผลกระทบของบรรทัดหนึ่งต่อคลังหนึ่ง อ่านจาก ledger เท่านั้น
 * ไม่มีข้อมูลก็คืน null เพื่อให้หน้าจอแสดง "—" ห้ามย้อนคำนวณจากสต็อกปัจจุบัน
 */
export function transferImpact(movements: TransferMovement[], itemCode: string, warehouseCode: string): SideImpact | null {
  const m = movements.find((x) => x.itemCode === itemCode && x.warehouseCode === warehouseCode && x.reason !== 'REVERSAL');
  if (!m) return null;
  return { before: m.beforeQty, change: m.qtyIn > 0 ? m.qtyIn : -m.qtyOut, after: m.balanceAfter };
}
