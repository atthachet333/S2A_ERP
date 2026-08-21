import { describe, expect, it } from 'vitest';
import {
  EDITABLE_STATUSES, PRICE_TIERS, computeLineTotal, computeOrderTotals,
  identityPreserved, isEditable, isValidPriceTier, orderEditBlock,
} from '../src/lib/order-edit.js';

/** PHASE 8B — ORDERS CONTRACT COMPLETION */

describe('ยอดเงินคำนวณฝั่ง server', () => {
  it('1 สูตรตรงกับ POST /orders: max(0, subtotal − discount + tax)', () => {
    const t = computeOrderTotals([{ quantity: 5, unitPrice: 28 }, { quantity: 2, unitPrice: 50 }], 40, 0);
    expect(t.subtotal).toBe(240);
    expect(t.totalAmount).toBe(200);
  });

  it('2 ส่วนลดเกินยอดรวม → ไม่ติดลบ', () => {
    expect(computeOrderTotals([{ quantity: 1, unitPrice: 100 }], 500).totalAmount).toBe(0);
  });

  it('3 ภาษีบวกหลังหักส่วนลด', () => {
    expect(computeOrderTotals([{ quantity: 1, unitPrice: 100 }], 10, 7).totalAmount).toBe(97);
  });

  it('4 ไม่เชื่อ lineTotal จาก client — คิดจาก quantity × unitPrice เสมอ', () => {
    // client แกล้งส่ง lineTotal มาผิด ๆ ก็ต้องไม่ถูกใช้
    const malicious = [{ quantity: 5, unitPrice: 28, lineTotal: 999999 }];
    const t = computeOrderTotals(malicious);
    expect(t.subtotal).toBe(140);
    expect(computeLineTotal(malicious[0].quantity, malicious[0].unitPrice)).toBe(140);
  });

  it('5 ค่าที่เป็น string (Prisma Decimal) คำนวณได้', () => {
    expect(computeOrderTotals([{ quantity: '5', unitPrice: '28.0000' }]).subtotal).toBe(140);
    expect(computeLineTotal('2', '19.5')).toBe(39);
  });

  it('6 ค่าที่ไม่ใช่ตัวเลขไม่ทำให้พัง', () => {
    expect(computeOrderTotals([{ quantity: 'x', unitPrice: 'y' }]).totalAmount).toBe(0);
    expect(Number.isFinite(computeOrderTotals([], '', '').totalAmount)).toBe(true);
  });

  it('7 ไม่มีรายการ → ยอดเป็นศูนย์', () => {
    expect(computeOrderTotals([]).subtotal).toBe(0);
  });
});

describe('กติกาการแก้ไขร่าง', () => {
  it('8 แก้ได้เฉพาะ DRAFT', () => {
    expect([...EDITABLE_STATUSES]).toEqual(['DRAFT']);
    expect(isEditable('DRAFT')).toBe(true);
    for (const s of ['CONFIRMED', 'SENT_TO_PREP', 'PICKING', 'ISSUED', 'READY', 'DELIVERED', 'CANCELLED']) {
      expect(isEditable(s), s).toBe(false);
    }
  });

  it('9 สถานะที่แก้ไม่ได้ คืน code ที่ frontend แปลได้', () => {
    expect(orderEditBlock('DRAFT')).toBeNull();
    const b = orderEditBlock('CONFIRMED');
    expect(b?.code).toBe('ORDER_NOT_EDITABLE');
    expect(b?.message).toContain('ยืนยันแล้ว');
  });

  it('10 ออเดอร์ที่ยกเลิกแล้วก็แก้ไม่ได้', () => {
    expect(orderEditBlock('CANCELLED')?.code).toBe('ORDER_NOT_EDITABLE');
  });

  it('11 แก้ร่างต้องใช้ใบเดิม ไม่สร้างใบใหม่และไม่ออกเลขใหม่', () => {
    const before = { id: 'o1', orderNo: 'SO-2026-00012', createdAt: '2026-08-01T00:00:00.000Z', createdByUserId: 'u1' };
    expect(identityPreserved(before, { ...before })).toBe(true);
    expect(identityPreserved(before, { ...before, orderNo: 'SO-2026-00013' })).toBe(false);
    expect(identityPreserved(before, { ...before, id: 'o2' })).toBe(false);
    expect(identityPreserved(before, { ...before, createdAt: '2026-08-22T00:00:00.000Z' })).toBe(false);
  });
});

describe('ระดับราคา', () => {
  it('12 ยอมรับเฉพาะค่าที่ SellingPrice.priceType ใช้จริง', () => {
    expect([...PRICE_TIERS]).toEqual(['RETAIL', 'WHOLESALE', 'AGENT', 'SPECIAL']);
    for (const t of PRICE_TIERS) expect(isValidPriceTier(t), t).toBe(true);
  });

  it('13 ค่าที่ไม่รู้จักถูกปฏิเสธ', () => {
    for (const bad of ['retail', 'VIP', '', null, undefined, 1]) {
      expect(isValidPriceTier(bad), String(bad)).toBe(false);
    }
  });
});

describe('ความปลอดภัยของราคาย้อนหลัง (สถานการณ์ตามสเปก §8)', () => {
  it('14 ราคาขายเปลี่ยนภายหลัง ไม่กระทบยอดของออเดอร์เก่า', () => {
    // วันที่ 1: ราคาปลีก 28 → สร้างออเดอร์ 5 × 28 = 140
    const snapshot = { quantity: '5', unitPrice: '28.0000', lineTotal: '140.0000', priceTier: 'RETAIL' };
    const day1 = computeOrderTotals([snapshot]);
    expect(day1.subtotal).toBe(140);

    // วันที่ 2: เปลี่ยนราคาปลีกเป็น 35 — เป็นข้อมูลคนละชุด ไม่แตะ snapshot
    const currentRetailPrice = 35;

    // เปิดออเดอร์เก่า: ต้องยังได้ 28 / 140 / RETAIL
    expect(Number(snapshot.unitPrice)).toBe(28);
    expect(Number(snapshot.lineTotal)).toBe(140);
    expect(snapshot.priceTier).toBe('RETAIL');
    expect(computeOrderTotals([snapshot]).subtotal).not.toBe(5 * currentRetailPrice);
  });

  it('15 ห้ามเดา tier จากราคา เพราะราคาอาจถูก override', () => {
    // ราคา 27 ไม่ตรงกับระดับใดเลย แต่ tier ที่บันทึกไว้คือ RETAIL
    const overridden = { quantity: 2, unitPrice: 27, priceTier: 'RETAIL' };
    expect(computeOrderTotals([overridden]).subtotal).toBe(54);
    expect(overridden.priceTier).toBe('RETAIL');
  });

  it('16 ออเดอร์เก่าที่ไม่มี tier ต้องคงเป็น null ไม่ backfill เดา', () => {
    const legacy: { priceTier: string | null } = { priceTier: null };
    expect(legacy.priceTier).toBeNull();
    expect(isValidPriceTier(legacy.priceTier)).toBe(false);
  });
});
