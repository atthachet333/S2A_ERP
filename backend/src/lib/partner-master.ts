/**
 * PHASE 7B — Supplier / Warehouse master service
 *
 * เป้าหมายของไฟล์นี้: เปิด contract ที่ DB มีอยู่แล้วให้ frontend ใช้ได้ครบ
 * โดยไม่ทำลายประวัติ และไม่เปิดช่องแก้สต็อกผ่านหน้า master
 *
 * กติกาที่ยึดไว้
 *  - แก้ได้เฉพาะ field ของ master เท่านั้น ไม่แตะ StockBalance / StockLedger
 *  - ปิดใช้งาน = soft (isActive=false) ไม่ลบ record และไม่แตะเอกสารเก่า
 *  - คลังที่ยังมีของ ห้ามปิดใช้งาน (คืน WAREHOUSE_HAS_STOCK พร้อมยอดจริง)
 *  - stockValue ใช้สูตรเดียวกับ GET /business/inventory: onHand × item.lastCost
 *
 * แยกออกมาเป็น pure function + client ที่ฉีดเข้ามา เพื่อให้ unit test ได้
 * แบบเดียวกับ inventory-ledger.ts
 */

/** ตัวเลขจาก Prisma.Decimal / string / number → number ที่ปลอดภัย */
export const toNum = (v: unknown): number => {
  const n = Number(typeof v === 'object' && v !== null ? String(v) : v);
  return Number.isFinite(n) ? n : 0;
};

export type StatusFilter = 'active' | 'inactive' | 'all';

/** where ของสถานะ — 'all' ต้องไม่ใส่ key ลงไป ไม่ใช่ใส่ undefined ซ้อน */
export function statusWhere(status: StatusFilter | undefined) {
  if (status === 'active') return { isActive: true };
  if (status === 'inactive') return { isActive: false };
  return {};
}

/** ค้นหาแบบเดียวกับหน้าอื่น: รหัสหรือชื่อ */
export function searchWhere(keyword: string | undefined, extraFields: string[] = []) {
  const k = keyword?.trim();
  if (!k) return {};
  const fields = ['code', 'name', ...extraFields];
  return { OR: fields.map((f) => ({ [f]: { contains: k } })) };
}

/* ============================================================
   STOCK AGGREGATE ต่อคลัง
   ============================================================ */
export interface WarehouseStock {
  /** จำนวนสินค้าที่ "ไม่ซ้ำ" ในคลังนี้ (นับ item ไม่ใช่จำนวนแถว balance) */
  itemCount: number;
  onHand: number;
  reserved: number;
  stockValue: number;
}
export const EMPTY_STOCK: WarehouseStock = { itemCount: 0, onHand: 0, reserved: 0, stockValue: 0 };

export interface BalanceRow {
  warehouseId: string;
  itemId: string;
  onHand: unknown;
  reserved: unknown;
  item: { lastCost: unknown } | null;
}

/**
 * รวมยอดต่อคลังจาก StockBalance ที่ดึงมาครั้งเดียว — ไม่มี N+1
 * แถวหนึ่ง item อาจมีหลาย location/lot จึงต้องนับ item แบบไม่ซ้ำ
 */
export function aggregateStock(rows: BalanceRow[]): Map<string, WarehouseStock> {
  const acc = new Map<string, WarehouseStock & { items: Set<string> }>();
  for (const r of rows) {
    let cur = acc.get(r.warehouseId);
    if (!cur) { cur = { ...EMPTY_STOCK, items: new Set<string>() }; acc.set(r.warehouseId, cur); }
    const onHand = toNum(r.onHand);
    cur.items.add(r.itemId);
    cur.onHand += onHand;
    cur.reserved += toNum(r.reserved);
    cur.stockValue += onHand * toNum(r.item?.lastCost);
  }
  const out = new Map<string, WarehouseStock>();
  for (const [id, v] of acc) {
    out.set(id, { itemCount: v.items.size, onHand: v.onHand, reserved: v.reserved, stockValue: v.stockValue });
  }
  return out;
}

/* ============================================================
   ความปลอดภัยตอนปิดใช้งานคลัง
   ============================================================ */
export interface DeactivateBlock {
  code: 'WAREHOUSE_HAS_STOCK';
  message: string;
  /** ยอดจริงที่ทำให้ปิดไม่ได้ — frontend เอาไปแสดงตรง ๆ ห้ามแต่งเลขเอง */
  onHand: number;
  reserved: number;
  itemCount: number;
}

/**
 * ปิดใช้งานคลังได้ไหม
 * มีของค้าง (onHand หรือ reserved ไม่เป็นศูนย์) → บล็อก
 * ยอดติดลบก็ถือว่ายังไม่เคลียร์ จึงบล็อกด้วย ใช้ Math.abs
 * ห้ามล้างสต็อกหรือย้ายให้อัตโนมัติ — ผู้ใช้ต้องเคลียร์เองผ่านเอกสารปกติ
 */
export function warehouseDeactivateBlock(stock: WarehouseStock | undefined): DeactivateBlock | null {
  const s = stock ?? EMPTY_STOCK;
  const EPS = 0.0001;
  if (Math.abs(s.onHand) < EPS && Math.abs(s.reserved) < EPS) return null;
  return {
    code: 'WAREHOUSE_HAS_STOCK',
    message: 'คลังนี้ยังมีสินค้าคงเหลืออยู่ จึงยังปิดใช้งานไม่ได้',
    onHand: s.onHand,
    reserved: s.reserved,
    itemCount: s.itemCount,
  };
}

/* ============================================================
   NORMALIZE / DUPLICATE
   ============================================================ */
/** ตัดช่องว่าง และให้รหัสเป็นตัวใหญ่เสมอ ตาม pattern ที่ POST เดิมใช้ */
export const normalizeCode = (code: string | undefined | null): string | undefined => {
  const c = code?.trim();
  return c ? c.toUpperCase() : undefined;
};
export const normalizeName = (name: string | undefined | null): string | undefined => {
  const n = name?.trim();
  return n || undefined;
};

/** string ว่าง = ผู้ใช้ตั้งใจล้างค่า → null · undefined = ไม่ได้ส่งมา → ไม่แตะ */
export const optionalText = (v: string | undefined): string | null | undefined =>
  v === undefined ? undefined : (v.trim() || null);

/**
 * ประกอบ data สำหรับ PATCH โดยตัด key ที่ไม่ได้ส่งมาออก
 * (Prisma ถือว่า undefined = ไม่อัปเดต แต่ตัดออกให้ชัดเจนกว่าเวลาอ่าน audit log)
 */
export function buildPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

/** แปลง Prisma error / duplicate ให้เป็น code ที่ frontend map ต่อได้ */
export function duplicateCodeFor(kind: 'supplier' | 'warehouse'): 'DUPLICATE_SUPPLIER' | 'DUPLICATE_WAREHOUSE' {
  return kind === 'supplier' ? 'DUPLICATE_SUPPLIER' : 'DUPLICATE_WAREHOUSE';
}

export function duplicateMessage(kind: 'supplier' | 'warehouse', field: 'code' | 'name', value: string): string {
  const noun = kind === 'supplier' ? 'ผู้จำหน่าย' : 'คลัง';
  return field === 'code' ? `มี${noun}รหัส ${value} อยู่แล้ว` : `มี${noun}ชื่อ ${value} อยู่แล้ว`;
}
