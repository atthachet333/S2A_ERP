import { describe, expect, it, vi } from 'vitest';
import { formatDocumentNo, nextDocumentNo, periodKeyOf, applyMovement, reverseDocument, InsufficientStockError } from '../src/lib/inventory-ledger.js';

/** transaction client จำลอง — เก็บ balance/ledger ในหน่วยความจำเพื่อทดสอบกติกาโดยไม่แตะ DB จริง */
function makeTx(initial: { itemId: string; warehouseId: string; onHand: number; reserved?: number }[] = []) {
  const balances = initial.map((b, i) => ({ id: `b${i}`, ...b, reserved: b.reserved ?? 0, version: 1 }));
  const ledger: Record<string, unknown>[] = [];
  const counters: Record<string, { lastSeq: number }> = {};
  const tx = {
    stockBalance: {
      findFirst: vi.fn(async ({ where }: { where: { itemId: string; warehouseId: string } }) =>
        balances.find((b) => b.itemId === where.itemId && b.warehouseId === where.warehouseId) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { onHand: unknown } }) => {
        const b = balances.find((x) => x.id === where.id)!;
        b.onHand = Number(String(data.onHand));
        return b;
      }),
      create: vi.fn(async ({ data }: { data: { itemId: string; warehouseId: string; onHand: unknown } }) => {
        const b = { id: `b${balances.length}`, itemId: data.itemId, warehouseId: data.warehouseId, onHand: Number(String(data.onHand)), reserved: 0, version: 1 };
        balances.push(b);
        return b;
      }),
    },
    stockLedger: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `l${ledger.length}`, ...data };
        ledger.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { refType: string; refId: string } }) =>
        ledger.filter((r) => r.refType === where.refType && r.refId === where.refId)),
    },
    documentCounter: {
      upsert: vi.fn(async ({ where }: { where: { companyId_docType_periodKey: { companyId: string; docType: string; periodKey: string } } }) => {
        const k = Object.values(where.companyId_docType_periodKey).join('|');
        counters[k] = { lastSeq: (counters[k]?.lastSeq ?? 0) + 1 };
        return counters[k];
      }),
    },
  };
  return { tx: tx as never, balances, ledger };
}

const NOW = new Date('2026-08-19T04:00:00.000Z'); // 11:00 เวลาไทย

describe('document numbering', () => {
  it('RI format = RI-YYYYMMDD-0001', () => {
    expect(formatDocumentNo('STOCK_ISSUE', 1, NOW)).toBe('RI-20260819-0001');
    expect(formatDocumentNo('STOCK_ISSUE', 42, NOW)).toBe('RI-20260819-0042');
  });

  it('periodKey ใช้วันที่ไทย (UTC+7)', () => {
    expect(periodKeyOf(new Date('2026-08-18T18:00:00.000Z'))).toBe('20260819');
  });

  it('เลขไม่ซ้ำเมื่อออกต่อเนื่อง', async () => {
    const { tx } = makeTx();
    const a = await nextDocumentNo(tx, 'c1', 'STOCK_ISSUE', NOW);
    const b = await nextDocumentNo(tx, 'c1', 'STOCK_ISSUE', NOW);
    const c = await nextDocumentNo(tx, 'c1', 'STOCK_ISSUE', NOW);
    expect([a, b, c]).toEqual(['RI-20260819-0001', 'RI-20260819-0002', 'RI-20260819-0003']);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('แยกตัวนับตามบริษัทและชนิดเอกสาร', async () => {
    const { tx } = makeTx();
    expect(await nextDocumentNo(tx, 'c1', 'STOCK_ISSUE', NOW)).toBe('RI-20260819-0001');
    expect(await nextDocumentNo(tx, 'c2', 'STOCK_ISSUE', NOW)).toBe('RI-20260819-0001');
    expect(await nextDocumentNo(tx, 'c1', 'GOODS_RECEIPT', NOW)).toBe('GR-20260819-0001');
  });
});

describe('stock movements', () => {
  const base = { companyId: 'c1', warehouseId: 'w1', itemId: 'i1', unit: 'KG', refType: 'STOCK_ISSUE', refId: 'doc1', refNo: 'RI-20260819-0001' };

  it('ตัดสต็อก: before/change/after ถูกต้องและ balance ลดจริง', async () => {
    const { tx, balances, ledger } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 10 }]);
    await applyMovement(tx, { ...base, movementType: 'PRODUCTION_ISSUE', changeQty: -4 });
    expect(balances[0].onHand).toBe(6);
    expect(String(ledger[0].beforeQty)).toBe('10');
    expect(String(ledger[0].qtyOut)).toBe('4');
    expect(String(ledger[0].balanceAfter)).toBe('6');
  });

  it('รับเข้า: qtyIn ถูกบันทึกและ balance เพิ่ม', async () => {
    const { tx, balances, ledger } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 2 }]);
    await applyMovement(tx, { ...base, movementType: 'PURCHASE_RECEIPT', changeQty: 5, refType: 'GOODS_RECEIPT' });
    expect(balances[0].onHand).toBe(7);
    expect(String(ledger[0].qtyIn)).toBe('5');
    expect(String(ledger[0].qtyOut)).toBe('0');
  });

  it('สต็อกไม่พอ → โยน InsufficientStockError (เพื่อให้ทั้งเอกสาร rollback)', async () => {
    const { tx, balances } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 3 }]);
    await expect(applyMovement(tx, { ...base, movementType: 'PRODUCTION_ISSUE', changeQty: -5 }))
      .rejects.toBeInstanceOf(InsufficientStockError);
    expect(balances[0].onHand).toBe(3); // ไม่ถูกแตะ
  });

  it('reserved ถูกกันไว้ ไม่ให้เบิกเกิน available', async () => {
    const { tx } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 10, reserved: 8 }]);
    await expect(applyMovement(tx, { ...base, movementType: 'PRODUCTION_ISSUE', changeQty: -5 }))
      .rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('ยังไม่มี balance แถวนั้น → สร้างใหม่ตอนรับเข้า', async () => {
    const { tx, balances } = makeTx();
    await applyMovement(tx, { ...base, movementType: 'PURCHASE_RECEIPT', changeQty: 12, refType: 'GOODS_RECEIPT' });
    expect(balances).toHaveLength(1);
    expect(balances[0].onHand).toBe(12);
  });

  it('กลับรายการ: คืนสต็อกเท่าที่ตัดไป และไม่ลบแถวเดิม', async () => {
    const { tx, balances, ledger } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 10 }]);
    await applyMovement(tx, { ...base, movementType: 'PRODUCTION_ISSUE', changeQty: -4 });
    expect(balances[0].onHand).toBe(6);

    const restored = await reverseDocument(tx, 'STOCK_ISSUE', 'doc1', 'u1');
    expect(restored).toBe(1);
    expect(balances[0].onHand).toBe(10);          // คืนครบ
    expect(ledger).toHaveLength(2);                // แถวเดิมยังอยู่ + แถวกลับรายการ
    expect(ledger[1].reason).toBe('REVERSAL');
  });

  it('กลับรายการซ้ำไม่ได้ (คืน 0 และสต็อกไม่เปลี่ยนอีก)', async () => {
    const { tx, balances } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 10 }]);
    await applyMovement(tx, { ...base, movementType: 'PRODUCTION_ISSUE', changeQty: -4 });
    expect(await reverseDocument(tx, 'STOCK_ISSUE', 'doc1', 'u1')).toBe(1);
    expect(await reverseDocument(tx, 'STOCK_ISSUE', 'doc1', 'u1')).toBe(0);
    expect(balances[0].onHand).toBe(10);
  });

  it('กลับรายการเอกสารที่ไม่มี movement → 0', async () => {
    const { tx } = makeTx();
    expect(await reverseDocument(tx, 'STOCK_ISSUE', 'missing', 'u1')).toBe(0);
  });

  it('หลายรายการในใบเดียว: ledger บันทึกแยกบรรทัดและคืนได้ครบ', async () => {
    const { tx, balances } = makeTx([
      { itemId: 'i1', warehouseId: 'w1', onHand: 10 },
      { itemId: 'i2', warehouseId: 'w1', onHand: 20 },
    ]);
    await applyMovement(tx, { ...base, movementType: 'PRODUCTION_ISSUE', changeQty: -3 });
    await applyMovement(tx, { ...base, itemId: 'i2', movementType: 'PRODUCTION_ISSUE', changeQty: -6 });
    expect(balances.map((b) => b.onHand)).toEqual([7, 14]);
    expect(await reverseDocument(tx, 'STOCK_ISSUE', 'doc1', 'u1')).toBe(2);
    expect(balances.map((b) => b.onHand)).toEqual([10, 20]);
  });
});
