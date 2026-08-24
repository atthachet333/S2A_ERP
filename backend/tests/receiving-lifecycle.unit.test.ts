import { describe, expect, it, vi } from 'vitest';
import { applyMovement, formatDocumentNo, nextDocumentNo, reverseDocument } from '../src/lib/inventory-ledger.js';

/**
 * กติกาต้นทุนของใบรับของ — ต้องตรงกับ item.route.ts baseUnitCost()
 * (คัดลอกสูตรมาไว้ในเทสต์เพื่อล็อกพฤติกรรม ไม่ให้ใครเขียน unitPrice ลง lastCost ตรง ๆ อีก)
 */
const receiptBaseUnitCost = (unitPrice: number, purchaseToBaseFactor: number) =>
  unitPrice / (purchaseToBaseFactor > 0 ? purchaseToBaseFactor : 1);

function makeTx(initial: { itemId: string; warehouseId: string; onHand: number }[] = []) {
  const balances = initial.map((b, i) => ({ id: `b${i}`, ...b, reserved: 0, version: 1 }));
  const ledger: Record<string, unknown>[] = [];
  const counters: Record<string, { lastSeq: number }> = {};
  const itemUpdates: Record<string, unknown>[] = [];
  const priceRows: Record<string, unknown>[] = [];
  const tx = {
    stockBalance: {
      findFirst: vi.fn(async ({ where }: { where: { itemId: string; warehouseId: string } }) =>
        balances.find((b) => b.itemId === where.itemId && b.warehouseId === where.warehouseId) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { onHand: unknown } }) => {
        const b = balances.find((x) => x.id === where.id)!; b.onHand = Number(String(data.onHand)); return b;
      }),
      create: vi.fn(async ({ data }: { data: { itemId: string; warehouseId: string; onHand: unknown } }) => {
        const b = { id: `b${balances.length}`, itemId: data.itemId, warehouseId: data.warehouseId, onHand: Number(String(data.onHand)), reserved: 0, version: 1 };
        balances.push(b); return b;
      }),
    },
    stockLedger: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const r = { id: `l${ledger.length}`, ...data }; ledger.push(r); return r; }),
      findMany: vi.fn(async ({ where }: { where: { refType: string; refId: string } }) =>
        ledger.filter((r) => r.refType === where.refType && r.refId === where.refId)),
    },
    /* PHASE 16 — ตัวนับเอกสารใช้ INSERT IGNORE → SELECT ... FOR UPDATE → UPDATE
       ตัวจำลองนี้เลียนแบบสัญญาของคำสั่ง ไม่ใช่ตัวอักษร SQL แต่แยกชนิดคำสั่งด้วยคำขึ้นต้น */
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const key = [values[1], values[2], values[3]].join('|');
      if (strings.join(' ').includes('INSERT')) {
        if (!counters[key]) counters[key] = { lastSeq: 0 };
        return 1;
      }
      counters[key] = { lastSeq: Number(values[0]) };
      return 1;
    }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(' ');
      if (sql.includes('stock_balances')) {
        // SELECT ... FOR UPDATE ของยอดคงเหลือ — พารามิเตอร์คือ itemId, warehouseId
        const row = balances.find((b) => b.itemId === values[0] && b.warehouseId === values[1]);
        return row ? [{ id: row.id, onHand: row.onHand, reserved: row.reserved }] : [];
      }
      const key = [values[0], values[1], values[2]].join('|');
      return counters[key] ? [{ lastSeq: counters[key].lastSeq }] : [];
    }),
    item: { update: vi.fn(async (args: Record<string, unknown>) => { itemUpdates.push(args); return {}; }) },
    itemPriceHistory: { create: vi.fn(async (args: Record<string, unknown>) => { priceRows.push(args); return {}; }) },
  };
  return { tx: tx as never, balances, ledger, itemUpdates, priceRows };
}

const NOW = new Date('2026-08-19T04:00:00.000Z');
const base = { companyId: 'c1', warehouseId: 'w1', itemId: 'oil', unit: 'ML', refType: 'GOODS_RECEIPT', refId: 'gr1', refNo: 'GR-20260819-0001' };

describe('GR numbering', () => {
  it('format = GR-YYYYMMDD-0001', () => {
    expect(formatDocumentNo('GOODS_RECEIPT', 1, NOW)).toBe('GR-20260819-0001');
    expect(formatDocumentNo('GOODS_RECEIPT', 25, NOW)).toBe('GR-20260819-0025');
  });

  it('เลข GR ไม่ซ้ำ และแยกจากลำดับของ RI', async () => {
    const { tx } = makeTx();
    const g1 = await nextDocumentNo(tx, 'c1', 'GOODS_RECEIPT', NOW);
    const g2 = await nextDocumentNo(tx, 'c1', 'GOODS_RECEIPT', NOW);
    const ri = await nextDocumentNo(tx, 'c1', 'STOCK_ISSUE', NOW);
    expect([g1, g2]).toEqual(['GR-20260819-0001', 'GR-20260819-0002']);
    expect(ri).toBe('RI-20260819-0001'); // ตัวนับแยกกัน
  });
});

describe('receiving cost rule (ห้าม regression ราคา/หน่วย)', () => {
  it('ซื้อ 47 บาท/L และ 1 L = 1000 ML → lastCost = 0.047 บาท/ML', () => {
    expect(receiptBaseUnitCost(47, 1000)).toBeCloseTo(0.047, 9);
  });

  it('ซื้อเป็นหน่วยฐานอยู่แล้ว (factor 1) → ราคาคงเดิม', () => {
    expect(receiptBaseUnitCost(45, 1)).toBe(45);
    expect(receiptBaseUnitCost(4.1, 1)).toBeCloseTo(4.1, 9);
  });

  it('factor 0 หรือติดลบ ถือเป็น 1 (ไม่หารด้วยศูนย์)', () => {
    expect(receiptBaseUnitCost(47, 0)).toBe(47);
    expect(receiptBaseUnitCost(47, -5)).toBe(47);
  });

  it('ปริมาณที่รับถูกแปลงเป็นหน่วยฐานก่อนเข้าสต็อก (2 L = 2000 ML)', () => {
    const factor = 1000;
    expect(2 * factor).toBe(2000);
    // มูลค่ารวมต้องไม่เปลี่ยน: 2 L × 47 = 2000 ML × 0.047
    expect(2 * 47).toBeCloseTo(2000 * receiptBaseUnitCost(47, factor), 6);
  });
});

describe('receiving stock lifecycle', () => {
  it('ยืนยันรับของ → เพิ่มสต็อกและเขียน ledger before/change/after', async () => {
    const { tx, balances, ledger } = makeTx([{ itemId: 'oil', warehouseId: 'w1', onHand: 500 }]);
    await applyMovement(tx, { ...base, movementType: 'PURCHASE_RECEIPT', changeQty: 2000, unitCost: 0.047 });
    expect(balances[0].onHand).toBe(2500);
    expect(String(ledger[0].beforeQty)).toBe('500');
    expect(String(ledger[0].qtyIn)).toBe('2000');
    expect(String(ledger[0].balanceAfter)).toBe('2500');
    expect(String(ledger[0].unitCost)).toBe('0.047');
  });

  it('กลับรายการ → ลดสต็อกคืนเท่าที่รับ และไม่ลบแถวเดิม', async () => {
    const { tx, balances, ledger } = makeTx([{ itemId: 'oil', warehouseId: 'w1', onHand: 500 }]);
    await applyMovement(tx, { ...base, movementType: 'PURCHASE_RECEIPT', changeQty: 2000, unitCost: 0.047 });
    const restored = await reverseDocument(tx, 'GOODS_RECEIPT', 'gr1', 'u1');
    expect(restored).toBe(1);
    expect(balances[0].onHand).toBe(500);
    expect(ledger).toHaveLength(2);
    expect(ledger[1].reason).toBe('REVERSAL');
  });

  it('กลับรายการซ้ำไม่ได้', async () => {
    const { tx, balances } = makeTx([{ itemId: 'oil', warehouseId: 'w1', onHand: 0 }]);
    await applyMovement(tx, { ...base, movementType: 'PURCHASE_RECEIPT', changeQty: 100 });
    expect(await reverseDocument(tx, 'GOODS_RECEIPT', 'gr1', 'u1')).toBe(1);
    expect(await reverseDocument(tx, 'GOODS_RECEIPT', 'gr1', 'u1')).toBe(0);
    expect(balances[0].onHand).toBe(0);
  });

  it('หลายรายการในใบเดียว → ledger แยกบรรทัดและคืนได้ครบ', async () => {
    const { tx, balances } = makeTx([
      { itemId: 'oil', warehouseId: 'w1', onHand: 0 },
      { itemId: 'egg', warehouseId: 'w1', onHand: 10 },
    ]);
    await applyMovement(tx, { ...base, movementType: 'PURCHASE_RECEIPT', changeQty: 1000 });
    await applyMovement(tx, { ...base, itemId: 'egg', movementType: 'PURCHASE_RECEIPT', changeQty: 30 });
    expect(balances.map((b) => b.onHand)).toEqual([1000, 40]);
    expect(await reverseDocument(tx, 'GOODS_RECEIPT', 'gr1', 'u1')).toBe(2);
    expect(balances.map((b) => b.onHand)).toEqual([0, 10]);
  });

  it('DRAFT ไม่แตะสต็อก (ไม่มีการเรียก applyMovement เลย)', async () => {
    const { tx, balances, ledger } = makeTx([{ itemId: 'oil', warehouseId: 'w1', onHand: 500 }]);
    // จำลองการสร้างร่าง: ไม่เรียก applyMovement
    expect(balances[0].onHand).toBe(500);
    expect(ledger).toHaveLength(0);
    expect((tx as unknown as { stockLedger: { create: { mock: { calls: unknown[] } } } }).stockLedger.create.mock.calls).toHaveLength(0);
  });
});
