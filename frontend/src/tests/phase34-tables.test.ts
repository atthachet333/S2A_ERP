import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { displayEnum } from '@/lib/presentation';

/**
 * PHASE 34 — ความกว้างตารางที่จอโน้ตบุ๊ก
 *
 * ทุกค่าด้านล่างมาจากการวัดจริงในเบราว์เซอร์ โดย inject ตารางจำลอง
 * ที่ใช้คลาสและ CSS ชุดเดียวกับหน้าจริง แล้วอ่าน scrollWidth/clientWidth
 *
 * พื้นที่เนื้อหาจริงที่ 1366px = 1366 - 264 (แถบข้าง) - ขอบ ≈ 1054px
 * ตารางหลักจึงต้องไม่ "ถูกบังคับ" ให้กว้างเกินกว่านั้นด้วย min-width
 * (ความกว้างที่โตตามเนื้อหาจริงยังเลื่อนแนวนอนได้ตามปกติ)
 */

const CONTENT_WIDTH_1366 = 1054;
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

/** อ่านค่า min-width ที่ "มีผลจริง" คือกฎสุดท้ายที่ชนะใน cascade */
function effectiveMinWidth(selector: string): number | undefined {
  const files = ['index.css', 'styles/phase34-reskin.css'];
  let last: number | undefined;
  for (const file of files) {
    // แยกบล็อกด้วย } แล้วจับคู่ selector แบบตรงตัว เลี่ยงการ escape regex ให้ยุ่ง
    // ตัดคอมเมนต์ทิ้งก่อน ไม่งั้นข้อความอธิบายจะถูกนับรวมเป็นส่วนหนึ่งของ selector
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const block of css.split('}')) {
      const brace = block.indexOf('{');
      if (brace < 0) continue;
      const selectors = block.slice(0, brace).split(',').map((part) => part.trim());
      if (!selectors.includes(selector)) continue;
      const found = /min-width:\s*(\d+)px/.exec(block.slice(brace));
      if (found) last = Number(found[1]);
    }
  }
  return last;
}

describe('PHASE 34 — ตารางต้องไม่ถูกบังคับให้ล้นจอโน้ตบุ๊ก', () => {
  it('ตารางรายการสินค้าไม่ถูกบังคับให้กว้างเกินพื้นที่ที่ 1366px', () => {
    const width = effectiveMinWidth('.item-list-workspace .data-table');
    expect(width).toBeDefined();
    // เดิม 1180px ทำให้ล้นออกราว 126px ทั้งที่เนื้อหาจริงกว้างแค่ 1052px
    expect(width!).toBeLessThanOrEqual(CONTENT_WIDTH_1366);
  });

  it('ตารางตรวจผลอ่านเอกสารก็ต้องไม่ถูกบังคับให้ล้นเช่นกัน', () => {
    const width = effectiveMinWidth('.extract-table');
    expect(width).toBeDefined();
    expect(width!).toBeLessThanOrEqual(CONTENT_WIDTH_1366);
  });

  it('ยังคงมีพื้นกันคอลัมน์ถูกบีบจนอ่านไม่ออกบนจอแคบ', () => {
    // ไม่ใช่การถอด min-width ทิ้ง — ต้องยังมีค่าที่มากพอสำหรับ 12 คอลัมน์
    expect(effectiveMinWidth('.item-list-workspace .data-table')!).toBeGreaterThanOrEqual(900);
    expect(effectiveMinWidth('.extract-table')!).toBeGreaterThanOrEqual(900);
  });
});

describe('PHASE 34 — หัวตารางไทย', () => {
  const reskin = read('styles/phase34-reskin.css');
  const headerRule = /\.data-table thead th \{([\s\S]*?)\}/.exec(reskin)?.[1] ?? '';

  it('ไม่ถ่างตัวอักษรหัวตาราง เพราะภาษาไทยอ่านยากขึ้นและกินความกว้างเปล่า', () => {
    expect(headerRule).toMatch(/letter-spacing:\s*normal/);
  });

  it('หัวตารางตัดบรรทัดได้ ไม่บังคับ nowrap จนดันความกว้างคอลัมน์', () => {
    expect(headerRule).toMatch(/white-space:\s*normal/);
  });

  it('หัวตารางยังติดด้านบนตอนเลื่อน และใช้ token ของ z-index', () => {
    expect(headerRule).toMatch(/position:\s*sticky/);
    expect(headerRule).toMatch(/z-index:\s*var\(--z-sticky\)/);
  });
});

/* ============================================================
   PHASE 34 — สถานะวันหมดอายุของล็อต (FEFO)
   ก่อนแก้: หน้า /inventory/lots ยืมคลาสของ "สถานะต้นทุน" มาใช้
   ทำให้ EXPIRED และ EXPIRING_SOON ได้คลาส .missing เหมือนกัน = แดงเหมือนกัน
   ซึ่งเป็นคนละเรื่องกันโดยสิ้นเชิงในงานอาหาร
   ============================================================ */
describe('PHASE 34 — ป้ายสถานะล็อตต้องแยกออกจากกัน', () => {
  it('ใกล้หมดอายุกับหมดอายุแล้ว ต้องคนละโทนสี', () => {
    const soon = displayEnum('EXPIRING_SOON');
    const expired = displayEnum('EXPIRED');
    expect(soon.tone).toBe('warning');
    expect(expired.tone).toBe('danger');
    expect(soon.tone).not.toBe(expired.tone);
  });

  it('ทุกสถานะล็อตมีป้ายภาษาไทย ไม่ปล่อยค่า enum ดิบออกหน้าจอ', () => {
    for (const status of ['GOOD', 'EXPIRING_SOON', 'EXPIRED', 'NO_EXPIRY']) {
      const display = displayEnum(status);
      expect(display.label, status).toMatch(/[฀-๿]/);
      expect(display.label, status).not.toBe(status);
    }
  });

  it('หน้าล็อตใช้คอมโพเนนต์กลาง ไม่ยืมคลาสสถานะต้นทุนมาแสดงวันหมดอายุ', () => {
    const page = read('pages/InventoryLotsPage.tsx');
    expect(page).toContain('LotStatusBadge');
    expect(page).not.toMatch(/cost-pill \$\{row\.status/);
    // ต้องมีทั้งสถานะกำลังโหลดและสถานะว่างจากคอมโพเนนต์กลาง
    expect(page).toContain('SkeletonRows');
    expect(page).toContain('EmptyState');
  });
});

/* ============================================================
   PHASE 35 — กล่องยืนยันต้องไม่ล้นจอ
   วัดจริงที่จอสูง 768px ด้วยเนื้อหายาว:
     ก่อนแก้ .dialog สูง 928px ล้นจอและเลื่อนไม่ได้ ปุ่มยืนยันจึงกดไม่ถึง
     หลังแก้ สูง 634px (88vh) เนื้อหาเลื่อนได้ ปุ่มอยู่ในกรอบเสมอ
   ============================================================ */
describe('PHASE 35 — ConfirmDialog ต้องพอดีจอ', () => {
  const reskin = read('styles/phase34-reskin.css');
  const dialogRule = /\.dialog \{([\s\S]*?)\}/.exec(reskin)?.[1] ?? '';

  it('กล่องยืนยันมีเพดานความสูง ไม่ปล่อยให้ยืดเกินจอ', () => {
    expect(dialogRule).toMatch(/max-height:\s*88vh/);
  });

  it('เนื้อหาข้างในเลื่อนได้ และปลด min-height:auto ของ flex item', () => {
    const bodyRule = /\.dialog \.dialog-body \{([\s\S]*?)\}/.exec(reskin)?.[1] ?? '';
    expect(bodyRule).toMatch(/overflow-y:\s*auto/);
    expect(bodyRule).toMatch(/min-height:\s*0/);
  });

  it('แถบปุ่มไม่ถูกบีบหาย', () => {
    expect(reskin).toMatch(/\.dialog \.dialog-actions \{[^}]*flex:\s*none/);
  });
});
