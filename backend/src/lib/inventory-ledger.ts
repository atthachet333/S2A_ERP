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

export type DocType = 'STOCK_ISSUE' | 'GOODS_RECEIPT' | 'STOCK_ADJUSTMENT' | 'STOCK_TRANSFER' | 'PRODUCTION_RUN' | 'PURCHASE_PLAN' | 'PURCHASE_ORDER';

/** prefix เลขเอกสาร — ใบเบิกครัวกลางใช้ RI */
const PREFIX: Record<DocType, string> = { STOCK_ISSUE: 'RI', GOODS_RECEIPT: 'GR', STOCK_ADJUSTMENT: 'AJ', STOCK_TRANSFER: 'TR', PRODUCTION_RUN: 'PR', PURCHASE_PLAN: 'PP', PURCHASE_ORDER: 'PO' };

/** YYYYMMDD ตามเวลาไทย */
export function periodKeyOf(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

/** จัดรูปเลขเอกสารจากลำดับ เช่น (STOCK_ISSUE, 1) → RI-20260819-0001 */
export function formatDocumentNo(docType: DocType, seq: number, now = new Date()): string {
  return `${PREFIX[docType]}-${periodKeyOf(now)}-${String(seq).padStart(4, '0')}`;
}

/** ตัวนับของออเดอร์ขาย — periodKey คงที่ เพราะเลข SO เดินต่อเนื่องทั้งบริษัท ไม่รีเซ็ตตามวันหรือปี */
const SALES_ORDER_DOC_TYPE = 'SALES_ORDER';
const SALES_ORDER_PERIOD_KEY = 'ALL';

/**
 * จองลำดับเลขเอกสารถัดไปแบบ atomic
 *
 * PHASE 16 — เดิมใช้ prisma upsert ซึ่งแปลเป็น SELECT แล้วค่อย INSERT/UPDATE
 * ภายใต้ REPEATABLE READ ของ MariaDB คำขอที่เข้ามาพร้อมกันจะเห็น snapshot เดียวกันว่า "ยังไม่มีแถว"
 * แล้วแย่งกัน INSERT ทำให้คำขอที่ช้ากว่าล้มด้วย P2002 ทั้งที่เป็นคำขอที่ถูกต้อง
 *
 * วิธีที่ใช้: INSERT IGNORE ให้แถวมีอยู่ก่อน → SELECT ... FOR UPDATE ล็อกและอ่านค่าล่าสุด → UPDATE ขณะถือล็อก
 * ทุกคำสั่งเป็น write หรือ locking read จึงไม่เปิด consistent read view ของ transaction
 * ข้อนี้สำคัญมาก: ถ้ามีคำสั่งอ่านธรรมดาเกิดขึ้นก่อนในใบเดียวกัน MariaDB จะปฏิเสธการแก้แถวตัวนับ
 * ที่ transaction อื่น commit ไปหลัง snapshot ด้วย ER_CHECKREAD (1020)
 * ผู้เรียกจึงต้องออกเลข "เป็นคำสั่งแรก" ของ transaction เสมอ
 *
 * เลือกวิธีนี้แทนการเปลี่ยน isolation เป็น READ COMMITTED เพราะ applyMovement อ่าน stockBalance
 * แล้วค่อยเขียนโดยไม่ล็อกแถว การผ่อน isolation จะเปลี่ยน error ให้กลายเป็น lost update เงียบ ๆ
 *
 * id ผูกกับคีย์ที่ไม่ซ้ำโดยตรง เพื่อไม่ให้เกิดแถวซ้ำแม้ในกรณีที่ unique index หายไป
 */
/** ล็อกแถวตัวนับแล้วคืนค่าปัจจุบัน — คืน null เมื่อยังไม่มีแถว */
async function lockCounter(tx: Tx, companyId: string, docType: string, periodKey: string): Promise<number | null> {
  const rows = await tx.$queryRaw<{ lastSeq: number }[]>`
    SELECT \`lastSeq\` FROM \`document_counters\`
     WHERE \`companyId\` = ${companyId} AND \`docType\` = ${docType} AND \`periodKey\` = ${periodKey}
     FOR UPDATE`;
  if (rows.length === 0) return null;
  const current = Number(rows[0]?.lastSeq);
  // ไม่มีการเดาเลขสำรองหรือเติมท้ายแบบสุ่ม — ถ้าอ่านตัวนับไม่ได้ต้องล้มทั้งเอกสาร
  if (!Number.isInteger(current) || current < 0) throw new Error('DOCUMENT_COUNTER_UNAVAILABLE');
  return current;
}

/** เขียนค่าใหม่ขณะที่ยังถือล็อกจาก lockCounter อยู่ */
async function writeCounter(tx: Tx, companyId: string, docType: string, periodKey: string, next: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE \`document_counters\` SET \`lastSeq\` = ${next}, \`updatedAt\` = NOW(3)
     WHERE \`companyId\` = ${companyId} AND \`docType\` = ${docType} AND \`periodKey\` = ${periodKey}`;
}

const counterIdOf = (companyId: string, docType: string, periodKey: string) => `${companyId}:${docType}:${periodKey}`;

/**
 * โครงเดียวกันของทุกชนิดเอกสาร: ล็อกก่อน ถ้ายังไม่มีแถวค่อยสร้างแล้วล็อกใหม่
 *
 * ลำดับนี้สำคัญ — INSERT IGNORE ที่ชนแถวเดิมจะจับ shared lock ของแถวนั้นไว้
 * ถ้ายิง INSERT ก่อนทุกครั้ง สอง transaction จะถือ S แล้วต่างรอ X ของกันและกันจนเกิด deadlock (1213)
 * เมื่อแถวมีอยู่แล้ว (กรณีปกติเกือบทั้งหมด) เส้นทางนี้จึงไม่มีคำสั่ง INSERT เลย
 */
async function allocateWith(tx: Tx, companyId: string, docType: string, periodKey: string, createRow: () => Promise<void>): Promise<number> {
  let current = await lockCounter(tx, companyId, docType, periodKey);
  if (current === null) {
    await createRow();
    current = await lockCounter(tx, companyId, docType, periodKey);
    if (current === null) throw new Error('DOCUMENT_COUNTER_UNAVAILABLE');
  }
  const next = current + 1;
  await writeCounter(tx, companyId, docType, periodKey, next);
  return next;
}

function allocateSeq(tx: Tx, companyId: string, docType: string, periodKey: string): Promise<number> {
  return allocateWith(tx, companyId, docType, periodKey, async () => {
    await tx.$executeRaw`
      INSERT IGNORE INTO \`document_counters\` (\`id\`, \`companyId\`, \`docType\`, \`periodKey\`, \`lastSeq\`, \`updatedAt\`)
      VALUES (${counterIdOf(companyId, docType, periodKey)}, ${companyId}, ${docType}, ${periodKey}, 0, NOW(3))`;
  });
}

/**
 * ออกเลขเอกสารถัดไป — ปลอดภัยเมื่อผู้ใช้สร้างพร้อมกัน
 * ตัวนับถูกล็อกระดับแถวตลอด transaction และยังมี unique([companyId, issueNo]) เป็นด่านสุดท้าย
 */
export async function nextDocumentNo(tx: Tx, companyId: string, docType: DocType, now = new Date()): Promise<string> {
  const seq = await allocateSeq(tx, companyId, docType, periodKeyOf(now));
  return formatDocumentNo(docType, seq, now);
}

/** จัดรูปเลขออเดอร์ขาย เช่น (1, 2026) → SO-2026-00001 */
export function formatOrderNo(seq: number, now = new Date()): string {
  return `SO-${now.getFullYear()}-${String(seq).padStart(5, '0')}`;
}

/**
 * ออกเลขออเดอร์ขายถัดไป
 *
 * เดิมนับจาก salesOrder.count() ทำให้สองคำขอพร้อมกันได้เลขเดียวกันและชน unique([companyId, orderNo])
 * ย้ายมาใช้ตัวนับเดียวกับเอกสารอื่น โดย seed ด้วยจำนวนออเดอร์เดิมในครั้งแรกที่ออกเลข
 * เลขถัดไปจึงต่อจากของเดิมพอดี รูปแบบและขอบเขต (ต่อบริษัท) ไม่เปลี่ยน
 */
export async function nextOrderNo(tx: Tx, companyId: string, now = new Date()): Promise<string> {
  const seq = await allocateWith(tx, companyId, SALES_ORDER_DOC_TYPE, SALES_ORDER_PERIOD_KEY, async () => {
    /* seed ด้วยจำนวนออเดอร์เดิมภายในคำสั่ง INSERT เอง
       ถ้าอ่านด้วย count() ก่อน จะเปิด read view ของ transaction ไว้ แล้วการแก้แถวตัวนับ
       ที่ transaction อื่น commit ไปหลังจากนั้นจะถูก MariaDB ปฏิเสธด้วย ER_CHECKREAD (1020) */
    await tx.$executeRaw`
      INSERT IGNORE INTO \`document_counters\` (\`id\`, \`companyId\`, \`docType\`, \`periodKey\`, \`lastSeq\`, \`updatedAt\`)
      SELECT ${counterIdOf(companyId, SALES_ORDER_DOC_TYPE, SALES_ORDER_PERIOD_KEY)}, ${companyId}, ${SALES_ORDER_DOC_TYPE}, ${SALES_ORDER_PERIOD_KEY}, COUNT(*), NOW(3)
        FROM \`sales_orders\` WHERE \`companyId\` = ${companyId}`;
  });
  return formatOrderNo(seq, now);
}

export interface MovementInput {
  companyId: string;
  warehouseId: string;
  itemId: string;
  locationId?: string | null;
  lotId?: string | null;
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

export interface LockedBalance {
  id: string;
  onHand: number;
  reserved: number;
}

/**
 * PHASE 17 — อ่านยอดคงเหลือแบบล็อกแถว (ต้องอยู่ใน transaction เท่านั้น)
 *
 * เดิมใช้ findFirst ซึ่งเป็น consistent read ภายใต้ REPEATABLE READ ของ MariaDB
 * สองคำขอที่ตัด/เพิ่มสต็อกพร้อมกันจึงอ่านยอดเดิมค่าเดียวกัน แล้วต่างเขียนทับกัน
 * ผลคือการเคลื่อนไหวที่ commit แล้วหายไปหนึ่งรายการ (lost update) โดยไม่มี error ใด ๆ
 *
 * SELECT ... FOR UPDATE เป็น locking read จึงเห็นค่าล่าสุดที่ commit แล้ว
 * และคำขออื่นจะรอคิวที่บรรทัดนี้จนกว่าเราจะ commit — การอ่านและการเขียนเป็นคู่ที่แยกกันไม่ได้
 *
 * คืน null เมื่อยังไม่มีแถวยอดคงเหลือของ (สินค้า · คลัง) นี้
 */
export async function lockBalance(tx: Tx, itemId: string, warehouseId: string, lotId?: string | null, locationId?: string | null): Promise<LockedBalance | null> {
  const rows = await tx.$queryRaw<{ id: string; onHand: unknown; reserved: unknown }[]>`
    SELECT \`id\`, \`onHand\`, \`reserved\` FROM \`stock_balances\`
     WHERE \`itemId\` = ${itemId} AND \`warehouseId\` = ${warehouseId}
       AND \`locationKey\` = ${locationId ?? ''} AND \`lotKey\` = ${lotId ?? ''}
     FOR UPDATE`;
  if (rows.length === 0) return null;
  return { id: rows[0].id, onHand: Number(String(rows[0].onHand)), reserved: Number(String(rows[0].reserved)) };
}

/**
 * ล็อกแถวยอดคงเหลือของทั้งเอกสารล่วงหน้า โดยเรียงตาม itemId เสมอ
 *
 * เอกสารสองใบที่แตะสินค้าชุดเดียวกันแต่คนละลำดับจะจับล็อกสวนทางกันจนเกิด deadlock
 * การบังคับลำดับเดียวกันทุกใบทำให้ใบหลังรอใบแรกเป็นคิวแทนที่จะวนตาย
 * (ล็อกเฉพาะแถวที่มีอยู่จริงเท่านั้น ไม่ล็อกทั้งตาราง)
 */
export async function lockBalancesInOrder(tx: Tx, warehouseId: string, itemIds: readonly string[]): Promise<void> {
  await lockBalancePairs(tx, itemIds.map((itemId) => ({ itemId, warehouseId })));
}

/**
 * PHASE 18 — ล็อกแถวยอดคงเหลือข้ามหลายคลังด้วยลำดับสากลเดียว (คลัง แล้วสินค้า)
 *
 * การโอนย้ายแตะสองคลังในใบเดียว ถ้าใบ A→B ล็อกคลัง A ก่อน แต่ใบ B→A ล็อกคลัง B ก่อน
 * ทั้งสองใบจะรอกันเองจนเกิด deadlock การเรียงด้วยคีย์เดียวกันทุกใบทำให้ใบหลังต่อคิวแทน
 */
export async function lockBalancePairs(tx: Tx, pairs: readonly { itemId: string; warehouseId: string; lotId?: string | null; locationId?: string | null }[]): Promise<void> {
  // id เป็น cuid (ตัวอักษรและตัวเลขล้วน) เครื่องหมาย | จึงใช้เป็นตัวคั่นได้โดยไม่กำกวม
  const keys = [...new Set(pairs.map((p) => `${p.warehouseId}|${p.itemId}|${p.locationId ?? ''}|${p.lotId ?? ''}`))].sort();
  for (const key of keys) {
    const [warehouseId, itemId, locationId, lotId] = key.split('|');
    await lockBalance(tx, itemId, warehouseId, lotId || null, locationId || null);
  }
}

/**
 * ปรับ onHand + เขียน ledger หนึ่งแถว (ต้องอยู่ใน transaction)
 * ถ้าตัดออกแล้วไม่พอ → โยน InsufficientStockError เพื่อให้ทั้งเอกสาร rollback
 */
export async function applyMovement(tx: Tx, input: MovementInput) {
  const { companyId, warehouseId, itemId, changeQty } = input;

  const balance = await lockBalance(tx, itemId, warehouseId, input.lotId, input.locationId);
  const before = balance ? balance.onHand : 0;
  const after = before + changeQty;

  if (changeQty < 0) {
    const reserved = balance ? balance.reserved : 0;
    const available = before - reserved;
    if (available + 1e-9 < Math.abs(changeQty)) throw new InsufficientStockError(itemId, available, Math.abs(changeQty));
  }

  if (balance) await tx.stockBalance.update({ where: { id: balance.id }, data: { onHand: D(after), version: { increment: 1 } } });
  else await tx.stockBalance.create({ data: { itemId, warehouseId, locationId: input.locationId ?? null, lotId: input.lotId ?? null, locationKey: input.locationId ?? '', lotKey: input.lotId ?? '', onHand: D(after) } });

  const unitCost = input.unitCost ?? 0;
  return tx.stockLedger.create({
    data: {
      companyId, warehouseId, itemId, locationId: input.locationId ?? null, lotId: input.lotId ?? null,
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
  // การกลับใบผลิตใช้ PRODUCTION_RETURN ทั้งขาคืนวัตถุดิบและขานำผลผลิตออก
  // โดย qtyIn/qtyOut เป็นตัวบอกทิศทาง จึงไม่ต้องเพิ่ม movement enum ใหม่
  PRODUCTION_OUTPUT: StockMovementType.PRODUCTION_RETURN,
  PURCHASE_RECEIPT: StockMovementType.ADJUSTMENT_OUT,
  ADJUSTMENT_IN: StockMovementType.ADJUSTMENT_OUT,
  ADJUSTMENT_OUT: StockMovementType.ADJUSTMENT_IN,
  // PHASE 18 — โอนย้ายระหว่างคลัง: ขากลับต้องสลับทิศของทั้งสองขา ไม่ใช่กลายเป็นการปรับปรุงสต็อก
  TRANSFER_OUT: StockMovementType.TRANSFER_IN,
  TRANSFER_IN: StockMovementType.TRANSFER_OUT,
};

/**
 * กลับรายการทั้งใบ — อ่าน ledger เดิมของเอกสารแล้วเขียนแถวตรงข้าม
 * ไม่ลบแถวเดิม และกันการกลับซ้ำด้วย reason='REVERSAL' (ถ้าเคยกลับแล้วคืน 0)
 */
export async function reverseDocument(tx: Tx, refType: string, refId: string, createdById?: string | null) {
  const rows = await tx.stockLedger.findMany({ where: { refType, refId } });
  const original = rows.filter((r) => r.reason !== 'REVERSAL');
  if (original.length === 0 || rows.some((r) => r.reason === 'REVERSAL')) return 0;

  // PHASE 17/18 — ล็อกตามลำดับสากลเดียวกับตอนสร้างเอกสาร ครอบคลุมเอกสารที่แตะหลายคลัง เช่น การโอนย้าย
  await lockBalancePairs(tx, original.map((m) => ({ itemId: m.itemId, warehouseId: m.warehouseId, lotId: m.lotId, locationId: m.locationId })));

  for (const m of original) {
    const change = Number(m.qtyIn) - Number(m.qtyOut); // ทิศทางเดิม
    await applyMovement(tx, {
      companyId: m.companyId ?? '',
      warehouseId: m.warehouseId,
      itemId: m.itemId,
      lotId: m.lotId,
      locationId: m.locationId,
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
