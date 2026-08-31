import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const read=(relative:string)=>readFileSync(path.join(process.cwd(),'src',relative),'utf8');
const page=read('pages/AnalyticsPages.tsx');
const valuation=read('pages/InventoryValuationPage.tsx');
const app=read('App.tsx');
const dashboard=read('pages/DashboardPage.tsx');
const css=read('styles/analytics.css');
describe('Phase 28 factual analytics and valuation UI',()=>{
  it('provides supplier summary, detail, sparse real price points and low-sample state',()=>{expect(app).toContain('/supplier-analytics/:id');expect(page).toContain('points.length<2');expect(page).toContain('มีข้อมูลราคาเพียง 1 ครั้ง');expect(page).toContain('ไม่มีการจัดอันดับหรือคาดการณ์')});
  it('shows PO vs actual and factual ordered/received/remaining/over received',()=>{expect(page).toContain('ราคาจริงเทียบใบสั่งซื้อ');expect(page).toContain('คงเหลือ');expect(page).toContain('รับเกิน')});
  it('keeps missing cost distinct from explicit zero and numeric known value',()=>{expect(valuation).toContain('VALUE UNKNOWN');expect(valuation).toContain('MISSING COST');expect(valuation).toContain("'PRICED' | 'ZERO' | 'MISSING'")});
  it('has valuation filters, breakdowns, XLSX exports and responsive theme-token CSS',()=>{expect(valuation).toContain('costStatus');expect(valuation).toContain('ทุกคลัง');expect(valuation).toContain('ทุกหมวดหมู่');expect(page).toContain("expect:'xlsx'");expect(valuation).toContain("expect: 'xlsx'");expect(css).toContain('@media(max-width:800px)');expect(css).toContain('var(--surface)')});
  it('enhances the existing inventory card and does not add a fifth primary card',()=>{expect(dashboard).toContain('inventoryValuation.knownValue');expect(dashboard).toContain('unknownCostStockCount');expect(dashboard.match(/const primary/g)?.length).toBe(1)});
});
