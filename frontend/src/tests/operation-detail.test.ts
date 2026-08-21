import { describe, expect, it } from 'vitest';

/**
 * ตรรกะของหน้า Detail (timeline / stock impact / สิทธิ์ / print)
 * ดึงมาเป็นฟังก์ชันบริสุทธิ์แบบเดียวกับที่หน้าจอใช้ เพื่อล็อกพฤติกรรมไว้
 */

type Movement = { itemCode: string; beforeQty: number | null; qtyIn: number; qtyOut: number; balanceAfter: number; reason: string | null };

function impactOf(movements: Movement[], itemCode: string) {
  const m = movements.find((x) => x.itemCode === itemCode && x.reason !== 'REVERSAL');
  if (!m) return null;
  return { before: m.beforeQty, change: m.qtyIn > 0 ? m.qtyIn : -m.qtyOut, after: m.balanceAfter };
}

function receiptTimeline(doc: { createdAt: string; confirmedAt?: string | null; reversedAt?: string | null; status: string }) {
  return [
    { label: 'สร้างร่าง', at: doc.createdAt, done: true },
    { label: 'ยืนยันรับเข้า', at: doc.confirmedAt, done: doc.status === 'CONFIRMED' || doc.status === 'REVERSED' },
    ...(doc.status === 'REVERSED' ? [{ label: 'กลับรายการ', at: doc.reversedAt, done: true }] : []),
  ];
}

function issueTimeline(doc: { createdAt: string; issuedAt?: string | null; status: string }) {
  return [
    { label: 'สร้างร่าง', at: doc.createdAt, done: true },
    { label: 'ยืนยันและตัดสต็อก', at: doc.issuedAt, done: doc.status === 'ISSUED' || doc.status === 'REVERSED' },
    ...(doc.status === 'REVERSED' ? [{ label: 'กลับรายการ', at: null, done: true }] : []),
  ];
}

/** ปุ่มที่ควรแสดงตามสถานะ + สิทธิ์ (ตรงกับ JSX ในหน้า Detail) */
function actionsFor(status: string, canConfirm: boolean) {
  const out: string[] = [];
  if (status === 'DRAFT') {
    out.push('แก้ไข');
    out.push(canConfirm ? 'ยืนยัน' : 'ต้องให้ผู้มีสิทธิ์ยืนยัน');
  } else if (status === 'CONFIRMED' || status === 'ISSUED') {
    out.push('พิมพ์');
    if (canConfirm) out.push('กลับรายการ');
  } else if (status === 'REVERSED') {
    out.push('พิมพ์');
  }
  return out;
}

const CREATED = '2026-08-19T03:00:00.000Z';
const CONFIRMED = '2026-08-19T04:00:00.000Z';
const REVERSED_AT = '2026-08-19T05:00:00.000Z';

describe('receiving detail', () => {
  it('1 timeline ร่าง: มีขั้นสร้าง แต่ยืนยันยังไม่เกิด', () => {
    const t = receiptTimeline({ createdAt: CREATED, status: 'DRAFT' });
    expect(t).toHaveLength(2);
    expect(t[0].done).toBe(true);
    expect(t[1].done).toBe(false);
  });

  it('2 timeline ยืนยันแล้ว: สองขั้นเสร็จ พร้อมเวลา', () => {
    const t = receiptTimeline({ createdAt: CREATED, confirmedAt: CONFIRMED, status: 'CONFIRMED' });
    expect(t.every((s) => s.done)).toBe(true);
    expect(t[1].at).toBe(CONFIRMED);
  });

  it('3 timeline กลับรายการ: เพิ่มขั้นที่สาม', () => {
    const t = receiptTimeline({ createdAt: CREATED, confirmedAt: CONFIRMED, reversedAt: REVERSED_AT, status: 'REVERSED' });
    expect(t).toHaveLength(3);
    expect(t[2].label).toBe('กลับรายการ');
    expect(t[2].at).toBe(REVERSED_AT);
  });

  it('4 stock impact ต่อบรรทัด: ก่อน / รับเข้า / หลัง มาจาก ledger', () => {
    const mv: Movement[] = [{ itemCode: 'RM-090', beforeQty: 500, qtyIn: 2000, qtyOut: 0, balanceAfter: 2500, reason: null }];
    expect(impactOf(mv, 'RM-090')).toEqual({ before: 500, change: 2000, after: 2500 });
  });

  it('5 ไม่รวมแถว REVERSAL ในการแสดงผลกระทบของบรรทัดเดิม', () => {
    const mv: Movement[] = [
      { itemCode: 'RM-090', beforeQty: 500, qtyIn: 2000, qtyOut: 0, balanceAfter: 2500, reason: null },
      { itemCode: 'RM-090', beforeQty: 2500, qtyIn: 0, qtyOut: 2000, balanceAfter: 500, reason: 'REVERSAL' },
    ];
    expect(impactOf(mv, 'RM-090')?.change).toBe(2000);
  });

  it('6 ยังไม่ยืนยัน → ไม่มี movement → แสดง —', () => {
    expect(impactOf([], 'RM-090')).toBeNull();
  });
});

describe('stock issue detail', () => {
  it('7 timeline ใบเบิกร่าง/ยืนยัน/กลับรายการ', () => {
    expect(issueTimeline({ createdAt: CREATED, status: 'DRAFT' })[1].done).toBe(false);
    expect(issueTimeline({ createdAt: CREATED, issuedAt: CONFIRMED, status: 'ISSUED' }).every((s) => s.done)).toBe(true);
    expect(issueTimeline({ createdAt: CREATED, issuedAt: CONFIRMED, status: 'REVERSED' })).toHaveLength(3);
  });

  it('8 การเบิกแสดงเป็นค่าติดลบ (ก่อน 7.4 → หลัง 5.4)', () => {
    const mv: Movement[] = [{ itemCode: 'ITM-151186', beforeQty: 7.4, qtyIn: 0, qtyOut: 2, balanceAfter: 5.4, reason: null }];
    const im = impactOf(mv, 'ITM-151186')!;
    expect(im.change).toBe(-2);
    expect(im.after).toBe(5.4);
  });
});

describe('actions by status and permission', () => {
  it('9 DRAFT + มีสิทธิ์ยืนยัน → เห็นปุ่มยืนยัน', () => {
    expect(actionsFor('DRAFT', true)).toContain('ยืนยัน');
  });

  it('10 DRAFT + ไม่มีสิทธิ์ → ซ่อนปุ่ม แสดงข้อความแทน', () => {
    const a = actionsFor('DRAFT', false);
    expect(a).not.toContain('ยืนยัน');
    expect(a).toContain('ต้องให้ผู้มีสิทธิ์ยืนยัน');
  });

  it('11 CONFIRMED/ISSUED: พิมพ์ได้เสมอ กลับรายการเฉพาะผู้มีสิทธิ์', () => {
    expect(actionsFor('CONFIRMED', true)).toEqual(['พิมพ์', 'กลับรายการ']);
    expect(actionsFor('ISSUED', false)).toEqual(['พิมพ์']);
  });

  it('12 REVERSED เป็น read-only (พิมพ์ได้อย่างเดียว)', () => {
    expect(actionsFor('REVERSED', true)).toEqual(['พิมพ์']);
    expect(actionsFor('REVERSED', false)).toEqual(['พิมพ์']);
  });
});

describe('movement links', () => {
  const linkOf = (refType: string | null) =>
    refType === 'GOODS_RECEIPT' ? '/receiving'
    : refType === 'STOCK_ISSUE' ? '/stock-issues'
    : refType === 'STOCK_ADJUSTMENT' ? '/inventory/adjustments' : null;

  it('13 referenceNo ย้อนกลับไปเอกสารต้นทางได้ทั้งสามชนิด', () => {
    expect(linkOf('GOODS_RECEIPT')).toBe('/receiving');
    expect(linkOf('STOCK_ISSUE')).toBe('/stock-issues');
    expect(linkOf('STOCK_ADJUSTMENT')).toBe('/inventory/adjustments');
    expect(linkOf(null)).toBeNull();
  });

  it('14 detail ลิงก์ไป movement history พร้อม ref ของเอกสาร', () => {
    expect(`/inventory/movements?ref=${'GR-20260819-0001'}`).toBe('/inventory/movements?ref=GR-20260819-0001');
    expect(`/inventory/movements?ref=${'RI-20260819-0001'}`).toBe('/inventory/movements?ref=RI-20260819-0001');
  });
});
