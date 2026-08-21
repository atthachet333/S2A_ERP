import { Prisma, StockMovementType } from '@prisma/client';

/**
 * บัญชีสต็อก + เลขเอกสาร — backend เป็น source of truth เท่านั้น
 *
 * ใช้ตาราง stock_ledgers ที่มีอยู่เดิมเป็น ledger เดียวของระบบ (ไม่สร้างบัญชีชุดที่สอง)
 * กติกา:
 *  - ทุกการเปลี่ยน StockBalance.onHand ต้องเขียน StockLedger คู่กันเสมอ (beforeQty/qtyIn/qtyOut/balanceAfter)
 *  - ไม่ลบแถวเดิม การยกเลิกทำด้วยแถวตรงข้ามที่อ้าง refId เดิม
 *  - ต้องรันใน transaction ที่ผู้เรียกเปิดไว้ เพื่อให้ทั้งเอกสาร atomic (ไม่ตัดบางรายการ)
 */

export type Tx = Prisma.TransactionClient;

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

export type DocType = 'STOCK_ISSUE' | 'GOODS_RECEIPT' | 'STOCK_ADJUSTMENT';

/** prefix เลขเอกสาร — ใบเบิกครัวกลางใช้ RI */
const PREFIX: Record<DocType, string> = { STOCK_ISSUE: 'RI', GOODS_RECEIPT: 'GR', STOCK_ADJUSTMENT: 'AJ' };

/** YYYYMMDD ตามเวลาไทย */
export function periodKeyOf(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

/** จัดรูปเลขเอกสารจากลำดับ เช่น (STOCK_ISSUE, 1) → RI-20260819-0001 */
export function formatDocumentNo(docType: DocType, seq: number, now = new Date()): string {
  return `${PREFIX[docType]}-${periodKeyOf(now)}-${String(seq).padStart(4, '0')}`;
}

/**
 * ออกเลขเอกสารถัดไป — ปลอดภัยเมื่อผู้ใช้สร้างพร้อมกัน
 * upsert+increment ล็อกแถวตัวนับภายใน transaction และยังมี unique([companyId, issueNo]) เป็นด่านสุดท้าย
 */
export async function nextDocumentNo(tx: Tx, companyId: string, docType: DocType, now = new Date()): Promise<string> {
  const periodKey = periodKeyOf(now);
  const counter = await tx.documentCounter.upsert({
    where: { companyId_docType_periodKey: { companyId, docType, periodKey } },
    create: { companyId, docType, periodKey, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });
  return formatDocumentNo(docType, counter.lastSeq, now);
}

export interface MovementInput {
  companyId: string;
  warehouseId: string;
  itemId: string;
  movementType: StockMovementType;
  /** บวก = เข้า, ลบ = ออก (หน่วยฐานของ item) */
  changeQty: number;
  unit?: string | null;
  refType: string;
  refId: string;
  refNo: string;
  unitCost?: number;
  reason?: string | null;
  note?: string | null;
  createdById?: string | null;
}

export class InsufficientStockError extends Error {
  constructor(public readonly itemId: string, public readonly available: number, public readonly requested: number) {
    super(`สต็อกไม่พอ: คงเหลือใช้ได้ ${available} ต้องการ ${requested}`);
    this.name = 'InsufficientStockError';
  }
}

/**
 * ปรับ onHand + เขียน ledger หนึ่งแถว (ต้องอยู่ใน transaction)
 * ถ้าตัดออกแล้วไม่พอ → โยน InsufficientStockError เพื่อให้ทั้งเอกสาร rollback
 */
export async function applyMovement(tx: Tx, input: MovementInput) {
  const { companyId, warehouseId, itemId, changeQty } = input;

  const balance = await tx.stockBalance.findFirst({ where: { itemId, warehouseId, locationId: null, lotId: null } });
  const before = balance ? Number(balance.onHand) : 0;
  const after = before + changeQty;

  if (changeQty < 0) {
    const reserved = balance ? Number(balance.reserved) : 0;
    const available = before - reserved;
    if (available + 1e-9 < Math.abs(changeQty)) throw new InsufficientStockError(itemId, available, Math.abs(changeQty));
  }

  if (balance) await tx.stockBalance.update({ where: { id: balance.id }, data: { onHand: D(after), version: { increment: 1 } } });
  else await tx.stockBalance.create({ data: { itemId, warehouseId, onHand: D(after) } });

  const unitCost = input.unitCost ?? 0;
  return tx.stockLedger.create({
    data: {
      companyId, warehouseId, itemId,
      movementType: input.movementType,
      refType: input.refType, refId: input.refId, refNo: input.refNo,
      beforeQty: D(before),
      qtyIn: D(changeQty > 0 ? changeQty : 0),
      qtyOut: D(changeQty < 0 ? -changeQty : 0),
      balanceAfter: D(after),
      unit: input.unit ?? null,
      unitCost: D(unitCost),
      totalValue: D(Math.abs(changeQty) * unitCost),
      reason: input.reason ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });
}

/** movement ที่ระบบสร้างเป็น "ขากลับ" ของแต่ละชนิด */
const REVERSAL_OF: Partial<Record<StockMovementType, StockMovementType>> = {
  PRODUCTION_ISSUE: StockMovementType.PRODUCTION_RETURN,
  PURCHASE_RECEIPT: StockMovementType.ADJUSTMENT_OUT,
  ADJUSTMENT_IN: StockMovementType.ADJUSTMENT_OUT,
  ADJUSTMENT_OUT: StockMovementType.ADJUSTMENT_IN,
};

/**
 * กลับรายการทั้งใบ — อ่าน ledger เดิมของเอกสารแล้วเขียนแถวตรงข้าม
 * ไม่ลบแถวเดิม และกันการกลับซ้ำด้วย reason='REVERSAL' (ถ้าเคยกลับแล้วคืน 0)
 */
export async function reverseDocument(tx: Tx, refType: string, refId: string, createdById?: string | null) {
  const rows = await tx.stockLedger.findMany({ where: { refType, refId } });
  const original = rows.filter((r) => r.reason !== 'REVERSAL');
  if (original.length === 0 || rows.some((r) => r.reason === 'REVERSAL')) return 0;

  for (const m of original) {
    const change = Number(m.qtyIn) - Number(m.qtyOut); // ทิศทางเดิม
    await applyMovement(tx, {
      companyId: m.companyId ?? '',
      warehouseId: m.warehouseId,
      itemId: m.itemId,
      movementType: REVERSAL_OF[m.movementType] ?? StockMovementType.ADJUSTMENT_IN,
      changeQty: -change,
      unit: m.unit,
      refType, refId, refNo: m.refNo ?? '',
      unitCost: Number(m.unitCost),
      reason: 'REVERSAL',
      note: `กลับรายการจาก ledger ${m.id}`,
      createdById,
    });
  }
  return original.length;
}
