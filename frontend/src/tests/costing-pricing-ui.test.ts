import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzePrice, priceFromMargin, priceFromMarkup } from '@/lib/cost-sheet';

/**
 * PHASE 4B — Costing + Pricing UI
 * ตรวจเฉพาะสิ่งที่หน้าจอเปลี่ยน สูตรคำนวณยังใช้ lib/cost-sheet ชุดเดิม
 */

const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const costing = read('pages/catalog/CostingWorkspacePage.tsx');
const pricing = read('pages/catalog/PricingWorkspacePage.tsx');
const recipe = read('pages/catalog/RecipeBuilderPage.tsx');
const header = read('components/layout/Header.tsx');
const css = read('styles/costing-pricing.css');
const rbCss = read('styles/recipe-builder.css');

/* ---------- คณิตศาสตร์ราคา: ยืนยันว่าสูตรเดิมยังใช้ได้ตามที่หน้าจอสัญญา ---------- */
describe('pricing math — สูตรเดิม ไม่ได้แก้', () => {
  const cost = 16.64;

  it('1 แก้ราคาขาย → margin/markup ตามมา', () => {
    const r = analyzePrice(cost, 28);
    expect(r.profit).toBeCloseTo(11.36, 2);
    expect(r.marginPercent).toBeCloseTo(40.57, 2);
    expect(r.markupPercent).toBeCloseTo(68.27, 2);
  });

  it('2 แก้ margin → ได้ราคาขายที่ย้อนกลับมา margin เดิม', () => {
    const price = priceFromMargin(cost, 40);
    // priceFromMargin ปัดราคาเป็นสตางค์ การวนกลับจึงคลาดได้ระดับ 0.01% ซึ่งถูกต้องสำหรับเงินจริง
    expect(analyzePrice(cost, price).marginPercent).toBeCloseTo(40, 1);
  });

  it('3 แก้ markup → ได้ราคาขายที่ย้อนกลับมา markup เดิม', () => {
    const price = priceFromMarkup(cost, 68.27);
    expect(analyzePrice(cost, price).markupPercent).toBeCloseTo(68.27, 1);
  });

  it('4 ราคาต่ำกว่าต้นทุน ถูกทำเครื่องหมายว่าขาดทุน', () => {
    const r = analyzePrice(cost, 12);
    expect(r.isLoss).toBe(true);
    expect(r.profit).toBeLessThan(0);
  });

  it('5 ราคาเท่าต้นทุนพอดี ไม่นับเป็นขาดทุน', () => {
    expect(analyzePrice(cost, cost).isLoss).toBe(false);
  });

  it('6 สาม tier ที่ margin ต่างกัน เรียงราคาจากมากไปน้อยตามที่การ์ดแสดง', () => {
    const prices = [40, 29.4, 21.6].map((m) => priceFromMargin(cost, m));
    expect(prices[0]).toBeGreaterThan(prices[1]);
    expect(prices[1]).toBeGreaterThan(prices[2]);
  });
});

/* ---------- Costing page ---------- */
describe('costing page', () => {
  it('7 ใช้ primitive จาก Phase 2+3 ไม่สร้าง shell ใหม่', () => {
    expect(costing).toContain('<PageContainer size="wide"');
    expect(costing).toContain('<PageHeader');
    expect(costing).toContain('<FilterBar');
    expect(costing).toContain('<ContentCard');
    expect(costing).toContain('<StickySummary');
  });

  it('8 KPI ตอบคำถามหลัก 4 ข้อ และต้นทุนต่อหน่วยถูกเน้น', () => {
    expect(costing).toContain('<KPIGrid columns={4}>');
    for (const label of ['ต้นทุนรวมทั้งสูตร', 'ผลผลิตที่ได้', 'ต้นทุนต่อหน่วย', 'ค่าใช้จ่ายการผลิตเพิ่มเติม']) {
      expect(costing).toContain(label);
    }
    expect(costing).toMatch(/label="ต้นทุนต่อหน่วย"[\s\S]{0,200}tone="info"/);
  });

  it('9 breakdown มีทั้งยอดเงินและ % ของต้นทุนรวม', () => {
    expect(costing).toContain('cg-pct');
    expect(costing).toContain('cg-amt');
    expect(costing).toContain('share.toFixed(1)');
  });

  it('10 ใช้แถบแนวนอน ไม่ใช้ donut/pie ที่กินพื้นที่', () => {
    expect(costing).toContain('cg-bar');
    expect(costing).not.toContain('conic-gradient');
    expect(costing).not.toContain('fcx-donut');
  });

  it('11 breakdown ขยายดูรายการย่อยได้ และบอกสถานะด้วย aria-expanded', () => {
    expect(costing).toContain('aria-expanded');
    expect(costing).toContain('cg-detail');
  });

  it('12 ตารางรายละเอียดมีคอลัมน์หน่วยและ % ของต้นทุน', () => {
    expect(costing).toContain('% ของต้นทุน');
    expect(costing).toContain('<th>หน่วย</th>');
    expect(costing).toContain('pct(c, cost.totalCost)');
  });

  it('13 การ์ดตรวจสอบต้นทุนใช้ state เดิม ไม่มีกฎธุรกิจใหม่', () => {
    expect(costing).toContain('cost-checklist');
    // ต้องอ้าง state ที่หน้านี้คำนวณอยู่แล้ว
    expect(costing).toContain('noPriceNames.length === 0');
    expect(costing).toContain('hasPackaging');
  });

  it('14 บอกชัดว่าอ้างอิงเวอร์ชันที่บันทึกล่าสุด ไม่ใช่ draft', () => {
    expect(costing).toContain('เวอร์ชันที่บันทึกล่าสุด');
    expect(costing).toContain('ยังไม่ได้บันทึก');
    expect(costing).toContain('คำนวณล่าสุด');
  });

  it('15 มีทางไปต่อทั้งราคาขายและแก้สูตร โดยไม่ต้องกลับ sidebar', () => {
    expect(costing).toContain('to="/pricing"');
    expect(costing).toContain('`/recipes/${recipeId}`');
  });

  it('16 มีปุ่มคำนวณใหม่ และ loading state', () => {
    expect(costing).toContain('คำนวณใหม่');
    expect(costing).toContain('setRecalcAt(Date.now())');
    expect(costing).toContain('KPISkeleton');
  });
});

/* ---------- Pricing page ---------- */
describe('pricing page', () => {
  it('17 ใช้ primitive จาก Phase 2+3', () => {
    expect(pricing).toContain('<PageContainer size="wide"');
    expect(pricing).toContain('<PageHeader');
    expect(pricing).toContain('<FilterBar');
    expect(pricing).toContain('<StickySummary');
  });

  it('18 ยึดต้นทุนต่อหน่วยไว้บนสุดเป็น KPI', () => {
    expect(pricing).toContain('<KPIGrid columns={4}>');
    expect(pricing).toMatch(/label="ต้นทุนต่อหน่วย"[\s\S]{0,240}tone="info"/);
  });

  it('19 มีครบ 3 ระดับราคา', () => {
    expect(pricing).toContain("label: 'ราคาปลีก'");
    expect(pricing).toContain("label: 'ราคาส่ง'");
    expect(pricing).toContain("label: 'ราคาคนรู้จัก'");
  });

  it('20 แต่ละ tier เลือกวิธีคิดได้ 3 แบบ', () => {
    expect(pricing).toContain("['sellingPrice', 'marginPercent', 'markupPercent']");
    expect(pricing).toContain('setTierMode');
  });

  it('21 ใช้ศัพท์ไทยที่เข้าใจได้ ไม่ใช่ Margin/Markup ลอย ๆ', () => {
    expect(pricing).toContain('กำไรเทียบราคาขาย');
    expect(pricing).toContain('กำไรบวกจากต้นทุน');
  });

  it('22 มีคำอธิบายว่า Margin/Markup คืออะไร', () => {
    expect(pricing).toContain('price-glossary');
    expect(pricing).toContain('ของ<b>ราคาขาย</b>');
    expect(pricing).toContain('จาก<b>ต้นทุน</b>');
  });

  it('23 มีตารางเทียบทุกระดับในมุมเดียว', () => {
    expect(pricing).toContain('price-compare');
    expect(pricing).toContain('ตารางเทียบราคา');
    expect(pricing).toContain('เกณฑ์เปรียบเทียบ');
  });

  it('24 เตือนเมื่อราคาต่ำกว่าต้นทุน แต่ไม่บล็อกการบันทึก', () => {
    expect(pricing).toContain('ต่ำกว่าทุน');
    expect(pricing).toContain('calc.isLoss');
    // ปุ่มบันทึก disabled ได้เฉพาะกำลังบันทึก/ไม่มีสิทธิ์ ไม่ใช่เพราะขาดทุน
    expect(pricing).toContain('disabled={saving || !canEditPricing}');
  });

  it('25 สรุปนับจำนวนระดับที่ขาดทุน และบอกกำไรสูงสุด/ต่ำสุด', () => {
    expect(pricing).toContain('ระดับราคาที่ต่ำกว่าต้นทุน');
    expect(pricing).toContain('กำไรสูงสุด/ต่ำสุด');
  });

  it('26 มีทางไปดูต้นทุนและแก้สูตร', () => {
    expect(pricing).toContain('to="/costing"');
    expect(pricing).toContain('/recipes/${recipeId}');
  });

  it('27 สถานะในตารางไม่ได้สื่อด้วยสีอย่างเดียว', () => {
    expect(pricing).toContain('มีกำไร');
    expect(pricing).toContain('ต่ำกว่าทุน');
  });
});

/* ---------- CSS ---------- */
describe('costing/pricing css', () => {
  it('28 ใช้ token ไม่ hardcode สีธีม', () => {
    expect(css).toContain('var(--space-');
    expect(css).toContain('var(--control-h)');
    expect(css).toContain('var(--radius-card)');
    expect(css).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(css).not.toMatch(/color:\s*#[0-9a-f]{6}/i);
  });

  it('29 breakpoint ตรงกับมาตรฐานระบบ', () => {
    const bps = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(bps.every((b) => [1024, 760, 430].includes(b))).toBe(true);
  });

  it('30 ตารางกลายเป็นการ์ดบนมือถือ', () => {
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?content: attr\(data-label\)/);
    expect(costing).toContain('data-label=');
    expect(pricing).toContain('data-label=');
  });

  it('31 แผงสรุปเลิก sticky บนแท็บเล็ต', () => {
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*?position: static/);
  });
});

/* ---------- PART 23/24 leftovers ---------- */
describe('leftovers จาก Phase 4A', () => {
  it('32 การ์ดตรวจสอบของ Recipe Builder เป็น checklist จริง มีสถานะเป็นข้อความ', () => {
    expect(recipe).toContain('className="reconcile s2-card"');
    expect(recipe).toContain('rc-state');
    expect(recipe).toContain('okText={s.checkPass}');
    expect(rbCss).toContain('.reconcile .rc-state');
  });

  it('33 packaging auto-calc มี preview อ่านเป็นประโยคได้', () => {
    expect(recipe).toContain('pkg-auto-preview');
    expect(recipe).toContain('pkg-auto-toggle');
    expect(rbCss).toContain('.pkg-auto-preview');
  });

  it('34 conv-toggle ยังมี use-case จริง จึงเก็บไว้ (ไม่ใช่ dead markup)', () => {
    // ปุ่มนี้เปิดแผงที่มี "ราคาซื้อต่อหน่วยซื้อ" ซึ่งแถวปกติไม่ได้แสดง
    expect(recipe).toContain('setShowHelper');
    expect(recipe).toContain('unit-helper-panel');
    expect(recipe).toContain('L.purchasePriceLabel');
    // ต้องไม่ถูกซ่อนจนกดไม่ได้
    expect(rbCss).not.toContain('.rb2 .conv-toggle { display: none; }');
  });

  it('35 ปุ่มค้นหาหัวเว็บที่ไม่ทำงานถูกถอดออกแล้ว', () => {
    expect(header).not.toContain('onClick={() => {}}');
    expect(header).not.toContain('className="header-search"');
    expect(header).not.toContain('<kbd>');   // คีย์ลัดที่ไม่มี handler
  });
});
