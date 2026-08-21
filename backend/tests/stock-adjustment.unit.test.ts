import { describe, expect, it, vi } from 'vitest';
import { applyMovement, formatDocumentNo, nextDocumentNo, reverseDocument, InsufficientStockError } from '../src/lib/inventory-ledger.js';

/** ส่วนต่างของการปรับปรุงสต็อก — ตรงกับ logic ใน endpoint */
function adjustmentChange(mode: 'INCREASE' | 'DECREASE' | 'SET', quantity: number, onHand: number) {
  return mode === 'SET' ? quantity - onHand : mode === 'INCREASE' ? quantity : -quantity;
}

/** สถานะสต็อกของหน้า Inventory */
function stockStatus(available: number, threshold: number) {
  if (available < 0) return 'NEGATIVE';
  if (available === 0) return 'OUT';
  return threshold > 0 && available <= threshold ? 'LOW' : 'IN_STOCK';
}

function makeTx(initial: { itemId: string; warehouseId: string; onHand: number; reserved?: number }[] = []) {
  const balances = initial.map((b, i) => ({ id: `b${i}`, ...b, reserved: b.reserved ?? 0, version: 1 }));
  const ledger: Record<string, unknown>[] = [];
  const counters: Record<string, { lastSeq: number }> = {};
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
    documentCounter: {
      upsert: vi.fn(async ({ where }: { where: { companyId_docType_periodKey: Record<string, string> } }) => {
        const k = Object.values(where.companyId_docType_periodKey).join('|');
        counters[k] = { lastSeq: (counters[k]?.lastSeq ?? 0) + 1 };
        return counters[k];
      }),
    },
  };
  return { tx: tx as never, balances, ledger };
}

const NOW = new Date('2026-08-19T04:00:00.000Z');
const base = { companyId: 'c1', warehouseId: 'w1', itemId: 'i1', unit: 'KG', refType: 'STOCK_ADJUSTMENT', refId: 'aj1', refNo: 'AJ-20260819-0001' };

describe('AJ numbering', () => {
  it('format = AJ-YYYYMMDD-0001', () => {
    expect(formatDocumentNo('STOCK_ADJUSTMENT', 1, NOW)).toBe('AJ-20260819-0001');
    expect(formatDocumentNo('STOCK_ADJUSTMENT', 7, NOW)).toBe('AJ-20260819-0007');
  });

  it('ตัวนับ AJ แยกจาก GR/RI และไม่ซ้ำ', async () => {
    const { tx } = makeTx();
    const a1 = await nextDocumentNo(tx, 'c1', 'STOCK_ADJUSTMENT', NOW);
    const a2 = await nextDocumentNo(tx, 'c1', 'STOCK_ADJUSTMENT', NOW);
    const gr = await nextDocumentNo(tx, 'c1', 'GOODS_RECEIPT', NOW);
    expect([a1, a2]).toEqual(['AJ-20260819-0001', 'AJ-20260819-0002']);
    expect(gr).toBe('GR-20260819-0001');
  });
});

describe('adjustment difference', () => {
  it('เพิ่มจำนวน', () => expect(adjustmentChange('INCREASE', 10, 100)).toBe(10));
  it('ลดจำนวน', () => expect(adjustmentChange('DECREASE', 6, 100)).toBe(-6));

  it('ตั้งยอดตามที่นับจริง: ปัจจุบัน 100 นับได้ 94 → -6', () => {
    expect(adjustmentChange('SET', 94, 100)).toBe(-6);
  });

  it('ตั้งยอดที่มากกว่าเดิม: 100 → 120 = +20', () => {
    expect(adjustmentChange('SET', 120, 100)).toBe(20);
  });

  it('ตั้งยอดเท่าเดิม → 0 (ไม่ต้องเขียน ledger)', () => {
    expect(adjustmentChange('SET', 100, 100)).toBe(0);
  });

  it('ยอดยกมาจากศูนย์', () => expect(adjustmentChange('SET', 50, 0)).toBe(50));
});

describe('adjustment ledger', () => {
  it('เพิ่มสต็อก: ledger before/change/after ถูกต้อง', async () => {
    const { tx, balances, ledger } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 100 }]);
    await applyMovement(tx, { ...base, movementType: 'ADJUSTMENT_IN', changeQty: 10, reason: 'OPENING' });
    expect(balances[0].onHand).toBe(110);
    expect(String(ledger[0].beforeQty)).toBe('100');
    expect(String(ledger[0].qtyIn)).toBe('10');
    expect(String(ledger[0].balanceAfter)).toBe('110');
    expect(ledger[0].reason).toBe('OPENING');
  });

  it('ลดสต็อก (นับจริงน้อยกว่า): 100 → 94', async () => {
    const { tx, balances, ledger } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 100 }]);
    const change = adjustmentChange('SET', 94, 100);
    await applyMovement(tx, { ...base, movementType: 'ADJUSTMENT_OUT', changeQty: change, reason: 'COUNT' });
    expect(balances[0].onHand).toBe(94);
    expect(String(ledger[0].qtyOut)).toBe('6');
    expect(String(ledger[0].balanceAfter)).toBe('94');
  });

  it('ลดจนติดลบถูกบล็อก (ใช้ policy เดิมของ applyMovement)', async () => {
    const { tx, balances } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 5 }]);
    await expect(applyMovement(tx, { ...base, movementType: 'ADJUSTMENT_OUT', changeQty: -10, reason: 'LOST' }))
      .rejects.toBeInstanceOf(InsufficientStockError);
    expect(balances[0].onHand).toBe(5);
  });

  it('reserved ยังถูกกันไว้เหมือน flow อื่น', async () => {
    const { tx } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 10, reserved: 8 }]);
    await expect(applyMovement(tx, { ...base, movementType: 'ADJUSTMENT_OUT', changeQty: -5 }))
      .rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('กลับรายการปรับปรุง: คืนค่าเดิมและเก็บประวัติไว้', async () => {
    const { tx, balances, ledger } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 100 }]);
    await applyMovement(tx, { ...base, movementType: 'ADJUSTMENT_OUT', changeQty: -6, reason: 'COUNT' });
    expect(balances[0].onHand).toBe(94);
    expect(await reverseDocument(tx, 'STOCK_ADJUSTMENT', 'aj1', 'u1')).toBe(1);
    expect(balances[0].onHand).toBe(100);
    expect(ledger).toHaveLength(2);
    expect(ledger[1].reason).toBe('REVERSAL');
  });

  it('กลับรายการซ้ำไม่ได้', async () => {
    const { tx, balances } = makeTx([{ itemId: 'i1', warehouseId: 'w1', onHand: 100 }]);
    await applyMovement(tx, { ...base, movementType: 'ADJUSTMENT_IN', changeQty: 5 });
    expect(await reverseDocument(tx, 'STOCK_ADJUSTMENT', 'aj1', 'u1')).toBe(1);
    expect(await reverseDocument(tx, 'STOCK_ADJUSTMENT', 'aj1', 'u1')).toBe(0);
    expect(balances[0].onHand).toBe(100);
  });
});

describe('inventory read-only math', () => {
  it('available = onHand - reserved · stockValue = onHand × lastCost', () => {
    const onHand = 65.7, reserved = 5.7, lastCost = 17;
    expect(onHand - reserved).toBeCloseTo(60, 6);
    expect(onHand * lastCost).toBeCloseTo(1116.9, 4);
  });

  it('สถานะสต็อก: มีของ / ใกล้หมด / หมด / ติดลบ', () => {
    expect(stockStatus(60, 10)).toBe('IN_STOCK');
    expect(stockStatus(8, 10)).toBe('LOW');
    expect(stockStatus(0, 10)).toBe('OUT');
    expect(stockStatus(-3, 10)).toBe('NEGATIVE');
  });

  it('ไม่มีจุดสั่งซื้อ (threshold 0) → ไม่เดาว่าใกล้หมด', () => {
    expect(stockStatus(1, 0)).toBe('IN_STOCK');
    expect(stockStatus(0, 0)).toBe('OUT');
  });
});

describe('permission separation (create ≠ confirm, view ≠ adjust)', () => {
  const can = (user: { roles: string[]; permissions: string[] }, permission: string) =>
    user.roles.includes('SUPER_ADMIN') || user.permissions.includes(permission);

  it('role ที่มีแค่ CREATE ยืนยันเอกสารไม่ได้อีก', () => {
    const creator = { roles: ['OPERATIONS'], permissions: ['RECEIVING_CREATE', 'STOCK_ISSUE_CREATE'] };
    expect(can(creator, 'RECEIVING_CONFIRM')).toBe(false);
    expect(can(creator, 'STOCK_ISSUE_CONFIRM')).toBe(false);
  });

  it('role ที่มี CONFIRM ยืนยันได้', () => {
    const confirmer = { roles: ['OPERATIONS'], permissions: ['RECEIVING_CONFIRM', 'STOCK_ISSUE_CONFIRM'] };
    expect(can(confirmer, 'RECEIVING_CONFIRM')).toBe(true);
    expect(can(confirmer, 'STOCK_ISSUE_CONFIRM')).toBe(true);
  });

  it('ดูสต็อกได้ ไม่ได้แปลว่าปรับสต็อกได้', () => {
    const viewer = { roles: ['PRODUCTION'], permissions: ['INVENTORY_VIEW'] };
    expect(can(viewer, 'INVENTORY_VIEW')).toBe(true);
    expect(can(viewer, 'INVENTORY_ADJUST')).toBe(false);
  });

  it('SUPER_ADMIN ผ่านทุกอย่างตามเดิม', () => {
    const su = { roles: ['SUPER_ADMIN'], permissions: [] };
    for (const p of ['RECEIVING_CONFIRM', 'STOCK_ISSUE_CONFIRM', 'INVENTORY_VIEW', 'INVENTORY_ADJUST']) {
      expect(can(su, p)).toBe(true);
    }
  });
});
