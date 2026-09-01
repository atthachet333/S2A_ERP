import { describe, expect, it } from 'vitest';
import {
  bangkokNow, bangkokToIso, buildReceivingRequest, canReceiveStock, decimalToString,
  divideDecimal, multiplyDecimal, parseDecimal, receivingAccess, receivingMath,
  thaiMonthLabel, thaiReceivedAt, type ReceivingFormValues,
} from '@/lib/stock-receiving';

/**
 * PHASE 35 — ตรรกะการนำเข้าสต็อกฝั่งหน้าจอ
 * เน้นสามเรื่องที่พังแล้วเงินผิด: เลขทศนิยม · เขตเวลา · payload ที่ส่งไป backend
 */

const NOT_LOT_TRACKED = { isLotTracked: false, isExpiryTracked: false };

const form = (patch: Partial<ReceivingFormValues> = {}): ReceivingFormValues => ({
  itemId: 'item-1', warehouseId: 'wh-1', supplierId: '',
  date: '2026-09-02', time: '10:15',
  quantity: '1', mode: 'UNIT', unitPrice: '35', totalPrice: '',
  reason: 'PURCHASE', remark: '', supplierDocNo: '',
  lotNo: '', manufactureDate: '', expiryDate: '',
  ...patch,
});

describe('เลขทศนิยมต้องไม่ผ่าน float', () => {
  it('คูณ 0.1 x 0.2 ได้ 0.02 พอดี ไม่ใช่ค่าที่มีหางทศนิยม', () => {
    const result = multiplyDecimal(parseDecimal('0.1')!, parseDecimal('0.2')!);
    expect(decimalToString(result)).toBe('0.02');
    // นี่คือสิ่งที่ float ทำ และเป็นเหตุผลที่ไม่ใช้มัน
    expect(0.1 * 0.2).not.toBe(0.02);
  });

  it('รวมราคา 1 KG x 35 = 35', () => {
    expect(decimalToString(multiplyDecimal(parseDecimal('1')!, parseDecimal('35')!))).toBe('35');
  });

  it('ราคารวม 55 หาร 2 = 27.5 และรู้ว่าลงตัว', () => {
    const r = divideDecimal(parseDecimal('55')!, parseDecimal('2')!, 4)!;
    expect(decimalToString(r.value)).toBe('27.5');
    expect(r.exact).toBe(true);
  });

  it('หารไม่ลงตัวต้องบอกว่าไม่ลงตัว ไม่ใช่ปัดเงียบ ๆ', () => {
    const r = divideDecimal(parseDecimal('100')!, parseDecimal('3')!, 4)!;
    expect(decimalToString(r.value)).toBe('33.3333');
    expect(r.exact).toBe(false);
  });

  it('ข้อความที่ไม่ใช่ตัวเลขต้องได้ null ไม่ใช่ NaN', () => {
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('1.2.3')).toBeNull();
  });
});

describe('จำนวน · ราคาต่อหน่วย · ราคารวม ต้องไม่ขัดกันเอง', () => {
  it('โหมดราคาต่อหน่วย: 1 x 35 = 35', () => {
    const m = receivingMath({ quantity: '1', mode: 'UNIT', unitPrice: '35', totalPrice: '' });
    expect(decimalToString(m.totalPrice!)).toBe('35');
    expect(m.roundedUnitPrice).toBe(false);
  });

  it('โหมดราคารวม: 2 กก. 55 บาท → 27.5 บาท/กก.', () => {
    const m = receivingMath({ quantity: '2', mode: 'TOTAL', unitPrice: '', totalPrice: '55' });
    expect(decimalToString(m.unitPrice!)).toBe('27.5');
    expect(decimalToString(m.totalPrice!)).toBe('55');
  });

  it('โหมดราคารวมที่หารไม่ลงตัว ต้องแสดงยอดรวมที่คำนวณกลับ ไม่ใช่ยอดที่พิมพ์', () => {
    const m = receivingMath({ quantity: '3', mode: 'TOTAL', unitPrice: '', totalPrice: '100' });
    expect(decimalToString(m.unitPrice!)).toBe('33.3333');
    expect(decimalToString(m.totalPrice!)).toBe('99.9999');
    expect(m.roundedUnitPrice).toBe(true);
  });

  it('จำนวนศูนย์หรือติดลบใช้ไม่ได้', () => {
    expect(receivingMath({ quantity: '0', mode: 'UNIT', unitPrice: '35', totalPrice: '' }).error).toBeTruthy();
    expect(receivingMath({ quantity: '-1', mode: 'UNIT', unitPrice: '35', totalPrice: '' }).error).toBeTruthy();
  });

  it('ยังไม่กรอกอะไรเลย ไม่ถือเป็นข้อผิดพลาด', () => {
    expect(receivingMath({ quantity: '', mode: 'UNIT', unitPrice: '', totalPrice: '' }).error).toBeNull();
  });
});

describe('เวลาไทย', () => {
  it('2 ก.ย. 2026 10:15 น. (ไทย) = 03:15Z', () => {
    expect(bangkokToIso('2026-09-02', '10:15')).toBe('2026-09-02T03:15:00.000Z');
  });

  it('เวลาก่อน 07:00 ของไทยยังอยู่ในวันเดียวกันของไทย แม้ UTC จะเป็นวันก่อนหน้า', () => {
    expect(bangkokToIso('2026-09-02', '01:00')).toBe('2026-09-01T18:00:00.000Z');
  });

  it('แสดงผลกลับเป็นวันเวลาไทยและ พ.ศ.', () => {
    expect(thaiReceivedAt('2026-09-01T02:32:00.000Z')).toBe('1 ก.ย. 2569 09:32 น.');
    expect(thaiReceivedAt('2026-09-01T18:00:00.000Z')).toBe('2 ก.ย. 2569 01:00 น.');
  });

  it('ป้ายเดือนเป็น พ.ศ.', () => {
    expect(thaiMonthLabel('2026-09')).toBe('ก.ย. 2569');
  });

  it('ค่าเริ่มต้นของฟอร์มเป็นวันเวลาไทยของตอนนั้น', () => {
    expect(bangkokNow(new Date('2026-09-01T17:30:00.000Z'))).toEqual({ date: '2026-09-02', time: '00:30' });
  });

  it('วันที่ผิดรูปแบบต้องได้ null ไม่ใช่ Invalid Date ที่หลุดไป backend', () => {
    expect(bangkokToIso('', '10:15')).toBeNull();
    expect(bangkokToIso('2026-9-2', '10:15')).toBeNull();
  });
});

describe('payload ที่ส่งไป backend', () => {
  it('ยิงไปที่ API ใบรับของเดิม และยืนยันในคำขอเดียว', () => {
    const { request } = buildReceivingRequest(form({ remark: 'Supplier ปรับราคา' }), NOT_LOT_TRACKED);
    expect(request?.path).toBe('/business/receiving');
    expect(request?.body).toMatchObject({
      warehouseId: 'wh-1',
      receiptDate: '2026-09-02T03:15:00.000Z',
      receiveReason: 'PURCHASE',
      confirm: true,
    });
    expect(request?.body.items).toEqual([
      { itemId: 'item-1', quantity: '1', unitPrice: '35', note: 'Supplier ปรับราคา' },
    ]);
  });

  it('จำนวนและราคาส่งเป็นข้อความ ไม่ถูกแปลงเป็น float ระหว่างทาง', () => {
    const { request } = buildReceivingRequest(form({ quantity: '2', mode: 'TOTAL', unitPrice: '', totalPrice: '55' }), NOT_LOT_TRACKED);
    const items = request?.body.items as { quantity: string; unitPrice: string }[];
    expect(items[0]).toEqual({ itemId: 'item-1', quantity: '2', unitPrice: '27.5' });
  });

  it('ยอดตั้งต้นเป็นประเภทของตัวเอง ไม่ปนกับการซื้อ', () => {
    const { request } = buildReceivingRequest(form({ reason: 'OPENING', remark: 'ยอดตั้งต้น ณ วันที่เริ่มใช้งานระบบ' }), NOT_LOT_TRACKED);
    expect(request?.body.receiveReason).toBe('OPENING');
  });

  it('หมายเหตุไม่บังคับ — ไม่กรอกก็ไม่ส่ง field เปล่าไป', () => {
    const { request } = buildReceivingRequest(form(), NOT_LOT_TRACKED);
    expect(request?.body.items).toEqual([{ itemId: 'item-1', quantity: '1', unitPrice: '35' }]);
  });

  it('ยังไม่เลือกคลัง = สร้างคำขอไม่ได้', () => {
    const result = buildReceivingRequest(form({ warehouseId: '' }), NOT_LOT_TRACKED);
    expect(result.request).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('วัตถุดิบที่ติดตาม Lot ต้องมีเลข Lot', () => {
    const tracked = { isLotTracked: true, isExpiryTracked: false };
    expect(buildReceivingRequest(form(), tracked).request).toBeNull();
    expect(buildReceivingRequest(form({ lotNo: 'LOT-001' }), tracked).request?.body.items).toEqual([
      { itemId: 'item-1', quantity: '1', unitPrice: '35', lotNo: 'LOT-001' },
    ]);
  });

  it('วัตถุดิบที่ติดตามวันหมดอายุต้องมีวันหมดอายุ', () => {
    const tracked = { isLotTracked: true, isExpiryTracked: true };
    expect(buildReceivingRequest(form({ lotNo: 'LOT-001' }), tracked).request).toBeNull();
    expect(buildReceivingRequest(form({ lotNo: 'LOT-001', expiryDate: '2026-09-30' }), tracked).request).not.toBeNull();
  });

  it('วัตถุดิบที่ไม่ได้ติดตาม Lot จะระบุ Lot ไม่ได้ (กติกาเดียวกับ backend)', () => {
    expect(buildReceivingRequest(form({ lotNo: 'LOT-001' }), NOT_LOT_TRACKED).request).toBeNull();
  });
});

describe('สิทธิ์', () => {
  it('สร้างวัตถุดิบได้ ไม่ได้แปลว่ารับของได้', () => {
    const access = receivingAccess([], ['INGREDIENT_CREATE', 'INGREDIENT_EDIT']);
    expect(canReceiveStock(access)).toBe(false);
    expect(access.canViewStock).toBe(false);
  });

  it('สร้างใบรับของได้อย่างเดียวยังยืนยันเองไม่ได้', () => {
    expect(canReceiveStock(receivingAccess([], ['RECEIVING_CREATE']))).toBe(false);
  });

  it('มีทั้งสร้างและยืนยันจึงจะนำเข้าสต็อกได้', () => {
    expect(canReceiveStock(receivingAccess([], ['RECEIVING_CREATE', 'RECEIVING_CONFIRM']))).toBe(true);
  });

  it('SUPER_ADMIN ผ่านทุกด่านฝั่งหน้าจอ (backend ยังตรวจซ้ำอยู่ดี)', () => {
    const access = receivingAccess(['SUPER_ADMIN'], []);
    expect(canReceiveStock(access)).toBe(true);
    expect(access.canViewReceipts).toBe(true);
    expect(access.canViewStock).toBe(true);
  });

  it('ดูสต็อกได้ ไม่ได้แปลว่ารับของได้', () => {
    const access = receivingAccess([], ['STOCK_VIEW']);
    expect(access.canViewStock).toBe(true);
    expect(canReceiveStock(access)).toBe(false);
  });
});
