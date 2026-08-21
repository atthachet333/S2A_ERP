import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { adjustmentChange, adjustmentPreview } from '@/lib/adjustment-preview';
import { historySummary, toPrintPayload, type AdjustmentHistoryRow } from '@/lib/adjustment-history';

/** PHASE 6C — ปรับปรุงสต็อก + พิมพ์ใบย้อนหลัง */

describe('adjustment math — สูตรเดิม', () => {
  it('1 เพิ่มจำนวน', () => {
    const p = adjustmentPreview('INCREASE', 6, 100, 'KG');
    expect(p.change).toBe(6);
    expect(p.after).toBe(106);
    expect(p.equation).toBe('100 KG + 6 KG = 106 KG');
  });

  it('2 ลดจำนวน', () => {
    const p = adjustmentPreview('DECREASE', 6, 100, 'KG');
    expect(p.change).toBe(-6);
    expect(p.after).toBe(94);
    expect(p.equation).toBe('100 KG − 6 KG = 94 KG');
  });

  it('3 ตั้งยอดตามที่นับจริง: ระบบ 100 นับได้ 94 → ปรับ −6', () => {
    const p = adjustmentPreview('SET', 94, 100, 'KG');
    expect(p.entered).toBe(94);
    expect(p.change).toBe(-6);
    expect(p.after).toBe(94);
  });

  it('4 ตั้งยอดที่มากกว่าเดิม', () => {
    expect(adjustmentPreview('SET', 120, 100).change).toBe(20);
  });

  it('5 นับได้ตรงกับระบบ → ไม่มีการเปลี่ยนแปลง', () => {
    const p = adjustmentPreview('SET', 100, 100);
    expect(p.change).toBe(0);
    expect(p.noChange).toBe(true);
  });

  it('6 ลดจนติดลบ → เตือนล่วงหน้า (backend ยังเป็นผู้บล็อกจริง)', () => {
    const p = adjustmentPreview('DECREASE', 10, 5, 'KG');
    expect(p.after).toBe(-5);
    expect(p.wouldGoNegative).toBe(true);
  });

  it('7 ไม่ติดลบ → ไม่เตือน', () => {
    expect(adjustmentPreview('DECREASE', 5, 10).wouldGoNegative).toBe(false);
  });

  it('8 adjustmentChange ตรงกับสูตรที่ backend ใช้ทุกโหมด', () => {
    expect(adjustmentChange('INCREASE', 10, 100)).toBe(10);
    expect(adjustmentChange('DECREASE', 6, 100)).toBe(-6);
    expect(adjustmentChange('SET', 94, 100)).toBe(-6);
    expect(adjustmentChange('SET', 50, 0)).toBe(50);
  });

  it('9 ค่าที่ไม่ใช่ตัวเลขไม่ทำให้พัง', () => {
    const p = adjustmentPreview('SET', Number.NaN, 100);
    expect(Number.isFinite(p.after)).toBe(true);
  });
});

/* ---------- พิมพ์ใบย้อนหลัง: จุดที่ spec เน้นว่าต้องไม่พิมพ์ผิดใบ ---------- */
const row = (no: string, itemName: string, before: number, change: number, after: number): AdjustmentHistoryRow => ({
  id: `id-${no}`, adjustmentNo: no, adjustmentDate: '2026-08-20T03:00:00.000Z', status: 'CONFIRMED',
  reason: 'COUNT', note: `บันทึกของ ${no}`, warehouse: { name: 'คลังกลาง' },
  items: [{ id: `i-${no}`, systemQty: String(before), diffQty: String(change), countedQty: String(after), item: { code: 'ITM-1', name: itemName } }],
});

describe('historical AJ print', () => {
  const aj1 = row('AJ-20260820-0001', 'ไส้หมู', 100, -6, 94);
  const aj2 = row('AJ-20260820-0002', 'น้ำมันพืช', 50, 20, 70);

  it('10 พิมพ์ AJ-0001 ต้องได้ข้อมูลของ AJ-0001 เท่านั้น', () => {
    const payload = toPrintPayload(aj1);
    expect(payload.adjustmentNo).toBe('AJ-20260820-0001');
    expect(payload.rows[0]).toMatchObject({ name: 'ไส้หมู', before: 100, change: -6, after: 94 });
  });

  it('11 payload ของ AJ-0001 ต้องไม่มีข้อมูลของ AJ-0002 ปนเลย', () => {
    const payload = toPrintPayload(aj1);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('AJ-20260820-0002');
    expect(serialized).not.toContain('น้ำมันพืช');
    expect(serialized).not.toContain('70');
  });

  it('12 พิมพ์ AJ-0002 ได้ของตัวเอง ไม่ใช่ใบล่าสุดหรือใบแรก', () => {
    const payload = toPrintPayload(aj2);
    expect(payload.adjustmentNo).toBe('AJ-20260820-0002');
    expect(payload.rows[0]).toMatchObject({ name: 'น้ำมันพืช', before: 50, change: 20, after: 70 });
    expect(JSON.stringify(payload)).not.toContain('ไส้หมู');
  });

  it('13 หมายเหตุมาจากเอกสารใบนั้น', () => {
    expect(toPrintPayload(aj1).note).toBe('บันทึกของ AJ-20260820-0001');
    expect(toPrintPayload(aj2).note).toBe('บันทึกของ AJ-20260820-0002');
  });

  it('14 หน่วยมาจากรายการสต็อกที่โหลดไว้ ถ้าไม่มีให้เว้นว่าง ไม่เดา', () => {
    expect(toPrintPayload(aj1, [{ code: 'ITM-1', unit: 'KG' }]).rows[0].unit).toBe('KG');
    expect(toPrintPayload(aj1).rows[0].unit).toBe('');
    expect(toPrintPayload(aj1, [{ code: 'OTHER', unit: 'L' }]).rows[0].unit).toBe('');
  });

  it('15 เอกสารเก่าที่ countedQty เป็น 0 คำนวณหลังจาก ก่อน+เปลี่ยน', () => {
    const legacy = row('AJ-OLD', 'x', 100, -6, 0);
    expect(toPrintPayload(legacy).rows[0].after).toBe(94);
  });

  it('16 สรุปแถวประวัติอ่านค่าก่อน/เปลี่ยน/หลังได้ครบ', () => {
    expect(historySummary(aj1)).toMatchObject({ itemName: 'ไส้หมู', before: 100, change: -6, after: 94, lineCount: 1 });
  });

  it('17 เอกสารไม่มีรายการ ไม่ทำให้พัง', () => {
    const empty: AdjustmentHistoryRow = { ...aj1, items: [] };
    expect(historySummary(empty).itemName).toBe('—');
    expect(toPrintPayload(empty).rows).toEqual([]);
  });
});

/* ---------- โครงหน้า ---------- */
const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const inv = read('pages/InventoryPages.tsx');
const css = read('styles/adjustment.css');

describe('adjustment page structure', () => {
  it('18 ใช้ workspace 72/28 + primitives', () => {
    expect(inv).toContain('adjustment-workspace');
    expect(inv).toContain('<StickySummary className="ops-summary-panel">');
    expect(inv).toContain('<PageHeader');
    expect(inv).toContain('<ContentCard');
  });

  it('19 segmented control เป็น radiogroup เข้าถึงด้วยคีย์บอร์ดได้', () => {
    expect(inv).toContain('role="radiogroup" aria-label="วิธีปรับปรุง"');
    expect(inv).toContain('aria-checked={mode === m}');
    expect(inv).toContain('role="radiogroup" aria-label="เหตุผล"');
  });

  it('20 มี preview ก่อน/เปลี่ยน/หลัง พร้อมสมการ', () => {
    expect(inv).toContain('adj-steps');
    expect(inv).toContain('adj-equation');
    expect(inv).toContain('preview.equation');
    for (const label of ['ก่อนปรับ', 'เปลี่ยน', 'หลังปรับ']) expect(inv).toContain(label);
  });

  it('21 โหมดตั้งยอดจริงอธิบาย ระบบ/นับจริง/ปรับ', () => {
    expect(inv).toContain('adj-set-note');
    expect(inv).toContain('ยอดในระบบ');
    expect(inv).toContain('นับจริง');
    expect(inv).toContain('ระบบจะปรับ');
  });

  it('22 เตือนติดลบโดยไม่ทำทั้งฟอร์มแดง', () => {
    expect(inv).toContain('preview.wouldGoNegative');
    expect(inv).toContain('ยอดหลังปรับจะติดลบ');
  });

  it('23 ยืนยันผ่าน ConfirmDialog ที่บอกก่อน/เปลี่ยน/หลัง/เหตุผล', () => {
    expect(inv).toContain('<ConfirmDialog');
    expect(inv).toContain('สร้างรายการเดินสต็อก');
    expect(inv).toContain('ถาวร');
  });

  it('24 ปุ่มพิมพ์ในประวัติเรียก printHistoryRow ของแถวนั้น ไม่ใช่ printDoc', () => {
    expect(inv).toContain('onClick={() => printHistoryRow(h)}');
    expect(inv).toContain('selectedPrintAdjustment');
    // ต้องล้าง printDoc ก่อน เพื่อไม่ให้ใบที่เพิ่งบันทึกถูกพิมพ์ปน
    expect(inv).toContain('setPrintDoc(null)');
  });

  it('25 ปุ่มพิมพ์มี aria-label ระบุเลขเอกสาร', () => {
    expect(inv).toContain('aria-label={`พิมพ์ใบปรับปรุง ${h.adjustmentNo}`}');
  });

  it('26 ตารางประวัติมีคอลัมน์ครบและ data-label สำหรับมือถือ', () => {
    for (const c of ['ก่อน', 'เปลี่ยน', 'หลัง', 'เหตุผล', 'สถานะ']) expect(inv).toContain(`data-label="${c}"`);
  });
});

describe('adjustment css', () => {
  it('27 ใช้ token ไม่ hardcode สีธีม', () => {
    expect(css).toContain('var(--space-');
    expect(css).toContain('var(--control-h)');
    expect(css).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(css).not.toMatch(/color:\s*#[0-9a-f]{6}/i);
  });

  it('28 breakpoint ตรงมาตรฐานระบบ', () => {
    const bps = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(bps.every((b) => [1024, 760, 430].includes(b))).toBe(true);
  });

  it('29 ตอนพิมพ์ซ่อนฟอร์ม เหลือเฉพาะเอกสาร', () => {
    expect(css).toMatch(/@media print[\s\S]*?\.adjustment-workspace \.ops-workspace/);
  });
});
