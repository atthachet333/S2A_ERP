import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isOverReserved, stockEquation } from '@/lib/inventory-inspector';

/** PHASE 6D — OPERATIONS FINAL CLOSURE */

describe('สมการสต็อกใน Inventory Inspector', () => {
  it('1 มีของจอง → แสดงสมการ คงเหลือ − จองแล้ว = พร้อมใช้', () => {
    const e = stockEquation(70, 4.3, 65.7, 'KG');
    expect(e.equation).toBe('70 KG − 4.3 KG = 65.7 KG');
    expect(e.allAvailable).toBe(false);
    expect(e.mismatch).toBe(false);
  });

  it('2 ไม่มีของจอง → ไม่ต้องมีสมการ บอกว่าพร้อมใช้ทั้งหมด', () => {
    const e = stockEquation(70, 0, 70, 'KG');
    expect(e.allAvailable).toBe(true);
    expect(e.equation).toBeNull();
  });

  it('3 ไม่มีหน่วย ก็ไม่เติมหน่วยมั่ว', () => {
    expect(stockEquation(10, 2, 8).equation).toBe('10 − 2 = 8');
  });

  it('4 backend ส่งเลขไม่สอดคล้องกัน → ไม่แต่งสมการเอง', () => {
    const e = stockEquation(70, 4, 60, 'KG');
    expect(e.mismatch).toBe(true);
    expect(e.equation).toBeNull();
  });

  it('5 ทศนิยมคลาดเคลื่อนเล็กน้อยยังถือว่าตรงกัน', () => {
    expect(stockEquation(0.3, 0.1, 0.19999999, '').mismatch).toBe(false);
  });

  it('6 ยอดติดลบยังแสดงสมการได้ ไม่ซ่อนความจริง', () => {
    expect(stockEquation(-5, 0, -5, 'KG').allAvailable).toBe(true);
    expect(stockEquation(5, 8, -3, 'KG').equation).toBe('5 KG − 8 KG = -3 KG');
  });

  it('7 จองเกินของที่มี → เตือน', () => {
    expect(isOverReserved(5, 8)).toBe(true);
    expect(isOverReserved(8, 5)).toBe(false);
    expect(isOverReserved(5, 5)).toBe(false);
  });
});

/* ---------- โครงหน้า ---------- */
const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const inv = read('pages/InventoryPages.tsx');
const detail = read('pages/OperationDetailPages.tsx');
const ops = read('pages/OperationsPages.tsx');
const insCss = read('styles/inventory-inspector.css');
const workspace = read('styles/workspace.css');
const index = read('index.css');

describe('Inventory Inspector (PART 1–6)', () => {
  it('8 เป็น dialog ที่ screen reader อ่านชื่อสินค้าได้', () => {
    expect(inv).toContain('role="dialog" aria-modal="true" aria-labelledby="inv-inspector-title"');
    expect(inv).toContain('id="inv-inspector-title"');
  });

  it('9 ปิดด้วย ESC ล็อกการเลื่อนพื้นหลัง และคืนโฟกัสให้ปุ่มที่เปิด', () => {
    expect(inv).toContain("if (e.key === 'Escape') onClose()");
    expect(inv).toContain("document.body.style.overflow = 'hidden'");
    expect(inv).toContain('opener?.focus?.()');
  });

  it('10 พร้อมใช้เป็นตัวเลขเด่นที่สุด และมีสมการที่มา', () => {
    expect(inv).toContain('inv-metric-lead');
    expect(inv).toContain('stockEquation(row.onHand, row.reserved, row.available, row.unit)');
    expect(inv).toContain('พร้อมใช้ทั้งหมด');
    // ตัวเลขนำต้องใหญ่กว่าตัวเลขประกอบชัดเจน
    const lead = /\.inv-metric-lead > strong \{[^}]*font-size: (\d+)px/.exec(insCss);
    const grid = /\.inv-metric-grid b \{[^}]*font-size: (\d+)px/.exec(insCss);
    expect(Number(lead?.[1])).toBeGreaterThan(Number(grid?.[1]) + 8);
  });

  it('11 มีตัวเลขประกอบครบและปุ่มตามสิทธิ์', () => {
    for (const label of ['คงเหลือ', 'จองแล้ว', 'ต้นทุนล่าสุด', 'มูลค่าสต็อก', 'จุดสั่งซื้อ']) {
      expect(inv).toContain(`<span>${label}</span>`);
    }
    expect(inv).toContain('{canAdjust && <Link className="btn primary" to="/inventory/adjustments">');
  });

  it('12 การเคลื่อนไหวล่าสุดกดกลับไปเอกสารต้นทางได้', () => {
    expect(inv).toContain('inv-inspector-movements');
    expect(inv).toContain('history.slice(0, 8)');
    expect(inv).toContain('sourceLink');
  });

  it('13 เดสก์ท็อปเป็นแผงขวา 560–620px มือถือเป็น bottom sheet', () => {
    expect(insCss).toContain('width: clamp(560px, 42vw, 620px)');
    expect(insCss).toMatch(/@media \(max-width: 760px\)[\s\S]*?max-height: 92dvh/);
  });

  it('14 ปุ่มเปิดแผงเป็น button จริง ไม่ใช่ span ใน tr', () => {
    expect(inv).toContain('<button type="button" className="inv-open"');
    expect(inv).not.toContain('<span className="inv-open">');
  });

  it('15 ไอคอนประเภทการเคลื่อนไหวเหลือชุดเดียว ไม่ซ้อนสองอัน', () => {
    expect(inv).not.toContain('mv-pill');
    expect(index).not.toContain('.mv-pill');
    expect(inv).toContain('mv-type mv-');
  });
});

describe('หน้ารายละเอียดเอกสาร (PART 7–13)', () => {
  it('16 ทั้งสองเอกสารย้ายมาใช้ primitive กลางแล้ว ไม่ใช้ hero เดิม', () => {
    expect(detail).not.toContain('units-hero');
    expect(detail.match(/<PageContainer/g)?.length).toBeGreaterThanOrEqual(2);
    expect(detail.match(/<PageHeader/g)?.length).toBe(2);
    expect(detail.match(/<ContentCard/g)?.length).toBe(6);
  });

  it('17 แถบปุ่มเป็นตัวเดียวกันทั้งสองหน้า ลำดับจึงเหมือนกันแน่นอน', () => {
    expect(detail).toContain('function DocActionBar');
    expect(detail.match(/<DocActionBar/g)?.length).toBe(2);
  });

  it('18 ไม่มีสิทธิ์ = ไม่แสดงปุ่ม และบอกเหตุผล ไม่ปล่อยให้กดแล้วเจอ 403', () => {
    expect(detail).toContain('รายการนี้ต้องให้ผู้มีสิทธิ์ยืนยัน');
    expect(detail).toContain('{reverseAction && canAct &&');
  });

  it('19 ร่างต้องบอกว่ายังไม่มีผลต่อสต็อก', () => {
    expect(detail).toContain('เอกสารยังเป็นร่าง จึงยังไม่มีผลต่อสต็อก');
    expect(detail.match(/<LedgerNote/g)?.length).toBe(2);
  });

  it('20 ไม่ย้อนสร้างยอดก่อน/หลังจากสต็อกปัจจุบัน — ไม่มีข้อมูลก็แสดง —', () => {
    expect(detail).toContain('ไม่คำนวณย้อนหลังจากสต็อกปัจจุบัน');
    // ยอดก่อนต้องมาจาก ledger เท่านั้น
    expect(detail).toContain('im && im.before != null ? qty(im.before) : \'—\'');
    expect(detail).not.toContain('onHand -');
  });

  it('21 ไทม์ไลน์ใช้เวลาจริง ถ้าไม่มีก็บอกว่าไม่มี', () => {
    expect(detail).toContain('ไม่มีเวลาบันทึกไว้');
    expect(detail).toContain('ยังไม่เกิดขึ้น');
  });

  it('22 ยังคงยืนยัน/กลับรายการผ่าน ConfirmDialog ครบสี่กล่องเหมือนเดิม', () => {
    expect(detail.match(/<ConfirmDialog/g)?.length).toBe(4);
    expect(detail).not.toContain('window.confirm(');
  });
});

describe('ตัวเลือกสินค้าในใบเบิก (PART 14–15)', () => {
  it('23 แสดง รหัส · ชื่อ / ประเภท / คงเหลือ-จองแล้ว-พร้อมใช้', () => {
    expect(ops).toContain('{item.code} · {item.name}');
    expect(ops).toContain('ip-avail');
    expect(ops).toContain('พร้อมใช้ · คงเหลือ');
  });

  it('24 สถานะที่เลือกแล้วสื่อกับ screen reader ด้วย', () => {
    expect(ops).toContain('aria-pressed={added}');
    expect(ops).toContain('เพิ่มแล้ว');
  });

  it('25 ค้นไม่พบ บอกคำที่ค้น', () => {
    expect(ops).toContain('ไม่พบสินค้าที่ตรงกับ');
  });

  it('26 พร้อมใช้เด่นกว่าตัวเลขประกอบในรายการเลือก', () => {
    const avail = /\.ip-stock \.ip-avail\{[^}]*font-size:(\d+(?:\.\d+)?)px/.exec(index);
    const small = /\.ip-stock small\{[^}]*font-size:(\d+(?:\.\d+)?)px/.exec(index);
    expect(Number(avail?.[1])).toBeGreaterThan(Number(small?.[1]));
  });
});

describe('CSS (PART 18–21)', () => {
  it('27 ไฟล์ inspector ใช้ token ไม่ hardcode สีธีม', () => {
    expect(insCss).toContain('var(--space-');
    expect(insCss).toContain('var(--control-h)');
    expect(insCss).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(insCss).not.toMatch(/color:\s*#[0-9a-f]{6}/i);
  });

  it('28 breakpoint ตรงมาตรฐานระบบ', () => {
    const bps = [...insCss.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(bps.length).toBeGreaterThan(0);
    expect(bps.every((b) => [1024, 760, 430].includes(b))).toBe(true);
  });

  it('29 ใช้ z-index จากสเกลกลาง ไม่ตั้งเลขเอง', () => {
    expect(insCss).toContain('z-index: var(--z-drawer)');
    expect(insCss).not.toMatch(/z-index:\s*\d{3,}/);
  });

  it('30 กฎ CSS ของหน้าเดิมที่เลิกใช้แล้วถูกลบออกจริง', () => {
    for (const dead of ['.ops-hero', '.ops-form-layout', '.ops-section', '.ops-line-head', '.ops-primary']) {
      expect(workspace).not.toContain(dead);
    }
    expect(index).not.toContain('.inv-drawer');
  });

  it('31 คลาสที่ยังมีคนใช้ต้องไม่ถูกลบไปด้วย', () => {
    // .issue-row/.issue-head อยู่ในกฎเดียวกับของที่ตายแล้ว จึงต้องตรวจว่ายังอยู่
    for (const live of ['.issue-row', '.issue-head', '.notification-trigger', '.ops-page']) {
      expect(workspace).toContain(live);
    }
  });
});
