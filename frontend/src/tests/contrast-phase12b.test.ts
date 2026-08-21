import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * PHASE 12B — regression test ของการแก้คอนทราสต์
 * ค่าคอนทราสต์ทุกตัวด้านล่างวัดจริงในเบราว์เซอร์กับ markup จริง (244 elements)
 * ทั้งธีมสว่างและธีมมืด ผลลัพธ์หลังแก้: ไม่ผ่านเกณฑ์ 0 รายการทั้งสองธีม
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');
/** ตัดคอมเมนต์ทิ้งก่อนอ่านค่า token — คอมเมนต์อธิบายการแก้มีค่าสีตัวอย่างอยู่ข้างใน */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = stripComments(read('styles/tokens.css'));
const consistency = read('styles/consistency.css');
const dashboard = read('styles/dashboard.css');

/** คำนวณ contrast ratio ตามสูตร WCAG 2.1 */
const relLum = (hex: string) => {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [relLum(a), relLum(b)];
  return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
};

/** ดึงค่า token จากบล็อกที่ระบุ */
const tokenIn = (block: string, name: string) => {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block);
  return m?.[1] ?? '';
};

describe('PHASE 12B — คอนทราสต์ธีมสว่าง', () => {
  const lightBlock = tokens.slice(0, tokens.indexOf(':root.dark'));

  it('--text-subtle ผ่าน AA บนทุกพื้นหลังของธีมสว่าง', () => {
    const subtle = tokenIn(lightBlock, '--text-subtle');
    expect(subtle.toUpperCase()).toBe('#5E6E84');
    // พื้นหลังจริงที่ข้อความรองไปวางอยู่
    expect(contrast(subtle, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);   // --surface
    expect(contrast(subtle, '#F5F8FC')).toBeGreaterThanOrEqual(4.5);   // --surface-2
    expect(contrast(subtle, '#eef3f8')).toBeGreaterThanOrEqual(4.5);   // --surface-muted
  });

  it('ค่าเดิม #6d7b91 ไม่ผ่าน — กันไม่ให้ถอยกลับ', () => {
    expect(contrast('#6d7b91', '#FFFFFF')).toBeLessThan(4.5);
  });

  it('--text และ --text-muted ยังผ่านตามเดิม', () => {
    expect(contrast(tokenIn(lightBlock, '--text'), '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokenIn(lightBlock, '--text-muted'), '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('PHASE 12B — คอนทราสต์ธีมมืด', () => {
  const darkBlock = tokens.slice(tokens.indexOf(':root.dark'), tokens.indexOf('@media print'));
  const DARK_CARD = '#101F31';   // สีพื้นการ์ดที่วัดได้จริงในธีมมืด

  it('ไม่แตะ --text-subtle ของธีมมืด เพราะผ่านอยู่แล้ว', () => {
    const subtle = tokenIn(darkBlock, '--text-subtle');
    expect(subtle.toUpperCase()).toBe('#93A6BC');
    expect(contrast(subtle, DARK_CARD)).toBeGreaterThanOrEqual(4.5);
  });

  it('ข้อความสถานะและลิงก์ในธีมมืดใช้ token คู่พื้นเข้ม', () => {
    // --success / --brand-blue / --danger ให้ 3.3–3.6:1 บนพื้นเข้ม จึงต้องใช้ *-fg
    expect(dashboard).toContain(':root.dark .dash-ok { color: var(--success-fg); }');
    expect(dashboard).toContain(':root.dark .dash-list .dl-open { color: var(--info-fg); }');
    expect(dashboard).toContain(':root.dark .dash-op .op-head a { color: var(--info-fg); }');
    expect(consistency).toContain(':root.dark .field-error { color: var(--danger-fg); }');
  });

  it('token คู่พื้นเข้มที่ใช้ ผ่านเกณฑ์จริง', () => {
    for (const name of ['--success-fg', '--info-fg', '--danger-fg']) {
      expect(contrast(tokenIn(darkBlock, name), DARK_CARD)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('สีที่เคยไม่ผ่านบนพื้นเข้ม ยังไม่ผ่าน — ยืนยันว่าต้องใช้ *-fg จริง', () => {
    expect(contrast('#16845B', DARK_CARD)).toBeLessThan(4.5);   // --success
    expect(contrast('#1677C8', DARK_CARD)).toBeLessThan(4.5);   // --brand-blue
    expect(contrast('#C44251', DARK_CARD)).toBeLessThan(4.5);   // --danger
  });

  it('กฎธีมมืดต้องไม่ hardcode ค่าสี', () => {
    const rules = [...dashboard.split('\n'), ...consistency.split('\n')].filter((l) => l.includes(':root.dark'));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

describe('PHASE 12B — งานพิมพ์ A4', () => {
  const index = read('index.css');
  const printBlock = index.slice(index.indexOf('@media print{'));

  it('ตั้งขนาดกระดาษ A4 พร้อมระยะขอบ', () => {
    expect(printBlock).toContain('@page{size:A4;margin:14mm}');
  });

  it('ซ่อนส่วนประกอบของแอปตอนพิมพ์', () => {
    for (const sel of ['.no-print', '.app-sidebar', '.app-header', '.doc-actions']) {
      expect(printBlock).toContain(sel);
    }
  });

  it('บังคับพื้นขาว/ตัวอักษรเข้ม ไม่ให้ธีมมืดรั่วลงกระดาษ', () => {
    expect(printBlock).toMatch(/html,body,\.dark body\{background:#fff!important;color:#111!important\}/);
  });

  it('หัวตารางซ้ำทุกหน้า และไม่ตัดกลางแถว/กลางการ์ด', () => {
    expect(printBlock).toContain('display:table-header-group');
    expect(printBlock).toContain('.doc-lines tr{break-inside:avoid}');
    expect(printBlock).toMatch(/\.doc-card\{[^}]*break-inside:avoid/);
    expect(printBlock).toMatch(/\.print-signatures\{[^}]*break-inside:avoid/);
  });
});
