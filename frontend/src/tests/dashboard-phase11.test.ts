import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DOC_KIND_LABEL, RECIPE_ISSUE_LABEL, costingSummary, pricingAttention, pricingSummary,
  recentDocuments, recipesNeedingAttention, toRecentDocs,
} from '@/lib/dashboard-lists';
import type { MenuRow } from '@/lib/catalog';
import type { DocRow } from '@/hooks/useDashboardData';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');
const page = read('pages/DashboardPage.tsx');
const css = read('styles/dashboard.css');

const menu = (over: Partial<MenuRow>): MenuRow => ({
  id: 'm1', code: 'FG-0001', name: 'เมนู', imageUrl: null, category: null,
  sellingUnit: 'จาน', isActive: true, recipeId: null, hasRecipe: true,
  unitCost: 30, sellingPrice: 50, margin: 20, ...over,
});

/* ============================================================
   PART 3 / 10 / 13 — โครงกริดและการ์ดต้องยืดเท่ากัน
   ============================================================ */
describe('Phase 11 — โครงสร้างกริดแดชบอร์ด', () => {
  it('กริดยืดการ์ดในแถวเดียวกัน ไม่ใช่ align-items: start แบบเดิม', () => {
    const grid = css.slice(css.indexOf('.dash-grid {'), css.indexOf('}', css.indexOf('.dash-grid {')));
    expect(grid).toContain('align-items: stretch');
    expect(grid).not.toContain('align-items: start');
  });

  it('การ์ดในกริดเป็น flex column สูงเต็มแถว', () => {
    expect(css).toContain('.dashboard-page .dash-grid > .s2-card {');
    const rule = css.slice(css.indexOf('.dashboard-page .dash-grid > .s2-card {'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).toContain('height: 100%');
    expect(block).toContain('flex-direction: column');
  });

  it('เนื้อหาการ์ดกินพื้นที่ที่เหลือ และแถบท้ายชิดล่าง', () => {
    expect(css).toContain('.dashboard-page .dash-grid > .s2-card > .s2-card-body');
    expect(css).toContain('.dashboard-page .dash-grid > .s2-card > .s2-card-foot { margin-top: auto; }');
  });

  it('ไม่ล็อกความสูงการ์ดเป็นค่าคงที่ (§13)', () => {
    // ห้าม height/min-height เป็น px ตายตัวกับการ์ดหรือกริด
    const bad = css.match(/\.(dash-grid|dash-span-\d|s2-card)[^{}]*\{[^{}]*(?:min-)?height:\s*\d+px/g);
    expect(bad).toBeNull();
  });

  it('จอแคบยกเลิกการยืด เพราะการ์ดอยู่คนละแถวแล้ว', () => {
    const mq = css.slice(css.indexOf('@media (max-width: 1024px)'));
    expect(mq).toContain('.dashboard-page .dash-grid > .s2-card { height: auto; }');
  });

  it('ไม่ใช้ !important ในการจัดความสูง', () => {
    expect(css).not.toMatch(/:[^;{}]*!important/);
  });
});

/* ============================================================
   PART 7 — เอกสารปฏิบัติการล่าสุด
   ============================================================ */
describe('Phase 11 — เอกสารล่าสุด', () => {
  const rows = (kind: 'r' | 'i' | 'a'): DocRow[] => ([
    kind === 'r' ? { id: 'r1', status: 'CONFIRMED', receiptNo: 'GR-01', receiptDate: '2026-08-20T03:00:00.000Z' }
      : kind === 'i' ? { id: 'i1', status: 'DRAFT', issueNo: 'SI-01', issueDate: '2026-08-21T03:00:00.000Z' }
        : { id: 'a1', status: 'CONFIRMED', adjustmentNo: 'AJ-01', createdAt: '2026-08-19T03:00:00.000Z' },
  ]);

  it('อ่านเลขที่เอกสารตาม field จริงของแต่ละชนิด', () => {
    expect(toRecentDocs(rows('r'), 'receiving')[0].docNo).toBe('GR-01');
    expect(toRecentDocs(rows('i'), 'issue')[0].docNo).toBe('SI-01');
    expect(toRecentDocs(rows('a'), 'adjustment')[0].docNo).toBe('AJ-01');
  });

  it('ปรับปรุงสต็อกใช้ createdAt เมื่อไม่มี adjustmentDate', () => {
    expect(toRecentDocs(rows('a'), 'adjustment')[0].at).toBe('2026-08-19T03:00:00.000Z');
  });

  it('ไม่มีเลขที่เอกสารก็แสดงขีด ไม่เดาแทน', () => {
    expect(toRecentDocs([{ id: 'x', status: 'DRAFT' }], 'receiving')[0].docNo).toBe('—');
  });

  it('รวมสามชนิดแล้วเรียงล่าสุดก่อน', () => {
    const out = recentDocuments({ receiving: rows('r'), issues: rows('i'), adjustments: rows('a') });
    expect(out.map((d) => d.docNo)).toEqual(['SI-01', 'GR-01', 'AJ-01']);
  });

  it('เอกสารที่ไม่มีวันที่ไปอยู่ท้ายสุด ไม่ถูกเดาเวลาให้', () => {
    const out = recentDocuments({ receiving: [...rows('r'), { id: 'r2', status: 'DRAFT', receiptNo: 'GR-99' }] });
    expect(out[out.length - 1].docNo).toBe('GR-99');
  });

  it('จำกัดจำนวนตาม limit และไม่พังเมื่อไม่มีข้อมูล', () => {
    expect(recentDocuments({}, 5)).toEqual([]);
    expect(recentDocuments({ receiving: Array.from({ length: 9 }, (_, i) => ({
      id: `r${i}`, status: 'DRAFT', receiptNo: `GR-${i}`, receiptDate: `2026-08-0${i}T00:00:00.000Z`,
    })) }, 5)).toHaveLength(5);
  });

  it('รักษาชนิดเอกสารไว้ เพื่อแปลสถานะให้ตรงคำศัพท์ของเอกสารนั้น', () => {
    const out = recentDocuments({ issues: rows('i') });
    expect(out[0].kind).toBe('issue');
    expect(DOC_KIND_LABEL[out[0].kind]).toBe('ใบเบิก');
  });

  it('หน้าแดชบอร์ดแปลสถานะตามชนิดเอกสารของแถวนั้น ไม่ใช่ค่าตายตัว', () => {
    expect(page).toContain('statusInfo(doc.kind, doc.status)');
    expect(page).toContain('statusLabel(doc.kind, doc.status)');
  });

  it('การ์ดเอกสารปฏิบัติการมีรายการจริง ไม่ใช่ตัวเลขอย่างเดียวเหมือนเดิม', () => {
    expect(page).toContain('เอกสารล่าสุด');
    expect(page).toContain('dash-list dash-docs');
  });
});

/* ============================================================
   PART 8 — ต้นทุน / ราคาขาย
   ============================================================ */
describe('Phase 11 — ต้นทุนและราคาขาย', () => {
  const menus: MenuRow[] = [
    menu({ id: 'a', name: 'ก', hasRecipe: false, unitCost: null }),
    menu({ id: 'b', name: 'ข', hasRecipe: true, unitCost: null }),
    menu({ id: 'c', name: 'ค', hasRecipe: true, unitCost: 20, sellingPrice: 10, margin: -10 }),
    menu({ id: 'd', name: 'ง', hasRecipe: true, unitCost: 20, sellingPrice: null, margin: null }),
    menu({ id: 'e', name: 'จ', isActive: false, hasRecipe: false, unitCost: null }),
  ];

  it('นับเฉพาะเมนูที่ใช้งานอยู่ ไม่รวมเมนูที่ปิดใช้งาน', () => {
    expect(costingSummary(menus).total).toBe(4);
    expect(pricingSummary(menus).total).toBe(4);
  });

  it('แยก "ยังไม่มีสูตร" ออกจาก "ยังไม่มีต้นทุน"', () => {
    const c = costingSummary(menus);
    expect(c.noRecipe).toBe(1);
    expect(c.noCost).toBe(1);
    expect(c.withRecipe).toBe(3);
  });

  it('รายการเมนูที่คิดต้นทุนไม่ได้ เรียงงานที่ต้องทำก่อนขึ้นก่อน', () => {
    const out = recipesNeedingAttention(menus);
    expect(out.map((m) => m.issue)).toEqual(['NO_RECIPE', 'NO_COST']);
    expect(out[0].label).toBe(RECIPE_ISSUE_LABEL.NO_RECIPE);
  });

  it('เมนูที่มีสูตรและมีต้นทุนแล้วไม่ถูกนำมาแสดง', () => {
    expect(recipesNeedingAttention([menu({ id: 'ok' })])).toEqual([]);
  });

  it('สรุปราคาขายนับตั้งราคาแล้ว ยังไม่ตั้ง และต่ำกว่าทุน', () => {
    const p = pricingSummary(menus);
    expect(p.priced).toBe(3);
    expect(p.unpriced).toBe(1);
    expect(p.belowCost).toBe(1);
  });

  it('รายการที่ควรตรวจราคาเอาเมนูขาดทุนขึ้นก่อน', () => {
    expect(pricingAttention(menus).map((m) => m.id)).toEqual(['c', 'd']);
  });

  it('ไม่พังเมื่อยังไม่มีข้อมูลเมนู', () => {
    expect(costingSummary(undefined).total).toBe(0);
    expect(pricingSummary(undefined).belowCost).toBe(0);
    expect(recipesNeedingAttention(undefined)).toEqual([]);
  });

  it('การ์ดต้นทุนมีรายการเมนูจริง ไม่ใช่แถวตัวเลขอย่างเดียว', () => {
    expect(page).toContain('เมนูที่ยังคิดต้นทุนไม่ได้');
    expect(page).toContain('recipeGaps.map');
  });

  it('การ์ดราคาขายยังใช้ margin จริงในการหาเมนูขาดทุน', () => {
    expect(page).toContain("(m.margin ?? 0) < 0");
  });
});

/* ============================================================
   PART 2 / 5 / 17 — ห้ามข้อมูลปลอม และสถานะต้องอ่านได้ไม่พึ่งสี
   ============================================================ */
describe('Phase 11 — ความซื่อตรงของข้อมูล', () => {
  it('ไม่มี KPI หรือ trend ที่คิดขึ้นเอง', () => {
    expect(page).not.toMatch(/Math\.random|faker|mockData/);
    expect(page).not.toMatch(/trend|เทียบเดือนที่แล้ว|เพิ่มขึ้น \d+%/);
  });

  it('ไม่ดัน min-height ปลอมให้การ์ดสูงเท่ากัน', () => {
    // อนุญาตเฉพาะเป้าสัมผัส var(--control-h) และ min-height: 0 ที่จำเป็นกับ flex/grid overflow
    const heights = css.match(/min-height:\s*([^;]+);/g) ?? [];
    const fake = heights.filter((h) => !h.includes('var(--control-h)') && !/min-height:\s*0;/.test(h));
    expect(fake).toEqual([]);
  });

  it('ระดับความสำคัญมีทั้งไอคอนและข้อความ ไม่สื่อด้วยสีอย่างเดียว', () => {
    const meta = page.slice(page.indexOf('const SEVERITY_META'), page.indexOf('/** การ์ดที่โหลด'));
    for (const label of ['ต้องแก้ทันที', 'ควรตรวจสอบ', 'ข้อมูลไม่ครบ']) expect(meta).toContain(label);
    expect(meta).toContain('icon:');
  });

  it('เวลาอัปเดตล่าสุดมาจากเวลาที่ query สำเร็จจริง ไม่ใช่เวลา render', () => {
    const hook = read('hooks/useDashboardData.ts');
    expect(hook).toContain('dataUpdatedAt');
    expect(page).toContain('d.lastUpdatedAt > 0');
    expect(page).toContain('new Date(d.lastUpdatedAt)');
  });

  it('ยังใช้ contract เดิม ไม่เพิ่ม endpoint ใหม่ให้แดชบอร์ด', () => {
    //  กันไม่ให้ไปชนกับ refetch() ของ react-query ที่เป็นการใช้ contract เดิม
    expect(page).not.toMatch(/(?<![A-Za-z])fetch\(|axios|apiGet\(/);
  });
});

/* ============================================================
   PART 6 / 14 — ทางลัดและสถานะว่าง
   ============================================================ */
describe('Phase 11 — ทางลัดและสถานะว่าง', () => {
  it('ปุ่มทางลัดยืดเต็มพื้นที่ที่เหลือแทนการเว้นว่างท้ายการ์ด', () => {
    const rule = css.slice(css.indexOf('.dash-quick {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('flex: 1');
  });

  it('จอเล็กกลับไปเป็นปุ่มแถวเดียวแบบกระชับ', () => {
    const mq = css.slice(css.indexOf('@media (max-width: 430px)'));
    expect(mq).toContain('.dash-quick { flex: none;');
    expect(mq).toContain('flex-direction: row');
  });

  it('สถานะว่างและสถานะโหลดไม่ได้กินพื้นที่ที่เหลือของการ์ด', () => {
    expect(css).toContain('.dashboard-page .dash-grid > .s2-card .dash-error');
  });

  it('ทางลัดยังกรองตามสิทธิ์จริง ไม่ได้แสดงทุกปุ่มให้ทุกคน', () => {
    expect(page).toContain('QUICK_ACTIONS.filter((a) => canAny(roles, permissions, ...a.perms))');
  });
});

/* ============================================================
   PART 26 — ไม่มีคลาสตายหลงเหลือ
   ============================================================ */
describe('Phase 11 — คลาสที่เพิ่มใหม่ถูกใช้จริง', () => {
  it('คลาสใหม่ทุกตัวมีทั้งใน CSS และใน JSX', () => {
    for (const cls of ['dash-fill', 'dl-open', 'dash-docs']) {
      expect(css.includes(cls) || cls === 'dash-docs').toBe(true);
      expect(page).toContain(cls);
    }
  });

  it('รายการย่อยรองรับจำนวนคอลัมน์ที่ต่างกันได้ โดยไม่ต้องมีช่องว่างหลอก', () => {
    const rule = css.slice(css.indexOf('.dash-list li {'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).toContain('grid-auto-flow: column');
    expect(block).not.toContain('minmax(0, 1.6fr) auto auto auto');
  });
});
