import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { quantity } from '@/lib/presentation';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

/* ============================================================
   PHASE 39 — เลขทศนิยมลอยตัวต้องไม่รั่วออกหน้าจอ
   ต้นเหตุจริง: หน้าเทียบเวอร์ชันสูตรเอาค่า number ไปวางใน JSX ตรง ๆ
   ทำให้เห็น 0.35000000000000003 แทน 0.35
   ============================================================ */
describe('PHASE 39 — quantity() ล้าง floating-point noise', () => {
  it('ตัด noise ของทศนิยมลอยตัวทิ้ง', () => {
    expect(quantity(0.35000000000000003)).toBe('0.35');
    expect(quantity(0.1 + 0.2)).toBe('0.3');
    expect(quantity(1.0000000000000002)).toBe('1');
  });

  it('ตัดศูนย์ท้ายออก ไม่บังคับให้เหลือ 2 ตำแหน่งเสมอ', () => {
    expect(quantity(1)).toBe('1');
    expect(quantity(1.5)).toBe('1.5');
    expect(quantity(2.25)).toBe('2.25');
  });

  it('เก็บความละเอียดที่มีความหมายไว้', () => {
    expect(quantity(1234.5678)).toBe('1,234.5678');
    expect(quantity(2.675)).toBe('2.675');
  });

  it('ค่าที่เล็กมากต้องไม่กลายเป็นศูนย์', () => {
    // ถ้าปัดที่ 4 ตำแหน่งตรง ๆ ค่านี้จะกลายเป็น 0 ซึ่งทำให้เข้าใจผิดว่าไม่มีของ
    expect(quantity(0.00001)).toBe('0.00001');
    expect(quantity(0.000004)).not.toBe('0');
  });

  it('ค่าว่าง/ศูนย์/ค่าไม่ใช่ตัวเลข จัดการอย่างชัดเจน', () => {
    expect(quantity(0)).toBe('0');
    expect(quantity(null)).toBe('—');
    expect(quantity(undefined)).toBe('—');
    expect(quantity(Number.NaN)).toBe('—');
  });

  it('หน้าเทียบเวอร์ชันสูตรใช้ตัวจัดรูปแบบกลาง ไม่วางค่าดิบลง JSX', () => {
    const page = read('pages/CostVariancePage.tsx');
    expect(page).toContain("import { quantity } from '@/lib/presentation'");
    expect(page).toContain('{quantity(x.previousQty)} / {quantity(x.currentQty)}');
    // กันการถอยกลับไปวางค่าดิบ
    expect(page).not.toContain("{x.previousQty??'—'} / {x.currentQty??'—'}");
  });
});

/* ============================================================
   PHASE 39 — โครงหน้าที่แก้ไข
   ============================================================ */
describe('PHASE 39 — วิเคราะห์การเปลี่ยนแปลงต้นทุน', () => {
  const page = read('pages/CostVariancePage.tsx');
  const css = read('styles/phase34-reskin.css');

  it('หัวข้อเป็นไทยนำ อังกฤษเป็นตัวรอง', () => {
    expect(page).toContain('วิเคราะห์การเปลี่ยนแปลงต้นทุน');
    expect(page).toContain('cv-title-en');
  });

  it('Coverage ไม่ยืนเดี่ยวเป็นภาษาอังกฤษ', () => {
    expect(page).toContain('ความครอบคลุมข้อมูล');
  });

  it('ตัวควบคุมรวมเป็นแถบเดียวและมีลูกศรบอกทิศการเทียบ', () => {
    expect(page).toContain('cv-toolbar');
    expect(page).toContain('cv-arrow');
    expect(css).toContain('.cv-toolbar');
  });

  it('การ์ดสรุปย่อจาก 4 เป็น 2 คอลัมน์เมื่อพื้นที่แคบ', () => {
    expect(css).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.cv-metrics \{ grid-template-columns: repeat\(2/);
  });
});

describe('PHASE 39 — โมดัลเพิ่มลูกค้า', () => {
  const modal = read('components/customers/CustomerQuickCreateModal.tsx');
  const css = read('styles/phase34-reskin.css');

  it('แบ่งเป็นสามกลุ่มตามสเปก', () => {
    expect(modal).toContain('sectionMain');
    expect(modal).toContain('sectionAddress');
    expect(modal).toContain('sectionExtra');
  });

  it('ยังมีครบทุกช่อง ไม่มีการตัดฟิลด์ออก', () => {
    for (const key of ['name', 'contactName', 'phone', 'email', 'taxId', 'address', 'billingAddress', 'lineId', 'branch', 'note']) {
      expect(modal, key).toContain(`field('${key}'`);
    }
  });

  it('ที่อยู่สองช่องไม่กินเต็มบรรทัดแล้ว', () => {
    expect(modal).toContain("field('address', cf.shipping, cf.phShipping, MapPin, { textarea: true })");
    expect(modal).not.toContain("field('address', cf.shipping, cf.phShipping, MapPin, { full: true, textarea: true })");
  });

  it('เนื้อหาเลื่อนแยกจากหัวและแถบปุ่ม', () => {
    expect(modal).toContain('cust-modal-body');
    expect(css).toMatch(/\.cust-modal \.cust-modal-body \{[\s\S]*?overflow-y: auto/);
    expect(css).toMatch(/\.cust-modal \.cust-modal-foot \{[\s\S]*?flex: none/);
  });

  it('ความกว้างโมดัลอยู่ในช่วง 840–920px ตามสเปก', () => {
    const width = /\.dialog\.cust-modal \{[\s\S]*?width: min\(94vw, (\d+)px\)/.exec(css)?.[1];
    expect(Number(width)).toBeGreaterThanOrEqual(840);
    expect(Number(width)).toBeLessThanOrEqual(920);
  });

  it('textarea สูงในช่วง 72–88px ไม่ครองพื้นที่โมดัล', () => {
    // ต้องจับกฎเฉพาะของ textarea (ที่มี max-height คู่กัน) ไม่ใช่กฎรวม input+textarea ที่ 44px
    const h = /textarea \{ min-height: (\d+)px; max-height/.exec(css)?.[1];
    expect(Number(h)).toBeGreaterThanOrEqual(72);
    expect(Number(h)).toBeLessThanOrEqual(88);
  });
});

/* ============================================================
   PHASE 40 — แผงตัวกรอง
   เดิม .purchase-order-filters label{width:100%} ทำให้ทุก control
   กินเต็มบรรทัดคนละแถว ป้ายจึงหลุดจาก select และ checkbox ลอยกลางที่ว่าง
   ============================================================ */
describe('PHASE 40 — แผงตัวกรองใบสั่งซื้อ', () => {
  const page = read('pages/PurchaseOrderPages.tsx');
  const css = read('styles/phase34-reskin.css');

  it('ใช้โครง filter-grid / filter-field / filter-check ที่ใช้ซ้ำได้', () => {
    expect(page).toContain('filter-grid');
    expect(page).toContain('filter-field');
    expect(page).toContain('filter-check');
    expect(css).toContain('.filter-grid');
  });

  it('เลิกใช้กฎเดิมที่ทำให้ control กินเต็มบรรทัด', () => {
    expect(page).not.toContain('className="purchase-order-filters"');
  });

  it('ป้ายกับ control อยู่ในคอลัมน์เดียวกัน ระยะห่างกระชับ', () => {
    expect(css).toMatch(/\.filter-field \{[\s\S]*?flex-direction: column/);
    expect(css).toMatch(/\.filter-field \{[\s\S]*?gap: 7px/);
  });

  it('select และ checkbox สูงเท่ากับ control มาตรฐาน จึงเรียงแนวเดียวกันได้', () => {
    expect(css).toMatch(/\.filter-field > select[\s\S]*?height: var\(--control-h\)/);
    expect(css).toMatch(/\.filter-check \{[\s\S]*?height: var\(--control-h\)/);
  });

  it('checkbox ยังเป็น input จริง ไม่ใช่ div ปลอม และใช้สีของระบบ', () => {
    expect(page).toContain('type="checkbox"');
    expect(css).toMatch(/\.filter-check input\[type="checkbox"\][\s\S]*?width: 18px/);
    expect(css).toMatch(/\.filter-check input\[type="checkbox"\][\s\S]*?accent-color: var\(--blue\)/);
  });

  it('สถานะติ๊กแล้วต่างจากยังไม่ติ๊ก และมีวงแหวนโฟกัสทั้งแถว', () => {
    expect(css).toContain('.filter-check:has(input:checked)');
    expect(css).toMatch(/\.filter-check:focus-within \{[\s\S]*?box-shadow: var\(--focus-ring\)/);
  });

  it('จอแคบให้ stack ไม่ทับกัน', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.filter-field \{ flex: 1 1 100%/);
  });
});
