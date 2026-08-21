/**
 * PHASE 8 — คำศัพท์กลางของออเดอร์
 *
 * เดิมสถานะออเดอร์ถูกแปลสองที่: messages.status ในหน้า Orders
 * และ statusLabel('order', …) ใน operations-vocab ที่ Dashboard ใช้
 * ไฟล์นี้ทำให้เหลือแหล่งเดียว โดย re-export ของเดิมเพื่อไม่ให้เกิด mapping ซ้ำอีก
 *
 * ค่าใน enum ตรงกับ SalesOrderStatus ใน schema.prisma จริง
 * และลำดับตรงกับตาราง transitions ใน business.route.ts
 */
import { STATUS_BADGE, statusInfo, statusLabel, type StatusTone } from '@/lib/operations-vocab';

export type OrderStatus =
  | 'DRAFT' | 'CONFIRMED' | 'SENT_TO_PREP' | 'PICKING'
  | 'ISSUED' | 'READY' | 'DELIVERED' | 'CANCELLED';

/** ลำดับความคืบหน้าของงาน (ไม่รวม CANCELLED ซึ่งเป็นทางแยก) */
export const ORDER_FLOW: OrderStatus[] = [
  'DRAFT', 'CONFIRMED', 'SENT_TO_PREP', 'PICKING', 'ISSUED', 'READY', 'DELIVERED',
];

export const orderStatusLabel = (status: string | null | undefined) => statusLabel('order', status);
export const orderStatusInfo = (status: string | null | undefined) => statusInfo('order', status);
export const orderBadgeClass = (status: string | null | undefined) => STATUS_BADGE[orderStatusInfo(status).tone];
export type { StatusTone };

/**
 * เปลี่ยนสถานะไปไหนได้บ้าง — สำเนาของตาราง transitions ฝั่ง backend
 * ใช้เพื่อ "ไม่แสดงปุ่มที่กดแล้วจะโดน 409" เท่านั้น
 * backend ยังเป็นผู้ตัดสินจริงเสมอ
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SENT_TO_PREP', 'CANCELLED'],
  SENT_TO_PREP: ['PICKING', 'CANCELLED'],
  PICKING: ['ISSUED', 'CANCELLED'],
  ISSUED: ['READY'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const canTransition = (from: string, to: OrderStatus): boolean =>
  (ORDER_TRANSITIONS[from as OrderStatus] ?? []).includes(to);

/** ปุ่มหลักของแต่ละสถานะ — คำที่ใช้บนปุ่ม ไม่ใช่ชื่อสถานะปลายทาง */
export const NEXT_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  DRAFT: 'ยืนยันออเดอร์',
  CONFIRMED: 'ส่งเข้าครัว',
  SENT_TO_PREP: 'เริ่มจัดสินค้า',
  PICKING: 'จ่ายของแล้ว',
  ISSUED: 'พร้อมส่ง',
  READY: 'ส่งมอบแล้ว',
};

/** ขั้นถัดไปตามสายงานหลัก (ไม่ใช่การยกเลิก) */
export function nextStatus(current: string): OrderStatus | null {
  const allowed = ORDER_TRANSITIONS[current as OrderStatus] ?? [];
  return allowed.find((s) => s !== 'CANCELLED') ?? null;
}

/* ============================================================
   ระดับราคา
   ============================================================ */
/**
 * priceType ใน schema เป็น String อิสระ คอมเมนต์ระบุ RETAIL | WHOLESALE | AGENT | SPECIAL
 * และ costing.route.ts บังคับด้วย z.enum เดียวกัน — ใช้ชุดนี้เท่านั้น ห้ามคิดใหม่
 *
 * ข้อจำกัดที่ต้องรู้: SalesOrder / SalesOrderItem ไม่มีคอลัมน์เก็บระดับราคา
 * ระดับที่เลือกจึงเป็นเพียงตัวช่วยเติมราคาต่อหน่วยตอนสร้าง
 * สิ่งที่ถูกบันทึกจริงคือ unitPrice ของแต่ละบรรทัด
 */
export const PRICE_TIERS = ['RETAIL', 'WHOLESALE', 'AGENT'] as const;
export type PriceTierCode = (typeof PRICE_TIERS)[number];

export const PRICE_TIER_LABEL: Record<string, string> = {
  RETAIL: 'ราคาปลีก',
  WHOLESALE: 'ราคาส่ง',
  AGENT: 'ราคาคนรู้จัก',
  SPECIAL: 'ราคาพิเศษ',
};

/** ระดับที่ไม่รู้จักคืนค่าดิบ ไม่เดาความหมาย */
export const priceTierLabel = (code: string | null | undefined): string => {
  if (!code) return '—';
  return PRICE_TIER_LABEL[code] ?? code;
};

/* ============================================================
   ยอดเงินของออเดอร์
   ============================================================ */
const n = (v: unknown) => {
  const x = Number(typeof v === 'object' && v !== null ? String(v) : v);
  return Number.isFinite(x) ? x : 0;
};

export interface OrderLineInput { quantity: number | string; unitPrice: number | string }
export interface OrderTotals {
  lineCount: number;
  totalQuantity: number;
  subtotal: number;
  discount: number;
  tax: number;
  /** ยอดสุทธิ — สูตรเดียวกับ backend: max(0, subtotal - discount + tax) */
  total: number;
}

/**
 * รวมยอดด้วยสูตรเดียวกับ POST /business/orders เป๊ะ
 *   subtotal    = ผลรวม(quantity × unitPrice)
 *   totalAmount = max(0, subtotal − discount + tax)
 * ใช้เพื่อ "แสดงให้เห็นก่อนกดบันทึก" เท่านั้น ตัวเลขที่บันทึกจริงมาจาก backend
 */
export function orderTotals(lines: OrderLineInput[], discount: number | string = 0, tax: number | string = 0): OrderTotals {
  const subtotal = lines.reduce((s, l) => s + n(l.quantity) * n(l.unitPrice), 0);
  const d = n(discount);
  const t = n(tax);
  return {
    lineCount: lines.length,
    totalQuantity: lines.reduce((s, l) => s + n(l.quantity), 0),
    subtotal,
    discount: d,
    tax: t,
    total: Math.max(0, subtotal - d + t),
  };
}

/** ยอดของบรรทัดเดียว — lineTotal = quantity × unitPrice ตาม backend */
export const lineTotal = (quantity: number | string, unitPrice: number | string) => n(quantity) * n(unitPrice);

/**
 * ราคานี้ต่ำกว่าต้นทุนไหม — เตือนเท่านั้น ไม่บล็อก (business rule เดิมไม่บล็อก)
 * ไม่มีข้อมูลต้นทุนจริง → คืน null ไม่เดา
 */
export function belowCost(unitPrice: number | string, cost: number | null | undefined): number | null {
  if (cost == null || !Number.isFinite(Number(cost)) || Number(cost) <= 0) return null;
  const diff = Number(cost) - n(unitPrice);
  return diff > 0 ? diff : null;
}
