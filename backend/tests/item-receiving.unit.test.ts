import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  lineFactor, monthKeyOf, monthRange, receiptLineMath, receiveReasonOf,
  receivingSummary, reconcileItemLastCost, reconcileItemsLastCost, thaiDateTime, weightedCostOf,
} from '../src/lib/item-receiving.js';

/**
 * PHASE 35 — คณิตศาสตร์และการนำเสนอของหลักฐานรับเข้า
 * เน้นเคสที่ผิดแล้วเงินผิด: อัตราแปลงหน่วย · ค่าเฉลี่ยถ่วงน้ำหนัก · ขอบเขตเดือนตามเวลาไทย
 */

const D = (v: string | number) => new Prisma.Decimal(v);

describe('อัตราแปลงของบรรทัดรับของ', () => {
  it('ใบที่ผูก PO ใช้ snapshot ของบรรทัด ไม่ใช่ค่าปัจจุบันของ item', () => {
    expect(lineFactor({ purchaseToBaseFactor: D(1000) }, { purchaseToBaseFactor: D(500) }).toString()).toBe('1000');
  });

  it('ใบเก่าที่ไม่มี snapshot ใช้ค่าจาก item master', () => {
    expect(lineFactor({ purchaseToBaseFactor: null }, { purchaseToBaseFactor: D(25) }).toString()).toBe('25');
  });

  it('อัตราเป็นศูนย์หรือติดลบถือว่า 1 — ไม่หารด้วยศูนย์', () => {
    expect(lineFactor({ purchaseToBaseFactor: D(0) }, { purchaseToBaseFactor: D(0) }).toString()).toBe('1');
    expect(lineFactor({ purchaseToBaseFactor: D(-5) }, { purchaseToBaseFactor: D(1) }).toString()).toBe('1');
  });
});

describe('จำนวนและต้นทุนต่อหน่วยฐาน', () => {
  it('หน่วยซื้อ = หน่วยฐาน: 1 KG @ 20 → 1 KG ต้นทุน 20 มูลค่า 20', () => {
    const m = receiptLineMath({ quantity: D(1), unitPrice: D(20), purchaseToBaseFactor: D(1) }, { purchaseToBaseFactor: D(1) });
    expect(m.baseQty.toString()).toBe('1');
    expect(m.baseUnitCost.toString()).toBe('20');
    expect(m.lineValue.toString()).toBe('20');
  });

  it('ซื้อเป็นลิตร เก็บเป็นมิลลิลิตร: 2 L @ 47 → 2000 ML ต้นทุน 0.047 มูลค่า 94', () => {
    const m = receiptLineMath({ quantity: D(2), unitPrice: D(47), purchaseToBaseFactor: D(1000) }, { purchaseToBaseFactor: D(1000) });
    expect(m.baseQty.toString()).toBe('2000');
    expect(m.baseUnitCost.toString()).toBe('0.047');
    expect(m.lineValue.toString()).toBe('94');
    // มูลค่ารวมต้องตรงกันไม่ว่าจะคิดจากหน่วยซื้อหรือหน่วยฐาน
    expect(m.baseQty.mul(m.baseUnitCost).toString()).toBe('94');
  });

  it('ทศนิยมที่ float ทำพัง: 0.1 x 0.2 = 0.02 พอดี', () => {
    const m = receiptLineMath({ quantity: D('0.1'), unitPrice: D('0.2'), purchaseToBaseFactor: D(1) }, { purchaseToBaseFactor: D(1) });
    expect(m.lineValue.toString()).toBe('0.02');
    expect(0.1 * 0.2).not.toBe(0.02);
  });
});

describe('ต้นทุนเฉลี่ยถ่วงน้ำหนักจากการรับเข้า', () => {
  const line = (qty: string, price: string) =>
    receiptLineMath({ quantity: D(qty), unitPrice: D(price), purchaseToBaseFactor: D(1) }, { purchaseToBaseFactor: D(1) });

  it('1 KG @ 20 + 1 KG @ 35 = 27.5 บาท/KG จากของ 2 KG มูลค่า 55', () => {
    const w = weightedCostOf([line('1', '20'), line('1', '35')]);
    expect(w.receivedBaseQty.toString()).toBe('2');
    expect(w.receivedValue.toString()).toBe('55');
    expect(w.weightedAverageCost?.toString()).toBe('27.5');
  });

  it('ถ่วงตามปริมาณจริง ไม่ใช่ค่าเฉลี่ยเลขคณิตของราคา', () => {
    const w = weightedCostOf([line('9', '10'), line('1', '20')]);
    // เฉลี่ยเลขคณิตคือ 15 ซึ่งผิด — ของ 9 กก. ราคาถูกต้องมีน้ำหนักมากกว่า
    expect(w.weightedAverageCost?.toString()).toBe('11');
  });

  it('ยังไม่เคยรับเข้าเลย = ไม่มีค่าเฉลี่ย ไม่ใช่ศูนย์', () => {
    expect(weightedCostOf([]).weightedAverageCost).toBeNull();
  });
});

describe('ประเภทการรับเข้า', () => {
  it('ใบเก่าที่ยังไม่มีฟิลด์นี้ ตีความเป็นการซื้อ', () => {
    expect(receiveReasonOf(null)).toBe('PURCHASE');
    expect(receiveReasonOf(undefined)).toBe('PURCHASE');
  });

  it('ค่าที่ไม่รู้จักไม่ทำให้ระบบล้ม แต่ไม่ถูกเชื่อเช่นกัน', () => {
    expect(receiveReasonOf('SOMETHING_ELSE')).toBe('PURCHASE');
  });

  it('ค่าที่ถูกต้องคงเดิม', () => {
    expect(receiveReasonOf('OPENING')).toBe('OPENING');
    expect(receiveReasonOf('ADJUST')).toBe('ADJUST');
  });
});

describe('เดือนและเวลาไทย', () => {
  it('เวลาหลังเที่ยงคืนไทยแต่ยังเป็นเดือนก่อนหน้าใน UTC ต้องนับเป็นเดือนไทย', () => {
    // 31 ส.ค. 18:00Z = 1 ก.ย. 01:00 น. เวลาไทย
    expect(monthKeyOf(new Date('2026-08-31T18:00:00.000Z'))).toBe('2026-09');
  });

  it('ช่วงของเดือนกันยายน 2026 ตามเวลาไทยเริ่ม 31 ส.ค. 17:00Z', () => {
    const range = monthRange('2026-09');
    expect(range.gte.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-09-30T17:00:00.000Z');
  });

  it('ข้ามปีได้ถูกต้อง', () => {
    const range = monthRange('2026-12');
    expect(range.lt.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('แสดงวันเวลาเป็น พ.ศ. ตามเวลาไทย', () => {
    expect(thaiDateTime(new Date('2026-09-01T02:32:00.000Z'))).toBe('1 ก.ย. 2569 09:32');
  });
});

describe('ข้อความสรุปการรับเข้า', () => {
  it('มีครบทุกอย่างที่ผู้ตรวจสอบต้องการรู้', () => {
    const summary = receivingSummary({
      receivedAt: new Date('2026-09-02T03:15:00.000Z'),
      itemName: 'หมูสด', quantity: D(1), unitCode: 'KG',
      unitPrice: D(35), totalValue: D(35),
      supplierName: 'XYZ', reason: 'PURCHASE', remark: 'Supplier ปรับราคา',
    });
    expect(summary.split('\n')).toEqual([
      '2 ก.ย. 2569 10:15',
      'รับหมูสด 1 KG',
      'ราคา 35 บาท/KG',
      'มูลค่า 35 บาท',
      'Supplier: XYZ',
      'ประเภท: รับเข้าจากการซื้อ',
      'หมายเหตุ: Supplier ปรับราคา',
    ]);
  });

  it('ไม่มีผู้ขาย/หมายเหตุ ก็ไม่ขึ้นบรรทัดว่างค้างไว้', () => {
    const summary = receivingSummary({
      receivedAt: new Date('2026-08-31T01:00:00.000Z'),
      itemName: 'ข้าวสาร', quantity: D(10), unitCode: 'KG',
      unitPrice: D(30), totalValue: D(300), reason: 'OPENING',
    });
    expect(summary).not.toContain('Supplier');
    expect(summary).not.toContain('หมายเหตุ');
    expect(summary).toContain('ประเภท: ยอดตั้งต้น');
  });
});

/* ============================================================
   PHASE 36 — คืนต้นทุนล่าสุดหลังกลับรายการ (ตรวจสัญญาของฟังก์ชัน ไม่แตะฐานข้อมูลจริง)
   ============================================================ */

/** tx จำลองเท่าที่ reconcileItemLastCost ใช้จริง — เห็นได้ชัดว่าอ่านอะไรและเขียนอะไร */
function fakeTx(item: { lastCost: string; purchaseToBaseFactor: string }, line: unknown) {
  const updates: { id: string; lastCost: string; avgCost: string }[] = [];
  const tx = {
    item: {
      findFirstOrThrow: async () => ({ id: 'item-1', lastCost: D(item.lastCost), purchaseToBaseFactor: D(item.purchaseToBaseFactor) }),
      update: async ({ where, data }: { where: { id: string }; data: { lastCost: Prisma.Decimal; avgCost: Prisma.Decimal } }) => {
        updates.push({ id: where.id, lastCost: data.lastCost.toString(), avgCost: data.avgCost.toString() });
        return {};
      },
    },
    goodsReceiptItem: { findFirst: async () => line },
  };
  return { tx: tx as never, updates };
}

const confirmedLine = (quantity: string, unitPrice: string, factor: string | null, receiptNo = 'GR-1') => ({
  quantity: D(quantity), unitPrice: D(unitPrice),
  purchaseToBaseFactor: factor === null ? null : D(factor),
  goodsReceipt: { receiptNo },
});

describe('คืนต้นทุนล่าสุดจากใบที่ยังยืนยันอยู่', () => {
  it('ใบล่าสุดที่เหลือราคา 20 → เขียน lastCost และ avgCost เป็น 20 ทั้งคู่', async () => {
    const { tx, updates } = fakeTx({ lastCost: '35', purchaseToBaseFactor: '1' }, confirmedLine('1', '20', '1', 'GR-A'));
    const result = await reconcileItemLastCost(tx, 'co-1', 'item-1', 'user-1');
    expect(result).toEqual({ itemId: 'item-1', previous: '35', next: '20', source: 'CONFIRMED_RECEIPT', receiptNo: 'GR-A' });
    // avgCost ต้องเดินตาม lastCost เสมอ ไม่แยกจากกัน (รักษาความสัมพันธ์เดิมของระบบ)
    expect(updates).toEqual([{ id: 'item-1', lastCost: '20', avgCost: '20' }]);
  });

  it('ไม่เหลือใบที่ยืนยันเลย = ไม่เขียนอะไรทั้งนั้น ไม่เขียนศูนย์', async () => {
    const { tx, updates } = fakeTx({ lastCost: '20', purchaseToBaseFactor: '1' }, null);
    const result = await reconcileItemLastCost(tx, 'co-1', 'item-1', 'user-1');
    expect(result).toEqual({ itemId: 'item-1', previous: '20', next: null, source: 'NO_EVIDENCE_KEPT', receiptNo: null });
    expect(updates).toEqual([]);
  });

  it('ค่าเท่าเดิมอยู่แล้ว = ไม่เขียนซ้ำ แต่ยังรายงานว่าตรวจแล้ว', async () => {
    const { tx, updates } = fakeTx({ lastCost: '20', purchaseToBaseFactor: '1' }, confirmedLine('1', '20', '1', 'GR-A'));
    const result = await reconcileItemLastCost(tx, 'co-1', 'item-1', 'user-1');
    expect(result.source).toBe('UNCHANGED');
    expect(updates).toEqual([]);
  });

  it('ใช้อัตราแปลงของบรรทัด: 47 บาท/L ที่ 1 L = 1000 ML → 0.047 บาท/ML', async () => {
    const { tx, updates } = fakeTx({ lastCost: '0.06', purchaseToBaseFactor: '1000' }, confirmedLine('1', '47', '1000'));
    const result = await reconcileItemLastCost(tx, 'co-1', 'item-1', 'user-1');
    expect(result.next).toBe('0.047');
    expect(updates[0].lastCost).toBe('0.047');
  });

  it('บรรทัดเก่าที่ไม่มี snapshot ของอัตรา ใช้ค่าจาก item master', async () => {
    const { tx } = fakeTx({ lastCost: '1', purchaseToBaseFactor: '25' }, confirmedLine('1', '500', null));
    expect((await reconcileItemLastCost(tx, 'co-1', 'item-1', 'user-1')).next).toBe('20');
  });

  it('ต้นทุนคิดด้วย Decimal — เศษสตางค์ไม่เพี้ยนแบบ float', async () => {
    const { tx } = fakeTx({ lastCost: '99', purchaseToBaseFactor: '3' }, confirmedLine('1', '0.3', '3'));
    // 0.3 / 3 = 0.1 พอดี ส่วน float ให้ 0.09999999999999999
    expect((await reconcileItemLastCost(tx, 'co-1', 'item-1', 'user-1')).next).toBe('0.1');
  });

  it('หลายวัตถุดิบในใบเดียว จัดการเรียงตาม itemId เสมอ (ลำดับล็อกคงที่)', async () => {
    const seen: string[] = [];
    const tx = {
      item: {
        findFirstOrThrow: async ({ where }: { where: { id: string } }) => {
          seen.push(where.id);
          return { id: where.id, lastCost: D('9'), purchaseToBaseFactor: D('1') };
        },
        update: async () => ({}),
      },
      goodsReceiptItem: { findFirst: async () => null },
    } as never;
    const results = await reconcileItemsLastCost(tx, 'co-1', ['item-c', 'item-a', 'item-b', 'item-a'], 'user-1');
    expect(seen).toEqual(['item-a', 'item-b', 'item-c']);
    expect(results).toHaveLength(3);
  });
});
