/**
 * PHASE 8B — กติกาการแก้ไขออเดอร์ และการคิดยอดฝั่ง server
 *
 * แยกออกมาเป็น pure function เพื่อให้ unit test ได้ (แบบเดียวกับ inventory-ledger / partner-master)
 * และเพื่อให้ "สูตรคิดเงิน" มีที่เดียวทั้งตอน POST และตอน PATCH
 *
 * หลักการที่ห้ามหลุด:
 *   - ยอดทุกตัวคำนวณจาก quantity × unitPrice ที่ฝั่ง server เสมอ
 *     ไม่เชื่อ lineTotal ที่ frontend ส่งมา
 *   - priceTier เป็น metadata บอกว่าราคาเริ่มจากระดับไหน
 *     ความจริงทางการเงินคือ unitPrice / lineTotal ของแต่ละบรรทัด
 */

/** ระดับราคาที่ระบบยอมรับ — ชุดเดียวกับที่ SellingPrice.priceType ใช้ */
export const PRICE_TIERS = ['RETAIL', 'WHOLESALE', 'AGENT', 'SPECIAL'] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

export const isValidPriceTier = (v: unknown): v is PriceTier =>
  typeof v === 'string' && (PRICE_TIERS as readonly string[]).includes(v);

/** สถานะที่ยังแก้ไขรายการได้ — มีเพียงร่างเท่านั้น */
export const EDITABLE_STATUSES = ['DRAFT'] as const;
export const isEditable = (status: string): boolean =>
  (EDITABLE_STATUSES as readonly string[]).includes(status);

const n = (v: unknown): number => {
  const x = Number(typeof v === 'object' && v !== null ? String(v) : v);
  return Number.isFinite(x) ? x : 0;
};

export interface LineInput { quantity: number | string; unitPrice: number | string }
export interface ComputedTotals { subtotal: number; discount: number; tax: number; totalAmount: number }

/**
 * สูตรเดียวกับ POST /business/orders เป๊ะ ๆ
 *   subtotal    = ผลรวม(quantity × unitPrice)
 *   totalAmount = max(0, subtotal − discount + tax)
 */
export function computeOrderTotals(lines: LineInput[], discount: number | string = 0, tax: number | string = 0): ComputedTotals {
  const subtotal = lines.reduce((s, l) => s + n(l.quantity) * n(l.unitPrice), 0);
  const d = n(discount);
  const t = n(tax);
  return { subtotal, discount: d, tax: t, totalAmount: Math.max(0, subtotal - d + t) };
}

/** ยอดของบรรทัดที่ server เป็นผู้คิด ไม่ใช่ค่าที่ client ส่งมา */
export const computeLineTotal = (quantity: number | string, unitPrice: number | string) => n(quantity) * n(unitPrice);

/**
 * ตรวจว่าแก้ออเดอร์ใบนี้ได้ไหม
 * คืน error code ที่ frontend เอาไปแปลเป็นภาษาไทยได้ตรง ๆ
 */
export function orderEditBlock(status: string): { code: 'ORDER_NOT_EDITABLE'; message: string } | null {
  if (isEditable(status)) return null;
  return { code: 'ORDER_NOT_EDITABLE', message: 'ออเดอร์นี้ยืนยันแล้ว จึงไม่สามารถแก้ไขรายการได้' };
}

/**
 * สิ่งที่ต้องคงเดิมเสมอเมื่อแก้ร่าง — ใช้ยืนยันว่าไม่ได้สร้างใบใหม่
 * (id / เลขที่ / เวลาสร้าง / ผู้สร้าง)
 */
export interface OrderIdentity { id: string; orderNo: string; createdAt: string; createdByUserId: string }
export function identityPreserved(before: OrderIdentity, after: OrderIdentity): boolean {
  return before.id === after.id
    && before.orderNo === after.orderNo
    && before.createdAt === after.createdAt
    && before.createdByUserId === after.createdByUserId;
}
