import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PHASE 10 — WHOLE-SYSTEM CONSISTENCY
 *
 * เทสต์ชุดนี้เป็น regression guard ของ "ความสม่ำเสมอ" ไม่ใช่ snapshot ทั้ง DOM
 * ทุกข้อมาจากสิ่งที่วัดได้จริงในเบราว์เซอร์ระหว่างรอบนี้
 */

const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const readDir = (p: string) => fs.readdirSync(path.join(SRC, p));

const tokens = read('styles/tokens.css');
const pagePattern = read('styles/page-pattern.css');
const consistency = read('styles/consistency.css');
const indexCss = read('index.css');
const workspaceCss = read('styles/workspace.css');
const main = read('main.tsx');

/** ไฟล์หน้าจอทั้งหมดที่ผ่านการ redesign แล้ว */
const REDESIGNED_PAGES = [
  'pages/DashboardPage.tsx',
  'pages/InventoryPages.tsx',
  'pages/OperationsPages.tsx',
  'pages/OperationDetailPages.tsx',
  'pages/UsersPage.tsx',
  'pages/AdminPermissionsPage.tsx',
  'pages/ActivityPage.tsx',
  'pages/RegistrationsPage.tsx',
  'pages/ProfilePage.tsx',
  'pages/catalog/ItemListWorkspace.tsx',
  'pages/catalog/ItemFormWorkspace.tsx',
  'pages/catalog/CatalogMastersPage.tsx',
  'pages/catalog/PartnerMastersPage.tsx',
  'pages/catalog/UnitConversionsPage.tsx',
  'pages/catalog/CostingWorkspacePage.tsx',
  'pages/catalog/PricingWorkspacePage.tsx',
  'pages/orders/OrdersListPage.tsx',
  'pages/orders/OrderWorkspacePage.tsx',
  'pages/orders/OrderDetailPage.tsx',
  'pages/orders/CustomersPage.tsx',
];
const pageSources = REDESIGNED_PAGES.map((p) => [p, read(p)] as const);

describe('PART 2–3 — โครงหน้าใช้ primitive เดียวกัน', () => {
  it('1 ทุกหน้าที่ redesign แล้วใช้ PageContainer + PageHeader', () => {
    for (const [name, src] of pageSources) {
      expect(src, name).toContain('<PageContainer');
      expect(src, name).toContain('<PageHeader');
    }
  });

  it('2 ไม่มีหน้าไหนกำหนดความกว้างเอง — ใช้ token ผ่าน PageContainer เท่านั้น', () => {
    for (const [name, src] of pageSources) {
      expect(src, name).not.toMatch(/maxWidth:\s*['"]?\d{3,4}/);
      expect(src, name).not.toMatch(/max-width:\s*\d{3,4}px/);
    }
  });

  it('3 ความกว้างหน้ามีแค่สามค่าและมาจาก token', () => {
    expect(tokens).toContain('--page-wide:');
    expect(tokens).toContain('--page-default:');
    expect(tokens).toContain('--page-narrow:');
    expect(pagePattern).toContain('.s2-page--wide { max-width: var(--page-wide); }');
    expect(pagePattern).toContain('.s2-page--default { max-width: var(--page-default); }');
    expect(pagePattern).toContain('.s2-page--narrow { max-width: var(--page-narrow); }');
  });

  it('4 ค่า size ของ PageContainer ต้องเป็นค่าที่รองรับจริงเท่านั้น', () => {
    for (const [name, src] of pageSources) {
      for (const m of src.matchAll(/<PageContainer[^>]*size="([^"]+)"/g)) {
        expect(['wide', 'default', 'narrow'], `${name}: ${m[1]}`).toContain(m[1]);
      }
    }
  });
});

describe('PART 4–5 — การ์ดและ KPI', () => {
  it('5 ระยะขอบการ์ดมาจาก token เดียว', () => {
    expect(tokens).toContain('--card-pad:');
    expect(pagePattern).toContain('var(--card-pad)');
  });

  it('6 ทุกหน้าที่มี KPI ใช้ KPIGrid/KPICard ไม่ทำการ์ดเอง', () => {
    const withKpi = pageSources.filter(([, src]) => src.includes('<KPIGrid'));
    expect(withKpi.length).toBeGreaterThanOrEqual(8);
    for (const [name, src] of withKpi) {
      expect(src, name).toContain('<KPICard');
    }
  });

  it('7 KPI grid ที่เขียนเองในหน้าเก่า ถูกลบออกจาก CSS แล้ว', () => {
    for (const dead of ['.user-admin-kpis', '.order-kpis']) {
      expect(indexCss, dead).not.toContain(dead);
      expect(workspaceCss, dead).not.toContain(dead);
    }
  });

  it('8 ตัวเลขเรียงหลักตรงกันทั้งระบบ', () => {
    expect(consistency).toContain('font-variant-numeric: tabular-nums');
    expect(consistency).toMatch(/\.num,[\s\S]*\.s2-kpi-value/);
  });
});

describe('PART 5 — การจัดรูปแบบเงิน', () => {
  it('9 ไม่มีการเติม ฿ ซ้ำหน้า formatMoney (ซึ่งใส่ ฿ ให้อยู่แล้ว)', () => {
    for (const [name, src] of pageSources) {
      expect(src, name).not.toMatch(/฿\$\{formatMoney/);
      expect(src, name).not.toMatch(/`฿\$\{formatMoney/);
    }
  });

  it('10 Decimal ที่มาเป็น string ต้องแปลงก่อนจัดรูปแบบ', () => {
    const dash = read('pages/DashboardPage.tsx');
    expect(dash).toContain('formatMoney(Number(o.totalAmount ?? 0), 2)');
    // formatMoney รับ number เท่านั้น — ส่ง string เข้าไปจะได้ 1250.5000
    expect(read('lib/utils.ts')).toContain('export function formatMoney(value?: number | null');
  });
});

describe('PART 7–8 — คอนโทรลและปุ่ม', () => {
  it('11 ความสูงคอนโทรลมาจาก token เดียว', () => {
    expect(tokens).toContain('--control-h: 44px');
  });

  it('12 คอนโทรลที่วัดแล้วต่ำกว่า 44px ถูกยกให้ถึงเกณฑ์บนอุปกรณ์สัมผัส', () => {
    const block = consistency.slice(consistency.indexOf('@media (max-width: 1024px)'));
    for (const sel of [
      '.rb-sectionnav-chips button',
      '.existing-unit-browser button',
      '.pg-btn',
      '.rb2 .s2a-combo-search input',
      '.icon-btn',
      '.rb2 .conv-toggle',
    ]) {
      expect(block, sel).toContain(sel);
    }
    expect(block.match(/var\(--control-h\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('13 ไฟล์ consistency โหลดท้ายสุดเพื่อไม่ต้องใช้ !important', () => {
    const order = ['tokens.css', 'index.css', 'page-pattern.css', 'consistency.css'];
    const positions = order.map((f) => main.indexOf(`styles/${f}`) >= 0 ? main.indexOf(`styles/${f}`) : main.indexOf(f));
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i], order[i]).toBeGreaterThan(positions[i - 1]);
    }
    // ตรวจการประกาศจริง ไม่ใช่คำที่ปรากฏในคอมเมนต์อธิบาย
    expect(consistency).not.toMatch(/:[^;{}]*!important/);
  });
});

describe('PART 9 — สถานะใช้คำศัพท์กลาง', () => {
  it('14 ไม่มีหน้าไหน map สถานะเอกสารเอง', () => {
    for (const [name, src] of pageSources) {
      // สถานะเอกสาร (ร่าง/ยืนยันแล้ว/กลับรายการ) ต้องมาจาก operations-vocab เท่านั้น
      expect(src, name).not.toContain("=== 'DRAFT' ? 'ร่าง'");
      expect(src, name).not.toContain("statusTh");
    }
    // ข้อยกเว้นที่ตั้งใจ: STATUS_TH ใน InventoryPages เป็นสถานะ "ระดับสต็อก"
    // (มีสต็อก/ใกล้หมด/หมด/ติดลบ) ซึ่งไม่ใช่สถานะเอกสาร และไม่มีใน vocab กลาง
    const inv = read('pages/InventoryPages.tsx');
    expect(inv).toContain('IN_STOCK');
    expect(inv).toContain("statusInfo('adjustment'");
  });

  it('15 สถานะทุกชนิดมาจาก vocab กลางไม่กี่ไฟล์', () => {
    const vocabFiles = readDir('lib').filter((f) => f.endsWith('-vocab.ts'));
    expect(vocabFiles.sort()).toEqual(['admin-vocab.ts', 'operations-vocab.ts', 'order-vocab.ts']);
    // order-vocab ต้อง re-export จาก operations-vocab ไม่ประกาศตารางสถานะซ้ำ
    expect(read('lib/order-vocab.ts')).toContain("from '@/lib/operations-vocab'");
  });
});

describe('PART 21 — ตารางกลายเป็นการ์ดบนมือถือ', () => {
  const masterData = read('styles/master-data.css');

  it('16 กฎ card mode ครอบทุกกลุ่มหน้าที่ใช้ .md-table', () => {
    const block = masterData.slice(masterData.indexOf('@media (max-width: 760px)'));
    for (const scope of ['.master-page .md-table', '.order-page .md-table', '.admin-page .md-table']) {
      expect(block, scope).toContain(scope);
    }
  });

  it('17 ทุกตารางที่กลายเป็นการ์ดต้องมี data-label ครบทุกช่อง', () => {
    // นับ <td ที่ไม่มี data-label ในหน้าที่ใช้ md-table
    for (const [name, src] of pageSources.filter(([, s]) => s.includes('md-table'))) {
      const tds = [...src.matchAll(/<td(\s[^>]*)?>/g)].map((m) => m[0]);
      const missing = tds.filter((t) => !t.includes('data-label'));
      expect(missing.length, `${name} มี td ที่ไม่มี data-label: ${missing.slice(0, 3).join(' ')}`).toBe(0);
    }
  });

  it('18 ไม่ใช้ nth-child ระบุความหมายของช่องในโหมดการ์ด', () => {
    const cardBlock = masterData.slice(masterData.indexOf('@media (max-width: 760px)'));
    // อนุญาตเฉพาะ first-child / nth-child(2) ที่ใช้จัด layout หัวการ์ด ไม่ใช่ผูกความหมายข้อมูล
    const hits = [...cardBlock.matchAll(/nth-child\((\d+)\)/g)].map((m) => Number(m[1]));
    expect(hits.every((n) => n <= 2)).toBe(true);
  });
});

describe('PART 12 — modal / z-index', () => {
  it('19 z-index ทุกชั้นมาจากสเกลกลาง', () => {
    for (const t of ['--z-sticky', '--z-header', '--z-dropdown', '--z-drawer', '--z-modal', '--z-portal', '--z-toast']) {
      expect(tokens, t).toContain(t);
    }
  });

  it('20 modal กลางมี aria ครบและคืนโฟกัส', () => {
    const modal = read('components/ui/MasterModal.tsx');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('aria-labelledby={titleId}');
    expect(modal).toContain('opener?.focus?.()');
    expect(modal).toContain("document.body.style.overflow = 'hidden'");
  });

  it('21 ไม่มีหน้าไหนตั้ง z-index เป็นตัวเลขดิบ', () => {
    for (const f of readDir('styles').filter((x) => x.endsWith('.css'))) {
      const css = read(`styles/${f}`);
      const raw = [...css.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
      // อนุญาตเฉพาะเลขชั้นภายในคอมโพเนนต์ (0-2) นอกนั้นต้องอ้าง token จากสเกลกลาง
      expect(raw.every((n) => n <= 2), `${f}: ${raw.join(',')}`).toBe(true);
    }
  });
});

describe('PART 24 — legacy CSS ที่ตายแล้ว', () => {
  it('22 คลาสของหน้าเก่าที่ migrate ไปแล้ว ไม่เหลือใน CSS', () => {
    const dead = [
      'units-hero', 'units-toolbar', 'units-stat',
      'business-row', 'business-table', 'business-page',
      'customer-grid', 'table-action',
      'user-form-dialog', 'user-detail-drawer', 'admin-modal-backdrop',
      'ops-hero', 'ops-section', 'inv-drawer', 'mv-pill',
    ];
    for (const c of dead) {
      expect(indexCss, `index.css: .${c}`).not.toContain(`.${c}`);
      expect(workspaceCss, `workspace.css: .${c}`).not.toContain(`.${c}`);
    }
  });

  it('23 คลาสที่ยังมีผู้ใช้จริง ต้องไม่ถูกลบไปด้วย', () => {
    // fcx-hero ยังใช้ในหน้า /catalog และ /sales ที่ยังไม่อยู่ใน scope redesign
    for (const c of ['command-kpis', 'stat-card', 'credential-dialog', 'items-surface', 'item-visual-card', 'fcx-hero']) {
      const found = indexCss.includes(`.${c}`) || workspaceCss.includes(`.${c}`);
      expect(found, c).toBe(true);
    }
  });
});

describe('PART 25 — inline style', () => {
  it('24 หน้าที่ redesign แล้วเหลือเฉพาะ inline style ที่คำนวณตอนรัน', () => {
    // ความกว้างแถบสัดส่วน (เช่น width: `${share}%`) ต้องเป็น inline จริง ๆ
    const RUNTIME = /style=\{\{\s*width:\s*`\$\{/;
    for (const [name, src] of pageSources) {
      const all = [...src.matchAll(/style=\{\{[^\r\n]*/g)].map((m) => m[0]);
      const staticOnes = all.filter((x) => !RUNTIME.test(x));
      expect(staticOnes.length, `${name}: ${staticOnes.slice(0, 2).join(' | ')}`).toBe(0);
    }
  });

  it('25 inline style ที่เหลือใน component กลาง ต้องเป็นค่าที่คำนวณตอนรัน', () => {
    // Skeleton คำนวณความกว้างต่อบรรทัด จึงต้องเป็น inline จริง ๆ
    const skeleton = read('components/ui/Skeleton.tsx');
    expect(skeleton).toMatch(/style=\{\{[^}]*width:\s*c ===/);
    const pageIdx = read('components/layout/page/index.tsx');
    expect(pageIdx).toMatch(/style=\{\{[^}]*width:\s*i ===/);
  });
});

describe('PART 26 — โครงแดชบอร์ด', () => {
  const dashCss = read('styles/dashboard.css');

  /* เดิมข้อนี้ยืนยันว่า Phase 10 ยังไม่แตะแดชบอร์ด (align-items: start)
     Phase 11 ทำ Dashboard V2 ไปแล้ว เงื่อนไขนั้นจึงหมดอายุ
     คงไว้เฉพาะส่วนที่ยังจริง: กริดยังเป็น 12 คอลัมน์ตามมาตรฐานเดิม
     ส่วนพฤติกรรมการยืดของ V2 ตรวจใน dashboard-phase11.test.ts */
  it('26 แดชบอร์ดยังเป็นกริด 12 คอลัมน์ตามมาตรฐานเดิม', () => {
    expect(dashCss).toContain('grid-template-columns: repeat(12, minmax(0, 1fr))');
  });

  it('27 การ์ดแดชบอร์ดใช้ ContentCard เดียวกับทั้งระบบ', () => {
    const dash = read('pages/DashboardPage.tsx');
    expect(dash.match(/<ContentCard/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(dash).toContain('dash-span-');
  });
});
