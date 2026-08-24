import { describe, expect, it } from 'vitest';
import { baseCostOf, buildCostRows, isFilled, projectedRecipeCost, summarizeDraft, type CostDraft } from '@/lib/cost-completion';
import type { CostCompletionRow } from '@/lib/catalog';

/**
 * PHASE 21 — เติมข้อมูลต้นทุนที่ยังขาด
 *
 * หลักที่ตรึงไว้:
 *  - ช่องว่าง ≠ เลข 0
 *  - บันทึกเฉพาะแถวที่ผู้ใช้กรอกเองเท่านั้น
 *  - สูตรต้นทุนเป็นตัวเดียวกับทั้งระบบ ไม่มีสูตรที่สอง
 *  - ไม่มีเทสต์ไหนสมมติราคาของรายการจริงในฐานผลิต
 */

const row = (over: Partial<CostCompletionRow> = {}): CostCompletionRow => ({
  id: 'i1', code: 'RM-001', name: 'วัตถุดิบทดสอบ', type: 'RAW_MATERIAL',
  barcode: null, categoryId: null, category: null,
  baseUnitId: 'u-g', baseUnit: { id: 'u-g', code: 'G', name: 'กรัม' },
  purchaseUnitId: 'u-kg', purchaseUnit: { id: 'u-kg', code: 'KG', name: 'กิโลกรัม' },
  purchaseToBaseFactor: 1000, avgCost: 0, lastCost: 0,
  reorderPoint: 0, minQty: 0, isLotTracked: false, isExpiryTracked: false,
  imageUrl: null, isActive: true, createdAt: '', updatedAt: '',
  costStatus: 'MISSING', priceRecordCount: 0, recipesAffected: 1, menusAffected: 1, menuNames: [],
  ...over,
} as CostCompletionRow);

const draft = (over: Partial<CostDraft> = {}): CostDraft =>
  ({ price: '', quantity: '1', explicitZero: false, zeroReason: '', ...over });

describe('สูตรต้นทุนต่อหน่วยฐาน — ตัวเดียวกับทั้งระบบ', () => {
  it('350 บาท ซื้อ 1 KG สูตรใช้ G → 0.35/G', () => {
    expect(baseCostOf(350, 1, 1000)).toBeCloseTo(0.35, 10);
  });

  it('700 บาท ซื้อ 2 KG สูตรใช้ G → 0.35/G', () => {
    expect(baseCostOf(700, 2, 1000)).toBeCloseTo(0.35, 10);
  });

  it('47 บาท ซื้อ 1 L สูตรใช้ ML → 0.047/ML', () => {
    expect(baseCostOf(47, 1, 1000)).toBeCloseTo(0.047, 10);
  });

  it('ค่าที่ไม่สมเหตุผลต้องไม่ทำให้ผลระเบิด', () => {
    expect(baseCostOf(100, 0, 1000)).toBeCloseTo(0.1, 10);   // จำนวนที่ซื้อ 0 → ใช้ 1
    expect(baseCostOf(100, 1, 0)).toBeCloseTo(100, 10);      // อัตรา 0 → ใช้ 1
    expect(baseCostOf(0, 1, 1000)).toBe(0);
  });
});

describe('ช่องว่างกับเลขศูนย์ต้องไม่ใช่สิ่งเดียวกัน', () => {
  it('ช่องว่างถือว่ายังไม่ได้กรอก', () => {
    expect(isFilled(undefined)).toBe(false);
    expect(isFilled(draft({ price: '' }))).toBe(false);
    expect(isFilled(draft({ price: '   ' }))).toBe(false);
  });

  it('เลข 0 ถือว่ากรอกแล้ว แต่ยังต้องยืนยันแยกต่างหาก', () => {
    expect(isFilled(draft({ price: '0' }))).toBe(true);
    const result = summarizeDraft([row()], { i1: draft({ price: '0' }) });
    expect(result.rows).toHaveLength(0);
    expect(result.blocked).toHaveLength(1);
    expect(result.payload).toHaveLength(0);
  });

  it('ยืนยันแล้วจึงบันทึกได้ และส่งเจตนาไปด้วย', () => {
    const result = summarizeDraft([row()], { i1: draft({ price: '0', explicitZero: true, zeroReason: 'น้ำประปา' }) });
    expect(result.blocked).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.payload[0]).toEqual({ itemId: 'i1', purchasePrice: 0, purchaseQuantity: 1, explicitZero: true, zeroReason: 'น้ำประปา' });
  });

  it('ราคามากกว่า 0 ไม่ต้องส่งธงยืนยัน', () => {
    const result = summarizeDraft([row()], { i1: draft({ price: '350' }) });
    expect(result.payload[0]).toEqual({ itemId: 'i1', purchasePrice: 350, purchaseQuantity: 1 });
    expect('explicitZero' in result.payload[0]).toBe(false);
  });
});

describe('บันทึกเฉพาะแถวที่ผู้ใช้กรอกเอง', () => {
  const rows = [row({ id: 'a', code: 'A' }), row({ id: 'b', code: 'B' }), row({ id: 'c', code: 'C' })];

  it('แถวที่ไม่ได้แตะต้องไม่ถูกส่งไปบันทึก', () => {
    const result = summarizeDraft(rows, { b: draft({ price: '120' }) });
    expect(result.payload.map((p) => p.itemId)).toEqual(['b']);
  });

  it('ไม่กรอกอะไรเลย = ไม่มีอะไรถูกบันทึก', () => {
    expect(summarizeDraft(rows, {}).payload).toHaveLength(0);
  });

  it('draft ที่ชี้ไปรายการที่ไม่อยู่ในตารางต้องถูกละเว้น', () => {
    const result = summarizeDraft(rows, { zzz: draft({ price: '99' }) });
    expect(result.payload).toHaveLength(0);
  });

  it('คำนวณต้นทุนใหม่ให้เห็นก่อนบันทึก', () => {
    const result = summarizeDraft(rows, { a: draft({ price: '350', quantity: '1' }) });
    expect(result.rows[0].newBaseCost).toBeCloseTo(0.35, 10);
    expect(result.rows[0].item.code).toBe('A');
  });
});

describe('ลำดับความสำคัญตามผลกระทบจริง', () => {
  it('เรียงตามจำนวนสูตร แล้วเมนู แล้วรหัส', () => {
    const list = [
      row({ id: '1', code: 'RM-009', recipesAffected: 1, menusAffected: 1 }),
      row({ id: '2', code: 'CD-092', recipesAffected: 7, menusAffected: 7 }),
      row({ id: '3', code: 'CD-093', recipesAffected: 6, menusAffected: 6 }),
      row({ id: '4', code: 'AA-001', recipesAffected: 1, menusAffected: 1 }),
    ];
    expect(buildCostRows(list).map((r) => r.code)).toEqual(['CD-092', 'CD-093', 'AA-001', 'RM-009']);
  });
});

describe('ผลกระทบต่อสูตรหลังบันทึกราคา', () => {
  const lines = [
    { itemId: 'zero', baseQuantity: 1.8, currentUnitCost: 0 },
    { itemId: 'priced', baseQuantity: 25, currentUnitCost: 0.15 },
  ];

  it('ต้นทุนปัจจุบันคิดจากของที่รู้ราคาเท่านั้น', () => {
    expect(projectedRecipeCost(lines, {})).toBeCloseTo(3.75, 10);
  });

  it('ใส่ราคาใหม่แล้วเห็นผลทันที โดยไม่แตะรายการอื่น', () => {
    // ราคาในเทสต์นี้เป็นค่าสมมติของเทสต์เอง ไม่ใช่ข้อเสนอราคาของรายการจริง
    expect(projectedRecipeCost(lines, { zero: 10 })).toBeCloseTo(1.8 * 10 + 3.75, 10);
  });

  it('ไม่ประมาณราคาให้รายการที่ยังไม่รู้ต้นทุน — ยังคิดเป็น 0 ตามความจริง', () => {
    const projected = projectedRecipeCost(lines, {});
    const onlyPriced = 25 * 0.15;
    expect(projected).toBe(onlyPriced);
  });
});
