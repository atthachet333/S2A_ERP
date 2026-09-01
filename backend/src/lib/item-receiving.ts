import { Prisma } from '@prisma/client';

/**
 * PHASE 35 — หลักฐานการรับเข้าสต็อกรายวัตถุดิบ
 *
 * ส่วนบนของไฟล์นี้ "อ่านอย่างเดียว" ทั้งหมด ไม่แตะสต็อกและไม่แตะต้นทุน
 * การเพิ่ม/ลดสต็อกยังผ่าน applyMovement ของ inventory-ledger เท่านั้น
 *
 * ส่วนล่าง (PHASE 36 — reconcileItemLastCost) เขียน Item.lastCost/avgCost ได้
 * แต่เขียนได้เฉพาะ "ค่าที่คำนวณจากใบรับของที่ยังยืนยันอยู่จริง" เท่านั้น
 * และต้องถูกเรียกจากใน transaction ของผู้เรียกเสมอ
 *
 * เลขเงินทั้งหมดคิดด้วย Prisma.Decimal ไม่ใช้ floating point
 * (0.1 + 0.2 ของ JS ให้ 0.30000000000000004 — ยอมรับไม่ได้กับมูลค่าสต็อก)
 */

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);

/** เหตุผลการรับเข้า — เก็บเป็น String ใน GoodsReceipt.receiveReason */
export const RECEIVE_REASONS = ['PURCHASE', 'OPENING', 'ADJUST', 'OTHER'] as const;
export type ReceiveReason = (typeof RECEIVE_REASONS)[number];

/**
 * ใบรับของที่บันทึกก่อนมีฟิลด์นี้จะเป็น NULL
 * ตีความเป็น PURCHASE เฉพาะตอนแสดงผล — ไม่มีการ backfill เขียนทับแถวเดิม
 */
export const receiveReasonOf = (value: string | null | undefined): ReceiveReason =>
  (RECEIVE_REASONS as readonly string[]).includes(value ?? '') ? (value as ReceiveReason) : 'PURCHASE';

export const RECEIVE_REASON_TH: Record<ReceiveReason, string> = {
  PURCHASE: 'รับเข้าจากการซื้อ',
  OPENING: 'ยอดตั้งต้น',
  ADJUST: 'ปรับยอด / พบสต็อกเพิ่ม',
  OTHER: 'อื่น ๆ',
};

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** คีย์เดือนตามเวลาไทย เช่น 2026-09 — ใช้เป็นตัวกรอง "เดือน" ของประวัติรับเข้า */
export const monthKeyOf = (value: Date) =>
  new Date(value.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 7);

/** ช่วงเวลา UTC ที่ครอบคลุมเดือนไทยหนึ่งเดือน (YYYY-MM) */
export function monthRange(monthKey: string): { gte: Date; lt: Date } {
  const [year, month] = monthKey.split('-').map(Number);
  const startUtc = Date.UTC(year, month - 1, 1) - BANGKOK_OFFSET_MS;
  const endUtc = Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) - BANGKOK_OFFSET_MS;
  return { gte: new Date(startUtc), lt: new Date(endUtc) };
}

/** วันเดือนปีพุทธ + เวลา ตามเวลาไทย เช่น "1 ก.ย. 2569 09:32" */
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function thaiDateTime(value: Date): string {
  const d = new Date(value.getTime() + BANGKOK_OFFSET_MS);
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${d.getUTCDate()} ${TH_MONTH[d.getUTCMonth()]} ${d.getUTCFullYear() + 543} ${time}`;
}

/** Decimal.toString ตัดศูนย์ท้ายให้เองอยู่แล้ว (20.0000 -> "20") จึงไม่ต้องตกแต่งเพิ่ม */
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(4).toString();

/**
 * อัตราแปลงที่ใช้จริงของบรรทัด
 * ใบที่ผูก PO เก็บ snapshot ของอัตราไว้ที่บรรทัด — ใบเก่าที่ไม่มี snapshot ใช้ค่าจาก item master
 * กติกาเดียวกับ confirmReceiptWithin เป๊ะ ๆ (ห้ามมีสองสูตร)
 */
export function lineFactor(line: { purchaseToBaseFactor: Prisma.Decimal | null }, item: { purchaseToBaseFactor: Prisma.Decimal }): Prisma.Decimal {
  const raw = line.purchaseToBaseFactor == null ? item.purchaseToBaseFactor : line.purchaseToBaseFactor;
  const factor = D(raw);
  return factor.gt(0) ? factor : new Prisma.Decimal(1);
}

export interface ReceiptLineMath {
  factor: Prisma.Decimal;
  /** ปริมาณในหน่วยฐาน = ปริมาณหน่วยซื้อ x อัตราแปลง */
  baseQty: Prisma.Decimal;
  /** ต้นทุนต่อหน่วยฐาน = ราคาต่อหน่วยซื้อ ÷ อัตราแปลง */
  baseUnitCost: Prisma.Decimal;
  /** มูลค่ารับเข้าของบรรทัด = ปริมาณหน่วยซื้อ x ราคาต่อหน่วยซื้อ */
  lineValue: Prisma.Decimal;
}

export function receiptLineMath(
  line: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; purchaseToBaseFactor: Prisma.Decimal | null },
  item: { purchaseToBaseFactor: Prisma.Decimal },
): ReceiptLineMath {
  const factor = lineFactor(line, item);
  const quantity = D(line.quantity);
  const unitPrice = D(line.unitPrice);
  return {
    factor,
    baseQty: quantity.mul(factor),
    baseUnitCost: unitPrice.div(factor),
    lineValue: quantity.mul(unitPrice),
  };
}

export interface ReceivingSummaryInput {
  receivedAt: Date;
  itemName: string;
  quantity: Prisma.Decimal | number | string;
  unitCode: string;
  unitPrice: Prisma.Decimal | number | string;
  totalValue: Prisma.Decimal | number | string;
  supplierName?: string | null;
  reason: ReceiveReason;
  lotNo?: string | null;
  remark?: string | null;
}

/**
 * สรุปการรับเข้าแบบอ่านรู้เรื่องสำหรับหน้าประวัติ/ตรวจสอบ
 *
 * ข้อความนี้เป็น "การนำเสนอ" เท่านั้น — ไม่เก็บลงฐานข้อมูลและไม่ใช้เป็นแหล่งความจริง
 * ตัวเลขจริงอยู่ที่คอลัมน์ที่มีโครงสร้างของ GoodsReceiptItem / StockLedger เสมอ
 */
export function receivingSummary(input: ReceivingSummaryInput): string {
  const lines = [
    thaiDateTime(input.receivedAt),
    `รับ${input.itemName} ${money(D(input.quantity))} ${input.unitCode}`,
    `ราคา ${money(D(input.unitPrice))} บาท/${input.unitCode}`,
    `มูลค่า ${money(D(input.totalValue))} บาท`,
  ];
  if (input.supplierName) lines.push(`Supplier: ${input.supplierName}`);
  lines.push(`ประเภท: ${RECEIVE_REASON_TH[input.reason]}`);
  if (input.lotNo) lines.push(`Lot: ${input.lotNo}`);
  if (input.remark?.trim()) lines.push(`หมายเหตุ: ${input.remark.trim()}`);
  return lines.join('\n');
}

export interface WeightedCost {
  /** ผลรวมปริมาณหน่วยฐานที่เคยรับเข้า (เฉพาะใบที่ยืนยันและยังไม่ถูกกลับรายการ) */
  receivedBaseQty: Prisma.Decimal;
  /** ผลรวมมูลค่ารับเข้า */
  receivedValue: Prisma.Decimal;
  /** ต้นทุนเฉลี่ยถ่วงน้ำหนักของการรับเข้า — null เมื่อยังไม่มีปริมาณให้ถ่วง */
  weightedAverageCost: Prisma.Decimal | null;
}

/**
 * ต้นทุนเฉลี่ยถ่วงน้ำหนักจากหลักฐานการรับเข้า
 *
 * นับเฉพาะใบสถานะ CONFIRMED เท่านั้น ใบที่ถูกกลับรายการ (REVERSED) จึงหลุดออกเองโดยไม่ต้องหักลบ
 * ค่านี้เป็นตัวเลข "อนุพันธ์" สำหรับแสดงผล ไม่ได้เขียนกลับไปที่ Item.avgCost
 * (นโยบายมูลค่าสต็อกของระบบยังเป็น onHand x lastCost เหมือนเดิมทุกจุด)
 */
export function weightedCostOf(lines: ReceiptLineMath[]): WeightedCost {
  const receivedBaseQty = lines.reduce((sum, l) => sum.plus(l.baseQty), new Prisma.Decimal(0));
  const receivedValue = lines.reduce((sum, l) => sum.plus(l.lineValue), new Prisma.Decimal(0));
  return {
    receivedBaseQty,
    receivedValue,
    weightedAverageCost: receivedBaseQty.gt(0) ? receivedValue.div(receivedBaseQty) : null,
  };
}

/* ============================================================
   PHASE 36 — คืนต้นทุนล่าสุดหลังกลับรายการใบรับของ
   ============================================================ */

type Tx = Prisma.TransactionClient;

export interface LastCostReconciliation {
  itemId: string;
  /** ต้นทุนต่อหน่วยฐานก่อนปรับ (ข้อความ Decimal ไม่ใช่ number) */
  previous: string;
  /** ต้นทุนหลังปรับ — null เมื่อไม่มีหลักฐานเหลือ จึงไม่เขียนทับของเดิม */
  next: string | null;
  /**
   * CONFIRMED_RECEIPT   คำนวณใหม่จากใบรับของที่ยังยืนยันอยู่
   * UNCHANGED           ใบล่าสุดที่เหลือให้ค่าเท่าเดิมอยู่แล้ว จึงไม่ต้องเขียน
   * NO_EVIDENCE_KEPT    ไม่เหลือใบรับของที่ยืนยันเลย — คงค่าเดิมไว้ ไม่เขียนศูนย์ทับ
   */
  source: 'CONFIRMED_RECEIPT' | 'UNCHANGED' | 'NO_EVIDENCE_KEPT';
  /** เลขใบรับของที่ถูกใช้เป็นหลักฐานของต้นทุนใหม่ */
  receiptNo: string | null;
}

/**
 * คำนวณ Item.lastCost ใหม่จาก "ใบรับของที่ยังยืนยันอยู่ล่าสุด" ของวัตถุดิบหนึ่งรายการ
 *
 * ใช้หลังกลับรายการใบรับของ เพื่อไม่ให้ต้นทุนค้างอยู่ที่ราคาของใบที่ถูกยกเลิกไปแล้ว
 *   รับ 20 → รับ 35 (lastCost = 35) → กลับใบ 35 → lastCost กลับเป็น 20
 *
 * กติกาสำคัญสามข้อ
 *  1. นับเฉพาะใบสถานะ CONFIRMED — ใบ REVERSED/CANCELLED/DRAFT หลุดออกเอง
 *     ผู้เรียกจึงต้องอัปเดตสถานะใบที่กลับรายการให้เป็น REVERSED "ก่อน" เรียกฟังก์ชันนี้
 *  2. "ล่าสุด" นับตามวันที่บนเอกสาร (receiptDate) ซึ่งเป็นวันที่ทางธุรกิจ
 *     ไม่ใช่ลำดับการกดยืนยัน เพราะการรับของย้อนหลังต้องไม่กลายเป็นต้นทุนล่าสุด
 *  3. ไม่เหลือใบที่ยืนยันเลย = ไม่มีหลักฐาน จึง "ไม่เขียนอะไรทั้งนั้น"
 *     การเขียน 0 ลงไปจะเป็นต้นทุนปลอม และยังทำให้ costStatusOf อ่านผลเป็น ZERO
 *     ("ยืนยันแล้วว่าต้นทุนเป็นศูนย์จริง") ทั้งที่ไม่มีใครเคยยืนยันแบบนั้น
 *     กติกานี้ตรงกับที่ระบบทำมาตลอด คือ lastCost ถูกเขียนจากหลักฐานต้นทุนเท่านั้น ไม่เคยถูกล้าง
 *
 * เขียน avgCost ตามไปด้วยเสมอ เพื่อรักษาความสัมพันธ์เดิมของระบบ (ทุกจุดที่เขียน lastCost
 * เขียน avgCost เป็นค่าเดียวกัน) การแก้เฉพาะ lastCost จะทำให้สองค่านี้แยกจากกันเป็นครั้งแรก
 * ซึ่งเท่ากับเปลี่ยนนโยบายมูลค่าสต็อกโดยไม่ตั้งใจ
 *
 * ต้องรันใน transaction ของผู้เรียก เพื่อให้ ledger · สถานะเอกสาร · ต้นทุน สำเร็จหรือล้มพร้อมกัน
 */
export async function reconcileItemLastCost(tx: Tx, companyId: string, itemId: string, userId?: string | null): Promise<LastCostReconciliation> {
  const item = await tx.item.findFirstOrThrow({
    where: { id: itemId },
    select: { id: true, lastCost: true, purchaseToBaseFactor: true },
  });
  const previous = D(item.lastCost).toString();

  const line = await tx.goodsReceiptItem.findFirst({
    where: { itemId, goodsReceipt: { companyId, status: 'CONFIRMED' } },
    select: {
      quantity: true, unitPrice: true, purchaseToBaseFactor: true,
      goodsReceipt: { select: { receiptNo: true } },
    },
    // createdAt/id เป็นตัวตัดสินเมื่อวันที่เอกสารเท่ากัน ผลลัพธ์จึงคงที่ ไม่ขึ้นกับลำดับที่ฐานคืนแถว
    orderBy: [
      { goodsReceipt: { receiptDate: 'desc' } },
      { goodsReceipt: { createdAt: 'desc' } },
      { id: 'desc' },
    ],
  });

  if (!line) return { itemId, previous, next: null, source: 'NO_EVIDENCE_KEPT', receiptNo: null };

  const cost = receiptLineMath(line, item).baseUnitCost;
  const receiptNo = line.goodsReceipt.receiptNo;
  // ค่าเท่าเดิมก็ไม่ต้องเขียน — กัน updatedAt ของสินค้าขยับโดยไม่มีอะไรเปลี่ยนจริง
  if (cost.equals(D(item.lastCost))) return { itemId, previous, next: cost.toString(), source: 'UNCHANGED', receiptNo };

  await tx.item.update({ where: { id: itemId }, data: { lastCost: cost, avgCost: cost, updatedById: userId ?? null } });
  return { itemId, previous, next: cost.toString(), source: 'CONFIRMED_RECEIPT', receiptNo };
}

/**
 * คืนต้นทุนของทุกวัตถุดิบในใบที่ถูกกลับรายการ
 * เรียงตาม itemId เสมอ ให้ลำดับการจับล็อกแถวสินค้าเหมือนกันทุกใบ (กัน deadlock แบบเดียวกับ ledger)
 */
export async function reconcileItemsLastCost(tx: Tx, companyId: string, itemIds: readonly string[], userId?: string | null): Promise<LastCostReconciliation[]> {
  const results: LastCostReconciliation[] = [];
  for (const itemId of [...new Set(itemIds)].sort()) {
    results.push(await reconcileItemLastCost(tx, companyId, itemId, userId));
  }
  return results;
}
