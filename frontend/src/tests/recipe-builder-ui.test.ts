import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstBlockerMessage, recipeSaveBlockers, type SaveBlockerInput } from '@/lib/recipe-validation';

/**
 * PHASE 4A — Recipe Builder UI / interaction
 * ครอบคลุมเฉพาะพฤติกรรมที่ "หน้าจอ" เปลี่ยน — คณิตศาสตร์ต้นทุนยังใช้ fixture เดิมใน recipe-builder-v2.test.ts
 */

const MSG = {
  pickYieldMode: 'เลือกรูปแบบผลผลิตก่อน',
  needYieldUnit: 'ต้องเลือกหน่วยผลผลิต',
  zeroYield: 'ผลผลิตต้องมากกว่า 0',
  empty: 'ยังไม่มีรายการ',
  fixSubFirst: 'แก้สูตรย่อยก่อน',
};
const input = (patch: Partial<SaveBlockerInput> = {}): SaveBlockerInput => ({
  yieldMode: 'ACTUAL', yieldUnitId: 'g', yieldQty: 1000, rowCount: 2,
  unresolvedSubRecipeNames: [], messages: MSG, ...patch,
});

describe('save guard — กฎเดิม แสดงผลแบบใหม่', () => {
  it('1 กรอกครบ = ไม่มีอะไรบล็อก', () => {
    expect(recipeSaveBlockers(input())).toEqual([]);
    expect(firstBlockerMessage(input())).toBeNull();
  });

  it('2 ยังไม่เลือกรูปแบบผลผลิต → ชี้ไปหัวข้อผลผลิต', () => {
    const b = recipeSaveBlockers(input({ yieldMode: null }));
    expect(b[0]).toMatchObject({ id: 'mode', message: MSG.pickYieldMode, target: 'yield' });
  });

  it('3 ACTUAL แต่ไม่มีหน่วยผลผลิต', () => {
    const b = recipeSaveBlockers(input({ yieldUnitId: '' }));
    expect(b[0]).toMatchObject({ id: 'unit', target: 'yield' });
  });

  it('4 BATCH ไม่ต้องมีหน่วยผลผลิต และไม่ติดเรื่องจำนวน', () => {
    expect(recipeSaveBlockers(input({ yieldMode: 'BATCH', yieldUnitId: '', yieldQty: 0 }))).toEqual([]);
  });

  it('5 ผลผลิตเป็น 0 ในโหมด ACTUAL ถูกบล็อก', () => {
    const b = recipeSaveBlockers(input({ yieldQty: 0 }));
    expect(b.some((x) => x.id === 'qty')).toBe(true);
  });

  it('6 ไม่มีรายการวัตถุดิบเลย → ชี้ไปหัวข้อวัตถุดิบ', () => {
    const b = recipeSaveBlockers(input({ rowCount: 0 }));
    expect(b.find((x) => x.id === 'rows')?.target).toBe('ingredients');
  });

  it('7 สูตรย่อยที่ยังแก้ไม่เสร็จ → ชี้ไปหัวข้อสูตรย่อย พร้อมชื่อสูตร', () => {
    const b = recipeSaveBlockers(input({ unresolvedSubRecipeNames: ['น้ำซุป', 'ซอสพริก'] }));
    const sub = b.find((x) => x.id === 'sub')!;
    expect(sub.target).toBe('sub');
    expect(sub.message).toContain('น้ำซุป');
    expect(sub.message).toContain('ซอสพริก');
  });

  it('8 ติดหลายจุดพร้อมกัน — นับได้ครบและเรียงตามลำดับเดิมของ save()', () => {
    const b = recipeSaveBlockers(input({ yieldMode: null, yieldQty: 0, rowCount: 0, unresolvedSubRecipeNames: ['ซอส'] }));
    expect(b.map((x) => x.id)).toEqual(['mode', 'qty', 'rows', 'sub']);
  });

  it('9 ข้อความที่ปุ่มบันทึกแสดง = รายการแรก (พฤติกรรมเดิมของ save)', () => {
    expect(firstBlockerMessage(input({ yieldMode: null, rowCount: 0 }))).toBe(MSG.pickYieldMode);
    expect(firstBlockerMessage(input({ rowCount: 0 }))).toBe(MSG.empty);
  });
});

/* ---------- ตรวจโครง JSX/CSS ที่เปลี่ยน (ไม่ต้อง mount ทั้งหน้า) ---------- */
const SRC = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(SRC, 'pages/catalog/RecipeBuilderPage.tsx'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'styles/recipe-builder.css'), 'utf8');

describe('page structure', () => {
  it('10 ใช้ primitive จาก Phase 2+3 ไม่สร้าง shell ใหม่', () => {
    expect(page).toContain("from '@/components/layout/page'");
    expect(page).toContain('<PageContainer size="wide"');
    expect(page).toContain('<PageHeader');
    expect(page).toContain('<StickySummary');
  });

  it('11 ทุกหัวข้อมี id สำหรับ section nav และปุ่ม "ไปแก้"', () => {
    for (const id of ['info', 'yield', 'ingredients', 'sub', 'packaging', 'overhead', 'price']) {
      expect(page).toContain(`id="${id}"`);
    }
  });

  it('12 section nav ไม่ใช่ wizard — ไม่มีปุ่ม next/previous บังคับลำดับ', () => {
    expect(page).toContain('rb-sectionnav');
    expect(page).not.toMatch(/ถัดไป|ย้อนกลับขั้นตอน|nextStep|prevStep/);
  });

  it('13 section nav เข้าถึงได้ด้วยคีย์บอร์ดและบอกตำแหน่งปัจจุบัน', () => {
    expect(page).toContain('aria-current');
    expect(page).toContain('<select value={active}');
  });

  it('14 ตัวเลือกโหมดเป็น radiogroup ไม่ใช่ปุ่มลอย ๆ', () => {
    expect(page.match(/role="radiogroup"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain('aria-checked={yieldMode===');
    expect(page).toContain('aria-checked={overhead.mode===');
  });

  it('15 หัวคอลัมน์แสดงครั้งเดียวต่อ section แทน label ซ้ำทุกแถว', () => {
    expect(page).toContain('component-cols');
    expect(css).toContain('.component-cols');
  });

  it('16 การแปลงหน่วยและราคาต่อหน่วยอยู่ในแถวเลย ไม่ต้องกดเปิด', () => {
    expect(page).toContain('row-conv');
    expect(page).toContain('conv-eq');
    expect(page).toContain('conv-price');
  });

  it('17 หน่วยเดียวกันไม่ต้องขึ้นเตือน แค่บอกว่าไม่ต้องแปลง', () => {
    expect(page).toContain('L.identityConv');
  });

  it('18 คำเตือนใช้ callout + ไอคอน ไม่ใช่ข้อความแดงยาว ๆ อย่างเดียว', () => {
    expect(page.match(/rb-callout/g)?.length).toBeGreaterThanOrEqual(4);
    expect(page).toContain('<AlertTriangle aria-hidden/>');
  });

  it('19 ปุ่มบันทึกอยู่ในแผงสรุปด้วย พร้อมสถานะกำลังบันทึก', () => {
    expect(page).toContain('summary-save-btn');
    expect(page).toContain('s.saving');
    expect(page).toContain('<Loader2 className="spin"/>');
  });

  it('20 บล็อกเกอร์แต่ละข้อมีปุ่มพาไปยังจุดที่ต้องแก้', () => {
    expect(page).toContain('scrollToSection(b.target)');
    expect(page).toContain('s.blockedCount.replace');
  });

  it('21 เพิ่มแถวแล้วโฟกัสช่องเลือกสินค้าของแถวใหม่', () => {
    expect(page).toContain('data-row-key');
    expect(page).toContain('.row-picker input');
  });
});

describe('css — responsive / dark / tokens', () => {
  it('22 ไม่มี grid-template-columns ของแถวที่ขัดกันหลายชุดแล้ว', () => {
    // เดิมกำหนดที่ 1100/1050/700/680px โดยค่าขัดกันเอง
    const breakpoints = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(breakpoints.every((b) => [1024, 760, 430].includes(b))).toBe(true);
  });

  it('23 ระยะ/ความสูงมาจาก token ไม่ hardcode px ใน layout หลัก', () => {
    expect(css).toContain('var(--space-');
    expect(css).toContain('var(--control-h)');
    expect(css).toContain('var(--radius-card)');
    expect(css).toContain('var(--z-sticky)');
  });

  it('24 ไม่มีพื้นหลังขาว hardcode (ต้องอ่านออกใน dark mode)', () => {
    expect(css).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(css).not.toMatch(/background:\s*white\b/i);
  });

  it('25 สีคำเตือนใช้ token ของระบบ ไม่ใช่ hex ลอย', () => {
    expect(css).toContain('var(--note-warn-fg)');
    expect(css).toContain('var(--note-warn-accent)');
  });

  it('26 แผงสรุปเลิก sticky บนแท็บเล็ต และมีปุ่มบันทึกติดขอบล่างบนมือถือ', () => {
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.rb2-summary \{ position: static; \}/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?position: sticky; bottom: 0/);
  });

  it('27 section เป้าหมาย scroll ไม่ถูกหัวเว็บบัง', () => {
    expect(css).toContain('scroll-margin-top');
  });

  it('28 เคารพ prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion');
    expect(page).toContain("matchMedia?.('(prefers-reduced-motion: reduce)')");
  });
});
