import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(process.cwd(), 'src/pages/PurchasePlanningPages.tsx'), 'utf8');
const routes = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const nav = readFileSync(resolve(process.cwd(), 'src/components/layout/nav-config.ts'), 'utf8');
const css = readFileSync(resolve(process.cwd(), 'src/styles/purchase-planning.css'), 'utf8');

describe('purchase planning UI', () => {
  it('provides list, create, edit and detail routes with governed navigation', () => {
    expect(routes).toContain('/purchase-planning/new'); expect(routes).toContain('/purchase-planning/:id/edit'); expect(routes).toContain('/purchase-planning/:id'); expect(nav).toContain('PURCHASE_PLAN_VIEW');
  });
  it('keeps advisory language and explicit recalculation visible', () => {
    expect(page).toContain('ไม่จองหรือขยับสต็อก'); expect(page).toContain('คำนวณใหม่ / Refresh current stock'); expect(page).toContain('เอกสารแนะนำ ไม่ใช่ใบสั่งซื้อ');
  });
  it('shows required, reserved, available, shortage, purchase units, prices and evidence-based suppliers', () => {
    for (const text of ['ต้องใช้','จอง','พร้อมใช้','ขาด / ต้องซื้อ','หน่วยซื้อ','ราคาล่าสุด','ผู้ขายล่าสุด','ที่มาความต้องการ']) expect(page).toContain(text);
    expect(page).toContain('ไม่มีหลักฐานผู้ขาย'); expect(page).not.toContain('ผู้ขายที่ดีที่สุด');
  });
  it('uses labelled shortage states plus responsive semantic-token styling', () => {
    for (const text of ['ไม่มีของ','มีบางส่วน','เพียงพอ']) expect(page).toContain(text); expect(css).toContain('@media(max-width:700px)'); expect(css).toContain('var(--danger-soft)'); expect(css).toContain('var(--input-bg)');
  });
});
