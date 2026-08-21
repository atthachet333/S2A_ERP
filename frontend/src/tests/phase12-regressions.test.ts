import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { auditActionLabel, auditEntityLabel } from '@/lib/admin-vocab';
import { activityLabel } from '@/lib/dashboard-alerts';
import { costingSummary, recipesNeedingAttention } from '@/lib/dashboard-lists';
import type { MenuRow } from '@/lib/catalog';

/**
 * PHASE 12 — regression test เฉพาะบั๊กที่พิสูจน์ได้จากข้อมูลจริงใน production
 * ทุกเคสด้านล่างอ้างอิงค่าที่อ่านจากฐานข้อมูล s2a_erp เมื่อ 2026-08-21
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');
const masterCss = read('styles/master-data.css');
const dashCss = read('styles/dashboard.css');

/* ============================================================
   BUG 1 — แดชบอร์ดโชว์ action เป็นอังกฤษดิบ
   audit_logs จริงมี 21 action แต่ตารางแปลของแดชบอร์ดครอบคลุมแค่ 3
   ============================================================ */
describe('BUG 1 — คำแปลกิจกรรมต้องมาจากแหล่งเดียวและครอบคลุมของจริง', () => {
  /** action ทั้งหมดที่มีอยู่จริงใน audit_logs พร้อมจำนวนครั้ง */
  const REAL_ACTIONS = [
    'CREATE', 'SWITCH_COMPANY', 'UPDATE', 'PRICE_UPDATE', 'RECIPE_UPDATED', 'RECIPE_CREATED',
    'DOWNLOAD', 'USER_CREATED', 'CHANGE_PASSWORD', 'DEACTIVATE', 'ACTIVATE', 'ITEM_CREATED',
    'UPSERT', 'USER_SELF_REGISTERED', 'CONFIRM', 'PASSWORD_RESET_REQUESTED',
    'REGISTRATION_APPROVED', 'ROLE_PERMISSIONS_UPDATED', 'SET_PRICE', 'SUPPLIER_CREATED',
    'WAREHOUSE_CREATED',
  ];

  it('แดชบอร์ดกับหน้าประวัติใช้ฟังก์ชันแปลตัวเดียวกัน', () => {
    // เดิมแดชบอร์ดมี ACTIVITY_TH ของตัวเอง ทำให้ CREATE แปลคนละแบบสองหน้า
    expect(activityLabel).toBe(auditActionLabel);
    expect(read('lib/dashboard-alerts.ts')).not.toMatch(/const ACTIVITY_TH/);
  });

  it('ทุก action ที่มีจริงในระบบต้องมีคำแปลไทย ไม่เหลืออังกฤษดิบ', () => {
    const untranslated = REAL_ACTIONS.filter((a) => auditActionLabel(a) === a);
    expect(untranslated).toEqual([]);
  });

  it('6 กิจกรรมล่าสุดจริงบนแดชบอร์ดต้องอ่านเป็นไทยทั้งหมด', () => {
    // ของจริง ณ เวลาที่ตรวจ: SWITCH_COMPANY, RECIPE_UPDATED ×3, PRICE_UPDATE ×2
    expect(auditActionLabel('SWITCH_COMPANY')).toBe('สลับบริษัท');
    expect(auditActionLabel('RECIPE_UPDATED')).toBe('บันทึกเวอร์ชันสูตร');
    expect(auditActionLabel('PRICE_UPDATE')).toBe('อัปเดตราคาซื้อ');
  });

  it('ยังคืนค่าดิบเมื่อเจอ action ที่ไม่รู้จัก — ไม่เดาความหมาย', () => {
    expect(auditActionLabel('SOMETHING_BRAND_NEW')).toBe('SOMETHING_BRAND_NEW');
    expect(auditActionLabel(null)).toBe('—');
  });

  it('entity ที่พบจริงมีคำแปลครบ', () => {
    for (const e of ['Company', 'Recipe', 'Unit', 'UnitConversion', 'CompanySettings',
      'Category', 'GoodsReceipt', 'Item', 'User', 'Role', 'SellingPrice', 'Supplier', 'Warehouse']) {
      expect(auditEntityLabel(e)).not.toBe(e);
    }
  });
});

/* ============================================================
   BUG 2 — ต้นทุนเมนูใน list เป็นต้นทุนทั้งแบตช์
   ============================================================ */
describe('BUG 2 — ต้นทุนเมนูต้องเป็นต่อหน่วย ไม่ใช่ทั้งแบตช์', () => {
  const menuRoute = fs.readFileSync(
    path.join(process.cwd(), '..', 'backend', 'src', 'modules', 'catalog', 'menu.route.ts'), 'utf8');

  it('endpoint list ใช้ unitCost ไม่ใช่ totalCost', () => {
    const list = menuRoute.slice(0, menuRoute.indexOf("app.get('/:id'"));
    expect(list).toContain('num(cost.unitCost)');
    expect(list).not.toContain('num(cost.totalCost)');
  });

  it('margin คำนวณจากต้นทุนต่อหน่วย', () => {
    const list = menuRoute.slice(0, menuRoute.indexOf("app.get('/:id'"));
    expect(list).toContain('(price - unitCost) / price');
  });

  it('MenuRow ไม่มี field totalCost ที่ทำให้เข้าใจผิดแล้ว', () => {
    const catalog = read('lib/catalog.ts');
    const menuRow = catalog.slice(catalog.indexOf('export interface MenuRow'), catalog.indexOf('export interface RecipeRow'));
    expect(menuRow).toContain('unitCost: number | null');
    expect(menuRow).not.toMatch(/^\s*totalCost:/m);
  });

  it('ตัวเลขจริงยืนยันว่าเป็นคนละความหมาย: 1403.2133 ÷ 55 = 25.513', () => {
    expect(Math.round((1403.2133 / 55) * 1000) / 1000).toBe(25.513);
  });

  it('ตรรกะ "ยังไม่มีต้นทุน" อ่านจาก unitCost', () => {
    const base: MenuRow = {
      id: 'm', code: 'MENU-1', name: 'เมนู', imageUrl: null, category: null, sellingUnit: 'BAG',
      isActive: true, recipeId: 'r', hasRecipe: true, unitCost: null, sellingPrice: null, margin: null,
    };
    expect(recipesNeedingAttention([base])[0].issue).toBe('NO_COST');
    expect(costingSummary([base]).noCost).toBe(1);
    expect(costingSummary([{ ...base, unitCost: 25.513 }]).noCost).toBe(0);
  });
});

/* ============================================================
   BUG 3 — ตารางข้อมูลหลัก/ออเดอร์หายทั้งตารางบนมือถือ
   ============================================================ */
describe('BUG 3 — card mode ของตารางต้องไม่ซ่อนทั้งตาราง', () => {
  const cardBlock = masterCss.slice(masterCss.indexOf('@media (max-width: 760px)'),
    masterCss.indexOf('@media (max-width: 430px)'));

  it('กฎ thead/tbody/tr/td ต้องผูกกับทุก page scope ไม่ใช่แค่ .admin-page', () => {
    for (const el of ['thead', 'tbody', 'tr', 'td']) {
      for (const page of ['master-page', 'order-page', 'admin-page']) {
        expect(cardBlock).toContain(`.${page} .md-table ${el}`);
      }
    }
  });

  /** แยกบล็อกเป็นกฎ ๆ: selectors + declarations
   *  ต้องตัดคอมเมนต์ทิ้งก่อน เพราะคอมเมนต์อธิบายบั๊กมีตัวอย่าง CSS เก่าอยู่ข้างใน */
  const rules = cardBlock.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
    .map((chunk) => chunk.split('{'))
    .filter((parts) => parts.length === 2)
    .map(([sel, decl]) => ({
      selectors: sel.split(',').map((x) => x.trim()).filter(Boolean),
      decl: decl.trim(),
    }));

  it('ไม่มีกฎไหนซ่อน .md-table ทั้งตาราง — คือบั๊กที่ทำให้ตารางหายบนมือถือ', () => {
    const hidesWholeTable = rules
      .filter((r) => /display:\s*none/.test(r.decl))
      .flatMap((r) => r.selectors)
      .filter((sel) => /\.md-table$/.test(sel));
    expect(hidesWholeTable).toEqual([]);
  });

  it('กฎที่เจาะจง element ย่อย ต้องไม่มี .md-table เปล่าปนอยู่ในกฎเดียวกัน', () => {
    // นี่คือรูปแบบที่พังเดิม: ".master-page .md-table, .order-page .md-table, .admin-page .md-table thead"
    // กฎหนึ่งจัดกลุ่ม td หลายแบบได้ (เช่น td:nth-child(2) กับ td.md-card-title) — ไม่ผิด
    for (const r of rules) {
      const parts = r.selectors.filter((sel) => sel.includes('.md-table'));
      const targetsDescendant = parts.some((sel) => sel.split('.md-table')[1].trim() !== '');
      const bare = parts.filter((sel) => sel.split('.md-table')[1].trim() === '');
      if (targetsDescendant) {
        expect(bare, `กฎนี้มี .md-table เปล่าปนกับ element ย่อย: ${r.selectors.join(' , ')}`).toEqual([]);
      }
    }
  });
});

/* ============================================================
   BUG 4 — เอกสารเก่าที่ไม่มี beforeQty ไม่มีคำอธิบาย
   ============================================================ */
describe('BUG 4 — ยอด "ก่อน" ที่ว่างต้องมีคำอธิบาย', () => {
  const detail = read('pages/OperationDetailPages.tsx');

  it('LedgerNote รับ missingBefore และอธิบายกรณีนี้', () => {
    expect(detail).toContain('missingBefore');
    expect(detail).toContain('บันทึกไว้ก่อนระบบจะเก็บยอดคงเหลือก่อนทำรายการ');
  });

  it('ทั้งหน้ารับของและหน้าเบิกส่ง missingBefore', () => {
    expect(detail.match(/missingBefore=\{missingBefore\}/g)?.length).toBe(2);
    expect(detail.match(/const missingBefore =/g)?.length).toBe(2);
  });

  it('ยังไม่คำนวณยอดก่อนย้อนหลังจากสต็อกปัจจุบัน', () => {
    expect(detail).toContain('ไม่คำนวณย้อนหลังจากสต็อกปัจจุบัน');
    expect(detail).toContain('im.before != null ? qty(im.before) : \'—\'');
  });
});

/* ============================================================
   BUG 5 — ป้ายประเภทคลังใช้คำของตัวกรอง
   ============================================================ */
describe('BUG 5 — คลังที่ไม่ได้ตั้งประเภทต้องไม่ขึ้นว่า "ทุกประเภท"', () => {
  const partners = read('pages/catalog/PartnerMastersPage.tsx');

  it('ค่าว่างในแถวข้อมูลแปลว่า "ไม่ระบุ"', () => {
    const fn = partners.slice(partners.indexOf('const warehouseTypeLabel'),
      partners.indexOf('type Draft'));
    expect(fn).toContain("if (!v) return 'ไม่ระบุ';");
    expect(fn).not.toContain("?? (v ?? 'ทุกประเภท (ไม่ระบุ)')");
  });

  it('dropdown ยังใช้คำเดิมสำหรับตัวเลือก "ทุกประเภท"', () => {
    expect(partners).toContain("{ value: '', label: 'ทุกประเภท (ไม่ระบุ)' }");
  });
});

/* ============================================================
   BUG 6 — คอนทราสต์ dark mode ของข้อความเล็ก
   ============================================================ */
describe('BUG 6 — dark mode ต้องใช้คู่สีที่อ่านออก', () => {
  it('ใช้ token ที่มีอยู่แล้ว ไม่สร้าง token ใหม่', () => {
    expect(dashCss).toContain(':root.dark .dash-ok { color: var(--success-fg); }');
    expect(dashCss).toContain(':root.dark .dash-list .dl-open { color: var(--info-fg); }');
  });

  it('ไม่ hardcode ค่าสีในกฎ dark ของแดชบอร์ด', () => {
    const darkRules = dashCss.split('\n').filter((l) => l.includes(':root.dark'));
    expect(darkRules.length).toBeGreaterThan(0);
    for (const r of darkRules) expect(r).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
