/**
 * PHASE 6 — คำศัพท์กลางของงาน Operations
 *
 * เดิมแต่ละหน้าเขียน mapping สถานะเป็นภาษาไทยเอง (list ของ Receiving, list ของ Issue,
 * ประวัติ Adjustment, หน้า Detail) ทำให้เอกสารเดียวกันขึ้นคนละคำ และบางหน้าโชว์ enum ดิบ
 *
 * สำคัญ: สถานะ "ชื่อเดียวกัน" มีความหมายต่างกันตามชนิดเอกสาร
 *   - CONFIRMED ของใบรับของ = รับเข้าสต็อกแล้ว
 *   - CONFIRMED ของออเดอร์ขาย = ยืนยันออเดอร์ (ยังไม่แตะสต็อก)
 *   - ISSUED ของใบเบิก = ตัดสต็อกแล้ว
 *   - ISSUED ของออเดอร์ขาย = จ่ายของออกแล้ว
 * จึงต้องแยก map ตามชนิดเอกสาร ห้ามยุบเป็นตารางเดียว
 */

export type DocKind = 'receiving' | 'issue' | 'adjustment' | 'order' | 'transfer';
export type StatusTone = 'draft' | 'done' | 'reversed' | 'cancelled' | 'progress';

export interface StatusInfo { label: string; tone: StatusTone }

const RECEIVING: Record<string, StatusInfo> = {
  DRAFT: { label: 'ร่าง', tone: 'draft' },
  CONFIRMED: { label: 'รับเข้าสต็อกแล้ว', tone: 'done' },
  REVERSED: { label: 'กลับรายการแล้ว', tone: 'reversed' },
  CANCELLED: { label: 'ยกเลิก', tone: 'cancelled' },
};

const ISSUE: Record<string, StatusInfo> = {
  DRAFT: { label: 'ร่าง', tone: 'draft' },
  ISSUED: { label: 'ตัดสต็อกแล้ว', tone: 'done' },
  CONFIRMED: { label: 'ตัดสต็อกแล้ว', tone: 'done' },
  REVERSED: { label: 'กลับรายการแล้ว', tone: 'reversed' },
  CANCELLED: { label: 'ยกเลิก', tone: 'cancelled' },
};

const ADJUSTMENT: Record<string, StatusInfo> = {
  CONFIRMED: { label: 'ปรับสต็อกแล้ว', tone: 'done' },
  REVERSED: { label: 'กลับรายการแล้ว', tone: 'reversed' },
};

/* PHASE 18 — ใบโอนย้ายใช้ enum DocumentStatus เดียวกับใบรับของ แต่คำอธิบายต่างกัน
   CONFIRMED ของใบโอนย้าย = ย้ายของออกจากคลังต้นทางเข้าคลังปลายทางแล้ว */
const TRANSFER: Record<string, StatusInfo> = {
  DRAFT: { label: 'ร่าง', tone: 'draft' },
  CONFIRMED: { label: 'โอนย้ายแล้ว', tone: 'done' },
  REVERSED: { label: 'กลับรายการแล้ว', tone: 'reversed' },
  CANCELLED: { label: 'ยกเลิก', tone: 'cancelled' },
};

/** ตรงกับ enum SalesOrderStatus ใน prisma/schema.prisma (ตรวจจากสคีมาจริง ไม่ได้เดา) */
const ORDER: Record<string, StatusInfo> = {
  DRAFT: { label: 'ร่าง', tone: 'draft' },
  CONFIRMED: { label: 'ยืนยันออเดอร์แล้ว', tone: 'progress' },
  SENT_TO_PREP: { label: 'ส่งครัวแล้ว', tone: 'progress' },
  PICKING: { label: 'กำลังจัดของ', tone: 'progress' },
  ISSUED: { label: 'จ่ายของแล้ว', tone: 'progress' },
  READY: { label: 'พร้อมส่ง', tone: 'progress' },
  DELIVERED: { label: 'ส่งแล้ว', tone: 'done' },
  CANCELLED: { label: 'ยกเลิก', tone: 'cancelled' },
};

const TABLES: Record<DocKind, Record<string, StatusInfo>> = {
  receiving: RECEIVING, issue: ISSUE, adjustment: ADJUSTMENT, order: ORDER, transfer: TRANSFER,
};

/** ไม่รู้จักสถานะ → คืนค่าดิบ ไม่เดาความหมาย (แต่ยังมี tone กลางให้แสดงผลได้) */
export function statusInfo(kind: DocKind, status: string | null | undefined): StatusInfo {
  if (!status) return { label: '—', tone: 'draft' };
  return TABLES[kind][status] ?? { label: status, tone: 'draft' };
}
export const statusLabel = (kind: DocKind, status: string | null | undefined) => statusInfo(kind, status).label;

/** คลาส badge ของ design system ที่ตรงกับแต่ละ tone */
export const STATUS_BADGE: Record<StatusTone, string> = {
  draft: 'muted', done: 'success', reversed: 'warning', cancelled: 'danger', progress: 'info',
};

/* ---------- ประเภทการเคลื่อนไหวสต็อก ---------- */
export type MovementTone = 'in' | 'out' | 'reversal';
export interface MovementInfo { label: string; tone: MovementTone }

const MOVEMENT: Record<string, MovementInfo> = {
  PURCHASE_RECEIPT: { label: 'รับเข้า', tone: 'in' },
  PRODUCTION_RETURN: { label: 'คืนเข้า', tone: 'in' },
  ADJUSTMENT_IN: { label: 'ปรับเพิ่ม', tone: 'in' },
  PRODUCTION_ISSUE: { label: 'เบิกออก', tone: 'out' },
  ADJUSTMENT_OUT: { label: 'ปรับลด', tone: 'out' },
  STOCK_COUNT: { label: 'นับสต็อก', tone: 'in' },
  // PHASE 18 — สองขาของใบโอนย้าย แยกให้เห็นชัดว่าออกจากคลังไหนและเข้าคลังไหน
  TRANSFER_OUT: { label: 'โอนออก', tone: 'out' },
  TRANSFER_IN: { label: 'โอนเข้า', tone: 'in' },
};

/** reason = REVERSAL มาก่อนเสมอ เพราะเป็นการกลับรายการไม่ว่าชนิดเดิมจะเป็นอะไร */
export function movementInfo(movementType: string, reason?: string | null): MovementInfo {
  if (reason === 'REVERSAL') return { label: 'กลับรายการ', tone: 'reversal' };
  return MOVEMENT[movementType] ?? { label: movementType, tone: 'in' };
}

/* ---------- ชนิดเอกสารต้นทาง ---------- */
export const REF_TYPE_TH: Record<string, string> = {
  GOODS_RECEIPT: 'ใบรับของ', STOCK_ISSUE: 'ใบเบิก', STOCK_ADJUSTMENT: 'ใบปรับปรุงสต็อก', STOCK_TRANSFER: 'ใบโอนย้ายระหว่างคลัง',
};
/** เส้นทางกลับไปเอกสารต้นทาง — ไม่รู้จักคืน null เพื่อไม่ให้สร้างลิงก์เสีย */
export function refTypeLink(refType: string | null | undefined): string | null {
  return refType === 'GOODS_RECEIPT' ? '/receiving'
    : refType === 'STOCK_ISSUE' ? '/stock-issues'
    : refType === 'STOCK_ADJUSTMENT' ? '/inventory/adjustments'
    : refType === 'STOCK_TRANSFER' ? '/stock-transfers'
    : null;
}
