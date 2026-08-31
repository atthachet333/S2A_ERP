/**
 * ตัวช่วยหน้า "สร้างใบเบิกให้ครัวกลาง" — warehouse-driven
 * ไม่คำนวณต้นทุน และไม่ตัดสต็อกเอง · backend เป็น source of truth ของสต็อกและเลข RI
 */

export interface StockBalanceRow { warehouseId: string; onHand: string | number; reserved: string | number }
export interface StockItem {
  id: string; code: string; name: string; type: string;
  isLotTracked?: boolean; isExpiryTracked?: boolean;
  baseUnit?: { code: string; name: string } | null;
  stockBalances: StockBalanceRow[];
}

/** สินค้าพร้อมเบิกในคลังหนึ่ง (พร้อมยอดที่ใช้ได้จริง) */
export interface IssuableItem {
  id: string; code: string; name: string; type: string; unit: string;
  isLotTracked: boolean; isExpiryTracked: boolean;
  onHand: number; reserved: number; available: number;
}

const n = (v: string | number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** ยอดของสินค้าหนึ่งรายการในคลังหนึ่ง (รวมทุก location/lot) */
export function stockInWarehouse(item: StockItem, warehouseId: string): { onHand: number; reserved: number; available: number } {
  const rows = item.stockBalances.filter((b) => b.warehouseId === warehouseId);
  const onHand = rows.reduce((s, b) => s + n(b.onHand), 0);
  const reserved = rows.reduce((s, b) => s + n(b.reserved), 0);
  return { onHand, reserved, available: onHand - reserved };
}

/**
 * รายการที่เบิกได้จากคลังที่เลือก — เฉพาะที่มี balance ในคลังนั้นและ available > 0
 * (endpoint คืนเฉพาะ item ที่ active อยู่แล้ว)
 */
export function issuableItems(items: StockItem[], warehouseId: string): IssuableItem[] {
  if (!warehouseId) return [];
  return items
    .map((item) => {
      const s = stockInWarehouse(item, warehouseId);
      return { id: item.id, code: item.code, name: item.name, type: item.type, unit: item.baseUnit?.code ?? '-', isLotTracked: Boolean(item.isLotTracked), isExpiryTracked: Boolean(item.isExpiryTracked), ...s };
    })
    .filter((x) => x.available > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

/** ค้นหาจากรหัสหรือชื่อ */
export function searchIssuable(list: IssuableItem[], term: string): IssuableItem[] {
  const q = term.trim().toLowerCase();
  if (!q) return list;
  return list.filter((x) => x.code.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
}

export interface IssueLine {
  key: string; itemId: string; name: string; code: string; unit: string;
  requiredQty: number; issuedQty: number;
  isLotTracked?: boolean; allocations?: { lotId:string; quantity:number; lotNo?:string; expiryDate?:string|null; available?:number }[];
}

export type AddResult =
  | { ok: true; lines: IssueLine[] }
  | { ok: false; reason: 'DUPLICATE'; existingKey: string; lines: IssueLine[] };

/** เพิ่มรายการ — ถ้ามีอยู่แล้วไม่เพิ่มซ้ำ แต่บอก key เดิมเพื่อให้ UI โฟกัสแถวนั้น */
export function addIssueLine(lines: IssueLine[], item: IssuableItem, keyFactory: () => string): AddResult {
  const dup = lines.find((l) => l.itemId === item.id);
  if (dup) return { ok: false, reason: 'DUPLICATE', existingKey: dup.key, lines };
  return {
    ok: true,
    lines: [...lines, { key: keyFactory(), itemId: item.id, name: item.name, code: item.code, unit: item.unit, requiredQty: 0, issuedQty: 0, isLotTracked:item.isLotTracked, allocations:[] }],
  };
}

/** ยอดหลังเบิก = พร้อมใช้ − จำนวนที่เบิก */
export function afterIssue(available: number, issuedQty: number): number {
  return n(available) - n(issuedQty);
}

export type LineIssue = 'ZERO' | 'OVER_AVAILABLE' | null;

/** ตรวจแต่ละบรรทัด — qty ต้อง > 0 และไม่เกิน available */
export function validateLine(issuedQty: number, available: number): LineIssue {
  const qty = n(issuedQty);
  if (qty <= 0) return 'ZERO';
  if (qty > n(available) + 1e-9) return 'OVER_AVAILABLE';
  return null;
}

export interface IssueSummary {
  lineCount: number; totalQty: number; insufficientCount: number; emptyQtyCount: number; canSubmit: boolean;
}

/** สรุปสำหรับ sticky summary + เปิด/ปิดปุ่มยืนยัน */
export function summarize(lines: IssueLine[], availableOf: (itemId: string) => number): IssueSummary {
  let insufficientCount = 0, emptyQtyCount = 0, totalQty = 0;
  for (const l of lines) {
    const issue = validateLine(l.issuedQty, availableOf(l.itemId));
    if (issue === 'OVER_AVAILABLE') insufficientCount += 1;
    if (issue === 'ZERO') emptyQtyCount += 1;
    totalQty += n(l.issuedQty);
  }
  return {
    lineCount: lines.length,
    totalQty,
    insufficientCount,
    emptyQtyCount,
    canSubmit: lines.length > 0 && insufficientCount === 0 && emptyQtyCount === 0,
  };
}

/** payload ที่ส่งให้ backend — ไม่มี issueNo เพราะ backend ออกเลข RI เอง */
export function buildIssuePayload(input: {
  warehouseId: string; orderId?: string; note?: string; idempotencyKey: string; confirm: boolean; lines: IssueLine[];
}) {
  return {
    warehouseId: input.warehouseId,
    ...(input.orderId ? { orderId: input.orderId } : {}),
    ...(input.note ? { note: input.note } : {}),
    idempotencyKey: input.idempotencyKey,
    confirm: input.confirm,
    items: input.lines.map((l) => ({
      itemId: l.itemId,
      requiredQty: n(l.requiredQty),
      issuedQty: n(l.issuedQty),
      unit: l.unit,
      baseQty: n(l.issuedQty),
      ...(l.isLotTracked||l.allocations?.length?{allocations:l.allocations?.map(row=>({lotId:row.lotId,quantity:n(row.quantity)}))??[]}:{}),
    })),
  };
}
