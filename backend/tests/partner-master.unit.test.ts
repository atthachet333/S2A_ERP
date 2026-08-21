import { describe, expect, it } from 'vitest';
import {
  aggregateStock, buildPatch, duplicateMessage, EMPTY_STOCK, normalizeCode, normalizeName,
  optionalText, searchWhere, statusWhere, toNum, warehouseDeactivateBlock,
} from '../src/lib/partner-master.js';

/** PHASE 7B — Supplier / Warehouse contract */

describe('ตัวกรองรายการ', () => {
  it('1 สถานะ active / inactive / all', () => {
    expect(statusWhere('active')).toEqual({ isActive: true });
    expect(statusWhere('inactive')).toEqual({ isActive: false });
    // all ต้องไม่ใส่ key เลย ไม่ใช่ใส่ undefined ซึ่งจะทำให้ Prisma มองว่ากรองอยู่
    expect(statusWhere('all')).toEqual({});
    expect(statusWhere(undefined)).toEqual({});
  });

  it('2 ค้นหาจากรหัสและชื่อเป็นอย่างน้อย', () => {
    expect(searchWhere('คลังกลาง')).toEqual({ OR: [{ code: { contains: 'คลังกลาง' } }, { name: { contains: 'คลังกลาง' } }] });
  });

  it('3 ผู้จำหน่ายค้นเบอร์/อีเมลได้ด้วย', () => {
    const w = searchWhere('081', ['phone', 'email']) as { OR: Record<string, unknown>[] };
    expect(w.OR).toHaveLength(4);
    expect(w.OR.map((o) => Object.keys(o)[0])).toEqual(['code', 'name', 'phone', 'email']);
  });

  it('4 คำค้นว่างไม่กรองอะไรเลย', () => {
    expect(searchWhere('')).toEqual({});
    expect(searchWhere('   ')).toEqual({});
    expect(searchWhere(undefined)).toEqual({});
  });
});

describe('รวมยอดสต็อกต่อคลัง', () => {
  const row = (wid: string, iid: string, onHand: number, reserved: number, lastCost: number) =>
    ({ warehouseId: wid, itemId: iid, onHand, reserved, item: { lastCost } });

  it('5 stockValue = onHand x lastCost เหมือน /business/inventory เป๊ะ', () => {
    const m = aggregateStock([row('w1', 'i1', 70, 4.3, 0.047)]);
    expect(m.get('w1')!.stockValue).toBeCloseTo(70 * 0.047, 10);
    expect(m.get('w1')!.onHand).toBe(70);
    expect(m.get('w1')!.reserved).toBe(4.3);
  });

  it('6 สินค้าเดียวกันหลาย lot/location นับเป็นสินค้าชิ้นเดียว', () => {
    const m = aggregateStock([
      row('w1', 'i1', 10, 0, 2),
      row('w1', 'i1', 15, 0, 2),
      row('w1', 'i2', 5, 0, 3),
    ]);
    expect(m.get('w1')!.itemCount).toBe(2);
    expect(m.get('w1')!.onHand).toBe(30);
    expect(m.get('w1')!.stockValue).toBe(10 * 2 + 15 * 2 + 5 * 3);
  });

  it('7 แยกยอดตามคลัง ไม่ปนกัน', () => {
    const m = aggregateStock([row('w1', 'i1', 10, 0, 1), row('w2', 'i1', 20, 0, 1)]);
    expect(m.get('w1')!.onHand).toBe(10);
    expect(m.get('w2')!.onHand).toBe(20);
  });

  it('8 คลังที่ไม่มีแถวเลย = ไม่มีใน map (ฝั่ง route เติม 0 ให้)', () => {
    expect(aggregateStock([]).get('w1')).toBeUndefined();
  });

  it('9 ค่า Decimal ที่มาเป็น object/string ต้องอ่านได้', () => {
    const m = aggregateStock([{ warehouseId: 'w1', itemId: 'i1', onHand: '12.5', reserved: null, item: { lastCost: '2' } }]);
    expect(m.get('w1')!.onHand).toBe(12.5);
    expect(m.get('w1')!.reserved).toBe(0);
    expect(m.get('w1')!.stockValue).toBe(25);
  });

  it('10 lastCost หาย ไม่ทำให้มูลค่าเป็น NaN', () => {
    const m = aggregateStock([{ warehouseId: 'w1', itemId: 'i1', onHand: 10, reserved: 0, item: null }]);
    expect(m.get('w1')!.stockValue).toBe(0);
    expect(toNum(undefined)).toBe(0);
  });
});

describe('ความปลอดภัยตอนปิดใช้งานคลัง', () => {
  it('11 คลังว่างเปล่า ปิดได้', () => {
    expect(warehouseDeactivateBlock(EMPTY_STOCK)).toBeNull();
    expect(warehouseDeactivateBlock(undefined)).toBeNull();
  });

  it('12 ยังมีของคงเหลือ → บล็อก พร้อมยอดจริงเพื่อให้ UI แสดงได้', () => {
    const b = warehouseDeactivateBlock({ itemCount: 3, onHand: 65.7, reserved: 0, stockValue: 900 });
    expect(b).not.toBeNull();
    expect(b!.code).toBe('WAREHOUSE_HAS_STOCK');
    expect(b!.onHand).toBe(65.7);
    expect(b!.itemCount).toBe(3);
  });

  it('13 onHand เป็นศูนย์แต่ยังมีของจองอยู่ → ยังบล็อก', () => {
    expect(warehouseDeactivateBlock({ itemCount: 1, onHand: 0, reserved: 2, stockValue: 0 })!.reserved).toBe(2);
  });

  it('14 ยอดติดลบถือว่ายังไม่เคลียร์ → บล็อกเช่นกัน', () => {
    expect(warehouseDeactivateBlock({ itemCount: 1, onHand: -5, reserved: 0, stockValue: 0 })).not.toBeNull();
  });

  it('15 เศษทศนิยมจิ๋วมากถือว่าว่าง', () => {
    expect(warehouseDeactivateBlock({ itemCount: 0, onHand: 0.00001, reserved: 0, stockValue: 0 })).toBeNull();
  });

  it('16 ตัวบล็อกไม่แตะจำนวนสต็อกใด ๆ — เป็นแค่ผลตรวจอ่านอย่างเดียว', () => {
    const stock = { itemCount: 2, onHand: 10, reserved: 1, stockValue: 20 };
    const snapshot = JSON.stringify(stock);
    warehouseDeactivateBlock(stock);
    expect(JSON.stringify(stock)).toBe(snapshot);
  });
});

describe('normalize และ patch', () => {
  it('17 รหัสเป็นตัวใหญ่เสมอ ชื่อตัดช่องว่าง', () => {
    expect(normalizeCode(' wh-01 ')).toBe('WH-01');
    expect(normalizeCode('')).toBeUndefined();
    expect(normalizeCode(undefined)).toBeUndefined();
    expect(normalizeName('  คลังกลาง  ')).toBe('คลังกลาง');
    expect(normalizeName('   ')).toBeUndefined();
  });

  it('18 ไม่ส่ง field มา = ไม่แตะ · ส่งค่าว่าง = ตั้งใจล้างเป็น null', () => {
    expect(optionalText(undefined)).toBeUndefined();
    expect(optionalText('')).toBeNull();
    expect(optionalText('  ')).toBeNull();
    expect(optionalText(' 081-1 ')).toBe('081-1');
  });

  it('19 patch ตัด key ที่ไม่ได้ส่งออกทั้งหมด', () => {
    expect(buildPatch({ name: 'a', code: undefined, isActive: false })).toEqual({ name: 'a', isActive: false });
    expect(buildPatch({ a: undefined })).toEqual({});
  });

  it('20 patch เก็บ null ไว้ (ล้างค่า) ไม่ตัดทิ้ง', () => {
    expect(buildPatch({ phone: null })).toEqual({ phone: null });
  });

  it('21 patch ไม่มีทางใส่ field ที่แตะสต็อกได้ — ส่งอะไรมาก็ผ่านเฉพาะที่ route อนุญาต', () => {
    // route ประกอบ object เองจาก zod schema ที่ไม่มี onHand/reserved
    const data = buildPatch({ name: 'x', code: 'Y', type: null, isActive: true });
    expect(Object.keys(data).sort()).toEqual(['code', 'isActive', 'name', 'type']);
    expect(Object.keys(data)).not.toContain('onHand');
    expect(Object.keys(data)).not.toContain('reserved');
  });
});

describe('ข้อความซ้ำ', () => {
  it('22 บอกว่าซ้ำที่รหัสหรือชื่อ และซ้ำกับค่าไหน', () => {
    expect(duplicateMessage('supplier', 'code', 'SUP-001')).toBe('มีผู้จำหน่ายรหัส SUP-001 อยู่แล้ว');
    expect(duplicateMessage('supplier', 'name', 'บจก. ก')).toBe('มีผู้จำหน่ายชื่อ บจก. ก อยู่แล้ว');
    expect(duplicateMessage('warehouse', 'code', 'WH-01')).toBe('มีคลังรหัส WH-01 อยู่แล้ว');
  });
});
