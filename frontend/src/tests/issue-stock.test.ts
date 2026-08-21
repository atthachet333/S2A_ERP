import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addIssueLine, afterIssue, buildIssuePayload, issuableItems, searchIssuable,
  stockInWarehouse, summarize, validateLine, type IssuableItem, type IssueLine, type StockItem,
} from '@/lib/issue-stock';

const WH = 'wh-1', OTHER = 'wh-2';

const items: StockItem[] = [
  { id: 'i1', code: 'ITM-151186', name: 'ไส้หมู', type: 'RAW_MATERIAL', baseUnit: { code: 'KG', name: 'กิโลกรัม' },
    stockBalances: [{ warehouseId: WH, onHand: '7.4', reserved: '0' }] },
  { id: 'i2', code: 'ITM-213998', name: 'กระเพาะหมู', type: 'RAW_MATERIAL', baseUnit: { code: 'KG', name: 'กิโลกรัม' },
    stockBalances: [{ warehouseId: WH, onHand: '65.7', reserved: '5.7' }] },
  { id: 'i3', code: 'PKG-001', name: 'ชาม', type: 'PACKAGING', baseUnit: { code: 'PCS', name: 'ชิ้น' },
    stockBalances: [{ warehouseId: OTHER, onHand: '100', reserved: '0' }] },
  { id: 'i4', code: 'ITM-ZERO', name: 'ของหมด', type: 'RAW_MATERIAL', baseUnit: { code: 'KG', name: 'กิโลกรัม' },
    stockBalances: [{ warehouseId: WH, onHand: '4', reserved: '4' }] },
  { id: 'i5', code: 'ITM-NOBAL', name: 'ไม่มีบาลานซ์', type: 'RAW_MATERIAL', baseUnit: { code: 'KG', name: 'kg' }, stockBalances: [] },
];

const keyGen = () => { let n = 0; return () => `k${++n}`; };

describe('Create Issue — warehouse-driven stock picker', () => {
  it('1 เลือกคลังแล้วโหลดสินค้าที่มีของจริงในคลังนั้น', () => {
    const list = issuableItems(items, WH);
    expect(list.map((x) => x.id).sort()).toEqual(['i1', 'i2']);
  });

  it('2 ไม่แสดงสินค้าของคลังอื่น / ไม่มี balance / available = 0', () => {
    const ids = issuableItems(items, WH).map((x) => x.id);
    expect(ids).not.toContain('i3');    // อยู่คลังอื่น
    expect(ids).not.toContain('i4');    // onHand 4 - reserved 4 = 0
    expect(ids).not.toContain('i5');    // ไม่มี balance
  });

  it('3 คลังที่ไม่มีของเลย → รายการว่าง (ใช้แสดง empty state)', () => {
    expect(issuableItems(items, 'wh-empty')).toHaveLength(0);
    expect(issuableItems(items, '')).toHaveLength(0);
  });

  it('4 available = onHand - reserved', () => {
    expect(stockInWarehouse(items[1], WH)).toEqual({ onHand: 65.7, reserved: 5.7, available: 60 });
  });

  it('5 ค้นหาได้ทั้งรหัสและชื่อ (ไม่สนตัวพิมพ์)', () => {
    const list = issuableItems(items, WH);
    expect(searchIssuable(list, 'ไส้').map((x) => x.id)).toEqual(['i1']);
    expect(searchIssuable(list, 'itm-213').map((x) => x.id)).toEqual(['i2']);
    expect(searchIssuable(list, '')).toHaveLength(2);
    expect(searchIssuable(list, 'ไม่มีจริง')).toHaveLength(0);
  });

  it('6 เพิ่มรายการลงตาราง', () => {
    const list = issuableItems(items, WH);
    const r = addIssueLine([], list[0], keyGen());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toHaveLength(1);
  });

  it('7 กันเพิ่มซ้ำ และคืน key เดิมเพื่อโฟกัสแถวนั้น', () => {
    const list = issuableItems(items, WH);
    const gen = keyGen();
    const first = addIssueLine([], list[0], gen);
    expect(first.ok).toBe(true);
    const lines = first.ok ? first.lines : [];
    const second = addIssueLine(lines, list[0], gen);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('DUPLICATE');
      expect(second.existingKey).toBe(lines[0].key);
      expect(second.lines).toHaveLength(1); // ไม่เพิ่มซ้ำ
    }
  });

  it('8 หลังเบิก = พร้อมใช้ − จำนวนเบิก (อัปเดตทันทีเมื่อ qty เปลี่ยน)', () => {
    expect(afterIssue(60, 10)).toBe(50);
    expect(afterIssue(60, 60)).toBe(0);
    expect(afterIssue(60, 75)).toBe(-15);
  });

  it('9 validation: qty ต้อง > 0 และไม่เกิน available', () => {
    expect(validateLine(0, 60)).toBe('ZERO');
    expect(validateLine(-2, 60)).toBe('ZERO');
    expect(validateLine(61, 60)).toBe('OVER_AVAILABLE');
    expect(validateLine(60, 60)).toBeNull();
    expect(validateLine(7.4, 7.4)).toBeNull(); // ขอบเขตพอดี ต้องผ่าน
  });

  it('10 summary นับรายการ/ยอดรวม/ของไม่พอ และคุมปุ่มยืนยัน', () => {
    const avail = (id: string) => ({ i1: 7.4, i2: 60 } as Record<string, number>)[id] ?? 0;
    const lines: IssueLine[] = [
      { key: 'a', itemId: 'i1', name: 'ไส้หมู', code: 'ITM-151186', unit: 'KG', requiredQty: 0, issuedQty: 2 },
      { key: 'b', itemId: 'i2', name: 'กระเพาะหมู', code: 'ITM-213998', unit: 'KG', requiredQty: 0, issuedQty: 100 },
    ];
    const s = summarize(lines, avail);
    expect(s.lineCount).toBe(2);
    expect(s.totalQty).toBe(102);
    expect(s.insufficientCount).toBe(1);
    expect(s.canSubmit).toBe(false);

    const fixed = summarize([lines[0], { ...lines[1], issuedQty: 10 }], avail);
    expect(fixed.insufficientCount).toBe(0);
    expect(fixed.canSubmit).toBe(true);
  });

  it('11 ยังไม่ใส่จำนวน → ยังยืนยันไม่ได้', () => {
    const s = summarize([{ key: 'a', itemId: 'i1', name: 'x', code: 'c', unit: 'KG', requiredQty: 0, issuedQty: 0 }], () => 10);
    expect(s.emptyQtyCount).toBe(1);
    expect(s.canSubmit).toBe(false);
  });

  it('12 ไม่มีรายการ → ยืนยันไม่ได้', () => {
    expect(summarize([], () => 10).canSubmit).toBe(false);
  });

  it('13 payload ร่าง: confirm=false และไม่ส่ง issueNo (backend ออกเลข RI)', () => {
    const lines: IssueLine[] = [{ key: 'a', itemId: 'i1', name: 'ไส้หมู', code: 'c', unit: 'KG', requiredQty: 0, issuedQty: 2 }];
    const body = buildIssuePayload({ warehouseId: WH, idempotencyKey: 'k1', confirm: false, lines });
    expect(body.confirm).toBe(false);
    expect(body).not.toHaveProperty('issueNo');
    expect(body.items[0]).toEqual({ itemId: 'i1', requiredQty: 0, issuedQty: 2, unit: 'KG', baseQty: 2 });
  });

  it('14 payload ยืนยัน: confirm=true พร้อม idempotencyKey', () => {
    const lines: IssueLine[] = [{ key: 'a', itemId: 'i1', name: 'x', code: 'c', unit: 'KG', requiredQty: 0, issuedQty: 3 }];
    const body = buildIssuePayload({ warehouseId: WH, idempotencyKey: 'k2', confirm: true, lines, note: 'ทดสอบ' });
    expect(body.confirm).toBe(true);
    expect(body.idempotencyKey).toBe('k2');
    expect(body.note).toBe('ทดสอบ');
  });

  it('15 order demand เติมรายการได้ และแก้ qty ต่อได้ก่อนยืนยัน', () => {
    const demand = [{ itemId: 'i1', name: 'ไส้หมู', unit: 'KG', quantity: '5' }];
    const seeded: IssueLine[] = demand.map((d, i) => ({ key: `d${i}`, itemId: d.itemId, name: d.name, code: '', unit: d.unit, requiredQty: Number(d.quantity), issuedQty: Number(d.quantity) }));
    expect(seeded[0].requiredQty).toBe(5);
    // แก้ qty แล้วยอดใหม่มีผลทันที
    const edited = seeded.map((l) => ({ ...l, issuedQty: 4 }));
    expect(afterIssue(7.4, edited[0].issuedQty)).toBeCloseTo(3.4, 4);
    expect(summarize(edited, () => 7.4).canSubmit).toBe(true);
  });

  it('16 เปลี่ยนคลังแล้วรายการของคลังเดิมต้องไม่ค้าง', () => {
    const inOther = issuableItems(items, OTHER).map((x) => x.id);
    expect(inOther).toEqual(['i3']);
    expect(issuableItems(items, WH).map((x) => x.id)).not.toContain('i3');
  });

  it('17 ประเภทสินค้าถูกส่งต่อเพื่อแสดงวัตถุดิบ/บรรจุภัณฑ์', () => {
    const pkg: IssuableItem[] = issuableItems(items, OTHER);
    expect(pkg[0].type).toBe('PACKAGING');
    expect(pkg[0].unit).toBe('PCS');
  });
});

beforeEach(() => { vi.unstubAllGlobals(); });
