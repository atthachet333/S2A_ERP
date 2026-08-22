import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  barPercent, barsAreEmpty, documentBars, donutArcs, hasDistribution,
  inventoryComposition, menuReadiness, sliceTotal,
} from '@/lib/dashboard-charts';
import { companyContactRows, type CompanyProfile } from '@/hooks/useCompanyProfile';
import type { MenuRow } from '@/lib/catalog';
import type { InventoryKpi } from '@/hooks/useDashboardData';

/**
 * PHASE 14 — กราฟบนแดชบอร์ดต้องมาจากข้อมูลจริงเท่านั้น
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const chartsLib = read('lib/dashboard-charts.ts');
const page = read('pages/DashboardPage.tsx');
const pageCode = code('pages/DashboardPage.tsx');
const css = read('styles/dashboard.css');

const kpi = (over: Partial<InventoryKpi> = {}): InventoryKpi => ({
  itemCount: 80, totalValue: 2078.9, lowCount: 0, outCount: 0, negativeCount: 0,
  movementsToday: 0, thresholdMissing: true, ...over,
});

const menu = (over: Partial<MenuRow>): MenuRow => ({
  id: 'm', code: 'MENU-1', name: 'เมนู', imageUrl: null, category: null, sellingUnit: 'BAG',
  isActive: true, recipeId: 'r', hasRecipe: true, unitCost: 25.5, sellingPrice: 40, margin: 36, ...over,
});

/* ============================================================
   ห้ามสร้าง trend ปลอม
   ============================================================ */
describe('PHASE 14 — ห้ามมีกราฟแนวโน้มที่ไม่มีข้อมูลจริงรองรับ', () => {
  it('ไม่มีฟังก์ชันอนุกรมเวลา/sparkline ในไลบรารีกราฟ', () => {
    const body = chartsLib.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/sparkline|trend|timeSeries|forecast/i);
  });

  it('ไม่มีการสุ่มหรือ mock ข้อมูลกราฟ', () => {
    expect(chartsLib).not.toMatch(/Math\.random|faker|mockData|sampleData/);
    expect(pageCode).not.toMatch(/Math\.random|faker|mockData/);
  });

  it('แดชบอร์ดไม่เพิ่ม endpoint ใหม่สำหรับกราฟ — ใช้ข้อมูลที่โหลดอยู่แล้ว', () => {
    expect(pageCode).toContain('inventoryComposition(invKpi)');
    expect(pageCode).toContain('menuReadiness(menus)');
    expect(pageCode).toContain('documentBars({');
  });
});

/* ============================================================
   องค์ประกอบสต็อก
   ============================================================ */
describe('PHASE 14 — กราฟสถานะสต็อก', () => {
  it('นับจาก KPI จริง และรวมกันได้เท่าจำนวนรายการทั้งหมด', () => {
    const slices = inventoryComposition(kpi({ itemCount: 100, lowCount: 6, outCount: 2, negativeCount: 2 }));
    expect(sliceTotal(slices)).toBe(100);
    expect(slices.find((s) => s.key === 'ok')?.value).toBe(90);
  });

  it('ตัดชิ้นที่เป็นศูนย์ทิ้ง ไม่ให้ legend รก', () => {
    const slices = inventoryComposition(kpi());
    expect(slices.map((s) => s.key)).toEqual(['ok']);
  });

  it('ไม่มี KPI → ไม่มีกราฟ (ไม่เดาค่า)', () => {
    expect(inventoryComposition(undefined)).toEqual([]);
  });

  it('ค่าติดลบผิดปกติไม่ทำให้ชิ้น "ปกติ" ติดลบ', () => {
    const slices = inventoryComposition(kpi({ itemCount: 2, lowCount: 5 }));
    expect(slices.find((s) => s.key === 'ok')).toBeUndefined();
  });
});

/* ============================================================
   ความพร้อมของเมนู
   ============================================================ */
describe('PHASE 14 — กราฟความพร้อมเมนู', () => {
  const menus = [
    menu({ id: 'a' }),
    menu({ id: 'b', sellingPrice: null, margin: null }),
    menu({ id: 'c', unitCost: null, sellingPrice: null }),
    menu({ id: 'd', hasRecipe: false, unitCost: null, sellingPrice: null }),
    menu({ id: 'e', isActive: false }),
  ];

  it('แบ่งตามงานที่ต้องทำจริง และไม่นับเมนูที่ปิดใช้งาน', () => {
    const s = menuReadiness(menus);
    expect(sliceTotal(s)).toBe(4);
    expect(s.find((x) => x.key === 'ready')?.value).toBe(1);
    expect(s.find((x) => x.key === 'noPrice')?.value).toBe(1);
    expect(s.find((x) => x.key === 'noCost')?.value).toBe(1);
    expect(s.find((x) => x.key === 'noRecipe')?.value).toBe(1);
  });

  it('ไม่มีเมนู → ไม่มีกราฟ', () => {
    expect(menuReadiness([])).toEqual([]);
    expect(menuReadiness(undefined)).toEqual([]);
  });
});

/* ============================================================
   แท่งเอกสาร
   ============================================================ */
describe('PHASE 14 — กราฟแท่งเอกสาร', () => {
  it('แยกร่างกับที่ยืนยันแล้วจากสถานะจริง', () => {
    const bars = documentBars({
      receiving: [{ id: '1', status: 'CONFIRMED' }, { id: '2', status: 'DRAFT' }],
      issues: [], adjustments: undefined,
    });
    expect(bars.find((b) => b.key === 'receiving')).toMatchObject({ draft: 1, confirmed: 1, total: 2 });
    expect(bars.find((b) => b.key === 'issue')).toMatchObject({ draft: 0, confirmed: 0, total: 0 });
    expect(bars.find((b) => b.key === 'adjustment')?.total).toBe(0);
  });

  it('ความยาวแท่งคิดจากค่าสูงสุดจริง และไม่มีข้อมูลคืน 0', () => {
    expect(barPercent(1, 2)).toBe(50);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(0, 10)).toBe(0);
  });
});

/* ============================================================
   เส้นโค้งโดนัท
   ============================================================ */
describe('PHASE 14 — การวาดโดนัท', () => {
  it('สัดส่วนรวมกันได้ 100%', () => {
    const arcs = donutArcs([
      { key: 'a', label: 'A', value: 3, tone: 'ok' },
      { key: 'b', label: 'B', value: 1, tone: 'bad' },
    ]);
    expect(arcs.map((a) => a.percent)).toEqual([75, 25]);
    expect(arcs.every((a) => a.path.startsWith('M '))).toBe(true);
  });

  it('ชิ้นเดียว 100% ยังวาดเป็นวงแหวนได้ (ไม่ใช่ arc 360 องศาที่วาดไม่ได้)', () => {
    const arcs = donutArcs([{ key: 'a', label: 'A', value: 5, tone: 'ok' }]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].percent).toBe(100);
    expect(arcs[0].path).toMatch(/^M [\d.]+ [\d.]+ A /);
  });

  it('ไม่มีข้อมูลก็ไม่วาด', () => {
    expect(donutArcs([])).toEqual([]);
    expect(donutArcs([{ key: 'a', label: 'A', value: 0, tone: 'ok' }])).toEqual([]);
  });
});

/* ============================================================
   สี / การเข้าถึง / เลย์เอาต์
   ============================================================ */
describe('PHASE 14 — การแสดงผลกราฟ', () => {
  const charts = read('components/dashboard/Charts.tsx');

  it('ทุกชิ้นมีตัวเลขและป้ายข้อความ ไม่ได้สื่อด้วยสีอย่างเดียว', () => {
    expect(charts).toContain('lg-name');
    expect(charts).toContain('{a.value}');
    expect(charts).toContain('{a.percent}%');
    expect(charts).toContain('<title>');       // tooltip ในตัว SVG
  });

  it('ไม่ hardcode ค่าสีในคอมโพเนนต์กราฟ', () => {
    expect(charts).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(charts).not.toMatch(/rgb\(/);
  });

  it('สีกราฟมาจาก token ทั้งหมด', () => {
    const block = css.slice(css.indexOf('.tone-ok'));
    for (const t of ['--success', '--warning', '--danger', '--blue']) expect(block).toContain(`var(${t})`);
  });

  it('การ์ดข้อมูลบริษัทกินเต็มแถว จึงไม่กระทบการจับคู่ความสูงเดิม', () => {
    expect(css).toContain('.dash-span-12 { grid-column: span 12; }');
    expect(page).toContain('className="dash-span-12 dash-company"');
  });

  it('มีกฎ responsive ของกราฟบนจอแคบ', () => {
    const mq = css.slice(css.lastIndexOf('@media (max-width: 430px)'));
    expect(mq).toContain('.dash-donut');
    expect(mq).toContain('.dash-bars li');
  });
});

/* ============================================================
   การ์ดข้อมูลบริษัท
   ============================================================ */
describe('PHASE 14 — ข้อมูลบริษัทบนแดชบอร์ด', () => {
  const full: CompanyProfile = {
    id: 'c', code: 'X', nameTh: 'บริษัท ทดสอบ จำกัด', nameEn: 'TEST CO.',
    taxId: '123', phone: '02-000-0000', email: 'a@b.c', lineId: '@test', website: 'https://x.y',
    address: 'ที่อยู่\nบรรทัดสอง',
  };

  it('แสดงเฉพาะช่องที่มีค่าจริง', () => {
    const rows = companyContactRows(full);
    expect(rows.map((r) => r.label)).toEqual(['ชื่ออังกฤษ', 'เลขผู้เสียภาษี', 'โทรศัพท์', 'อีเมล', 'LINE', 'เว็บไซต์', 'ที่อยู่']);
  });

  it('ช่องที่เป็น null จะไม่ขึ้นเลย', () => {
    const rows = companyContactRows({ ...full, phone: null, lineId: null, website: null, nameEn: null });
    expect(rows.map((r) => r.label)).toEqual(['เลขผู้เสียภาษี', 'อีเมล', 'ที่อยู่']);
  });

  it('ที่อยู่หลายบรรทัดถูกรวบเป็นบรรทัดเดียว', () => {
    expect(companyContactRows(full).find((r) => r.label === 'ที่อยู่')?.value).toBe('ที่อยู่ บรรทัดสอง');
  });

  it('ไม่มีข้อมูลบริษัท → ไม่มีแถว', () => {
    expect(companyContactRows(undefined)).toEqual([]);
  });

  it('ใช้ endpoint เดียวกับที่เอกสารใช้ ไม่สร้างแหล่งใหม่', () => {
    expect(read('hooks/useCompanyProfile.ts')).toContain("'/business/company'");
  });
});

/* ============================================================
   PHASE 14B — สถานะข้อมูลน้อย / ยังไม่มีข้อมูล
   production จริงมี 0 ออเดอร์ 0 ใบเบิก 0 ใบปรับปรุง และสต็อกปกติทั้งหมด
   ============================================================ */
describe('PHASE 14B — ข้อมูลน้อยต้องไม่แสดงกราฟที่ทำให้เข้าใจผิด', () => {
  const charts = read('components/dashboard/Charts.tsx');

  it('มีกลุ่มเดียว = ไม่มีการกระจายตัว จึงไม่ควรวาดโดนัท', () => {
    // ของจริง: สินค้า 80 ชิ้น สถานะปกติทั้งหมด
    const slices = inventoryComposition(kpi({ itemCount: 80 }));
    expect(slices).toHaveLength(1);
    expect(hasDistribution(slices)).toBe(false);
  });

  it('สองกลุ่มขึ้นไปถึงจะวาดโดนัท', () => {
    expect(hasDistribution(inventoryComposition(kpi({ itemCount: 80, lowCount: 6 })))).toBe(true);
  });

  it('ไม่มีข้อมูลเลย → ไม่มีการกระจายตัว', () => {
    expect(hasDistribution([])).toBe(false);
    expect(hasDistribution(inventoryComposition(undefined))).toBe(false);
  });

  it('คอมโพเนนต์แสดงข้อความพร้อมจำนวนจริงแทนวงกลม 100%', () => {
    expect(charts).toContain('!hasDistribution(slices)');
    expect(charts).toContain('ยังไม่มีข้อมูลเพียงพอสำหรับการเปรียบเทียบ');
    expect(charts).toContain('{only.value}');   // ต้องมีจำนวนจริงกำกับ
  });

  it('ยังไม่มีเอกสารสักใบ → แสดงสถานะว่าง ไม่ใช่แท่งเปล่า', () => {
    const bars = documentBars({ receiving: [], issues: [], adjustments: [] });
    expect(barsAreEmpty(bars)).toBe(true);
    expect(charts).toContain('barsAreEmpty(bars)');
    expect(charts).toContain('ยังไม่มีเอกสารปฏิบัติการในระบบ');
  });

  it('มีเอกสารแม้ใบเดียวก็ยังวาดแท่งตามปกติ', () => {
    const bars = documentBars({ receiving: [{ id: '1', status: 'CONFIRMED' }] });
    expect(barsAreEmpty(bars)).toBe(false);
  });

  it('สถานะข้อมูลน้อยมีสไตล์รองรับ', () => {
    expect(css).toContain('.dash-lowdata');
  });
});
