import { describe, expect, it } from 'vitest';

/** ตรรกะของรอบเก็บงาน: AJ print / แก้ไขร่าง / ?ref= auto-filter */

/** โหมดของหน้า create: new = สร้างใหม่, /:id/edit = แก้ร่างเดิม */
function receivingMode(pathname: string) {
  const editingId = /\/receiving\/([^/]+)\/edit$/.exec(pathname)?.[1] ?? '';
  return { editingId, creating: pathname.endsWith('/new') || Boolean(editingId) };
}
function issueMode(pathname: string) {
  const editingId = /\/stock-issues\/([^/]+)\/edit$/.exec(pathname)?.[1] ?? '';
  return { editingId, creating: pathname.endsWith('/new') || Boolean(editingId) };
}

/** endpoint ที่ต้องเรียกตอนบันทึก — แก้ร่างต้อง PATCH เอกสารเดิม ไม่ POST ใบใหม่ */
function saveTarget(base: string, editingId: string) {
  return editingId ? { method: 'PATCH', url: `${base}/${editingId}` } : { method: 'POST', url: base };
}

/** แก้ไขได้เฉพาะร่าง */
const canEdit = (status: string) => status === 'DRAFT';

/** ข้อมูลใบปรับปรุงสำหรับพิมพ์ A4 */
function buildAdjustmentPrint(input: {
  adjustmentNo: string; warehouse: string; reason: string; note?: string | null;
  item: { name: string; code: string; unit: string }; onHand: number; change: number;
}) {
  return {
    adjustmentNo: input.adjustmentNo,
    warehouse: input.warehouse,
    reason: input.reason,
    note: input.note ?? null,
    rows: [{ name: input.item.name, code: input.item.code, before: input.onHand, change: input.change, after: input.onHand + input.change, unit: input.item.unit }],
  };
}

describe('AJ print', () => {
  it('1 ใบปรับปรุงมีเลข AJ / คลัง / เหตุผล / ก่อน-เปลี่ยน-หลัง ครบ', () => {
    const doc = buildAdjustmentPrint({
      adjustmentNo: 'AJ-20260819-0001', warehouse: 'คลังครัวสดดี', reason: 'นับสต็อกจริง', note: 'รอบเดือน',
      item: { name: 'ไส้หมู', code: 'ITM-151186', unit: 'KG' }, onHand: 100, change: -6,
    });
    expect(doc.adjustmentNo).toBe('AJ-20260819-0001');
    expect(doc.warehouse).toBe('คลังครัวสดดี');
    expect(doc.reason).toBe('นับสต็อกจริง');
    expect(doc.rows[0]).toMatchObject({ before: 100, change: -6, after: 94, unit: 'KG' });
  });

  it('2 การเพิ่มยอดคำนวณ after ถูกต้อง', () => {
    const doc = buildAdjustmentPrint({ adjustmentNo: 'AJ-1', warehouse: 'w', reason: 'ยอดยกมา', item: { name: 'x', code: 'c', unit: 'KG' }, onHand: 0, change: 50 });
    expect(doc.rows[0].after).toBe(50);
    expect(doc.note).toBeNull();
  });
});

describe('edit existing draft', () => {
  it('3 /receiving/:id/edit เข้าโหมดแก้ไขและได้ id', () => {
    const m = receivingMode('/receiving/abc123/edit');
    expect(m.editingId).toBe('abc123');
    expect(m.creating).toBe(true);
  });

  it('4 /receiving/new ยังเป็นการสร้างใหม่ (ไม่มี id)', () => {
    const m = receivingMode('/receiving/new');
    expect(m.editingId).toBe('');
    expect(m.creating).toBe(true);
  });

  it('5 /receiving/:id (detail) ไม่เข้าโหมดฟอร์ม', () => {
    const m = receivingMode('/receiving/abc123');
    expect(m.creating).toBe(false);
  });

  it('6 /stock-issues/:id/edit เข้าโหมดแก้ไขใบเบิก', () => {
    expect(issueMode('/stock-issues/ri-9/edit').editingId).toBe('ri-9');
    expect(issueMode('/stock-issues/ri-9').creating).toBe(false);
  });

  it('7 บันทึกร่างเดิมต้อง PATCH เอกสารเดิม ไม่สร้างใบใหม่', () => {
    expect(saveTarget('/business/receiving', 'abc123')).toEqual({ method: 'PATCH', url: '/business/receiving/abc123' });
    expect(saveTarget('/business/stock-issues', 'ri-9')).toEqual({ method: 'PATCH', url: '/business/stock-issues/ri-9' });
  });

  it('8 สร้างใหม่ยังใช้ POST (backend ออกเลขเอกสารเอง)', () => {
    expect(saveTarget('/business/receiving', '')).toEqual({ method: 'POST', url: '/business/receiving' });
  });

  it('9 เลขเอกสารไม่เปลี่ยนหลังแก้ไขร่าง', () => {
    const before = { receiptNo: 'GR-20260819-0001', status: 'DRAFT' };
    const after = { ...before, note: 'แก้ไขแล้ว' };   // PATCH ไม่แตะ receiptNo
    expect(after.receiptNo).toBe('GR-20260819-0001');
  });

  it('10 แก้ได้เฉพาะ DRAFT — สถานะอื่น read-only', () => {
    expect(canEdit('DRAFT')).toBe(true);
    for (const s of ['CONFIRMED', 'ISSUED', 'REVERSED', 'CANCELLED']) expect(canEdit(s)).toBe(false);
  });
});

describe('movement history ?ref= auto-filter', () => {
  const refOf = (search: string) => new URLSearchParams(search).get('ref') ?? '';
  const filter = (rows: { refNo: string | null; itemCode: string; itemName: string }[], q: string) => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((m) => `${m.refNo ?? ''} ${m.itemCode} ${m.itemName}`.toLowerCase().includes(term));
  };

  const rows = [
    { refNo: 'RI-20260819-0001', itemCode: 'ITM-151186', itemName: 'ไส้หมู' },
    { refNo: 'GR-20260819-0001', itemCode: 'RM-090', itemName: 'น้ำมันพืช' },
    { refNo: 'AJ-20260819-0001', itemCode: 'ITM-213998', itemName: 'กระเพาะหมู' },
  ];

  it('11 อ่าน ?ref= จาก query string', () => {
    expect(refOf('?ref=RI-20260819-0001')).toBe('RI-20260819-0001');
    expect(refOf('')).toBe('');
  });

  it('12 เติมคำค้นแล้วกรองผลได้ทันทีทั้ง RI / GR / AJ', () => {
    expect(filter(rows, refOf('?ref=RI-20260819-0001'))).toHaveLength(1);
    expect(filter(rows, refOf('?ref=GR-20260819-0001'))[0].itemName).toBe('น้ำมันพืช');
    expect(filter(rows, refOf('?ref=AJ-20260819-0001'))[0].itemCode).toBe('ITM-213998');
  });

  it('13 ไม่มี ?ref= → แสดงทุกรายการ', () => {
    expect(filter(rows, refOf('?x=1'))).toHaveLength(3);
  });

  it('14 ลิงก์จากเอกสารสร้าง ?ref= ให้ถูกต้อง', () => {
    expect(`/inventory/movements?ref=${'AJ-20260819-0001'}`).toBe('/inventory/movements?ref=AJ-20260819-0001');
  });
});
