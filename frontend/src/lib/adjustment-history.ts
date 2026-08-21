/**
 * PHASE 6C — พิมพ์ใบปรับปรุงสต็อกย้อนหลัง
 *
 * เดิมหน้านี้พิมพ์ได้เฉพาะใบที่ "เพิ่งบันทึกในเซสชันนี้" (state printDoc)
 * ถ้าผู้ใช้กดพิมพ์แถวเก่าในประวัติ จะได้ใบล่าสุดแทน ซึ่งเป็นเอกสารผิดใบ
 *
 * ข้อมูลที่ต้องใช้มีอยู่ใน response ของ GET /business/inventory/adjustments แล้ว
 * (StockAdjustmentItem เก็บ systemQty = ก่อน, countedQty = หลัง, diffQty = เปลี่ยน)
 * เดิม frontend ประกาศ type ไว้แค่ diffQty จึงเข้าไม่ถึงค่าที่เหลือ
 */

export interface AdjustmentHistoryItem {
  id: string;
  /** ยอดในระบบก่อนปรับ */
  systemQty: string | number;
  /** ยอดหลังปรับ (ที่นับได้จริง) */
  countedQty: string | number;
  /** ส่วนต่าง */
  diffQty: string | number;
  item: { code: string; name: string };
}

export interface AdjustmentHistoryRow {
  id: string;
  adjustmentNo: string;
  adjustmentDate: string;
  status: string;
  reason: string | null;
  note?: string | null;
  warehouse: { name: string; code?: string };
  items: AdjustmentHistoryItem[];
}

export interface PrintPayload {
  adjustmentNo: string;
  warehouse: string;
  note?: string | null;
  rows: { name: string; code: string; before: number; change: number; after: number; unit: string }[];
}

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

/**
 * แปลงแถวประวัติหนึ่งแถวเป็น payload สำหรับ AdjustmentPrintNote
 *
 * unitLookup: หน่วยของสินค้าไม่ได้อยู่ใน response ของ endpoint นี้
 * (include เลือกมาแค่ item.code / item.name) จึงเทียบจากรายการสต็อกที่โหลดไว้
 * ถ้าหาไม่เจอให้เว้นว่าง — ไม่เดาหน่วย
 */
export function toPrintPayload(
  row: AdjustmentHistoryRow,
  unitLookup: { itemId?: string; code: string; unit: string }[] = [],
): PrintPayload {
  return {
    adjustmentNo: row.adjustmentNo,
    warehouse: row.warehouse?.name ?? '',
    note: row.note ?? null,
    rows: row.items.map((it) => {
      const before = num(it.systemQty);
      const change = num(it.diffQty);
      const after = num(it.countedQty);
      return {
        name: it.item.name,
        code: it.item.code,
        before,
        change,
        // countedQty บางกรณีอาจเป็น 0 จากเอกสารเก่า ให้คำนวณจาก before+change แทน
        after: after || before + change,
        unit: unitLookup.find((u) => u.code === it.item.code)?.unit ?? '',
      };
    }),
  };
}

/** สรุปหนึ่งแถวสำหรับแสดงในตารางประวัติ (เอกสารปัจจุบันเป็น 1 บรรทัดเสมอ) */
export function historySummary(row: AdjustmentHistoryRow) {
  const first = row.items[0];
  return {
    itemName: first?.item.name ?? '—',
    itemCode: first?.item.code ?? '',
    before: num(first?.systemQty),
    change: num(first?.diffQty),
    after: num(first?.countedQty) || num(first?.systemQty) + num(first?.diffQty),
    lineCount: row.items.length,
  };
}
