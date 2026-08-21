import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activityLabel, buildDashboardAlerts, restockList } from '@/lib/dashboard-alerts';
import { canAny, countToday, draftCount, type DocRow, type InventoryRow } from '@/hooks/useDashboardData';

/** PHASE 5 — ตรรกะล้วนของ Dashboard (ไม่ต้อง mount หน้า) */

const KPI = { itemCount: 10, totalValue: 1000, lowCount: 0, outCount: 0, negativeCount: 0, movementsToday: 0, thresholdMissing: false };
const row = (over: Partial<InventoryRow>): InventoryRow => ({
  itemId: 'i', code: 'C', name: 'N', type: 'RAW_MATERIAL', warehouseId: 'w', warehouseCode: 'W', warehouseName: 'คลัง',
  onHand: 0, reserved: 0, available: 0, unit: 'KG', lastCost: 0, stockValue: 0, threshold: 0,
  status: 'IN_STOCK', lastMovementAt: null, ...over,
});
const noDrafts = { receivingDrafts: 0, issueDrafts: 0 };

describe('actionable alerts', () => {
  it('1 ทุกอย่างปกติ → ไม่มีเรื่องต้องจัดการ', () => {
    expect(buildDashboardAlerts({ inventoryKpi: KPI, menus: [], ...noDrafts })).toEqual([]);
  });

  it('2 สต็อกติดลบมาก่อนของหมดเสมอ', () => {
    const a = buildDashboardAlerts({ inventoryKpi: { ...KPI, negativeCount: 1, outCount: 3 }, ...noDrafts });
    expect(a[0].id).toBe('stock-negative');
    expect(a[0].severity).toBe('critical');
  });

  it('3 เรื่องวิกฤตอยู่เหนือเรื่องเตือน และเตือนอยู่เหนือข้อมูลไม่ครบ', () => {
    const a = buildDashboardAlerts({
      inventoryKpi: { ...KPI, outCount: 1, lowCount: 2 },
      itemsWithoutPrice: 5,
      receivingDrafts: 1, issueDrafts: 0,
    });
    const sev = a.map((x) => x.severity);
    expect(sev).toEqual([...sev].sort((x, y) => ({ critical: 0, warning: 1, info: 2 })[x] - ({ critical: 0, warning: 1, info: 2 })[y]));
    expect(sev[0]).toBe('critical');
  });

  it('4 ของหมดใส่ชื่อสินค้าจริงในรายละเอียด', () => {
    const a = buildDashboardAlerts({
      inventoryKpi: { ...KPI, outCount: 2 },
      inventoryRows: [row({ name: 'ไข่ไก่', status: 'OUT' }), row({ name: 'น้ำมัน', status: 'OUT' })],
      ...noDrafts,
    });
    expect(a.find((x) => x.id === 'stock-out')!.detail).toContain('ไข่ไก่');
  });

  it('5 ราคาต่ำกว่าต้นทุนตรวจจาก margin ติดลบ ไม่ได้ตั้งเกณฑ์เอง', () => {
    const menus = [
      { id: '1', name: 'ชาไทย', sellingPrice: 10, margin: -20 },
      { id: '2', name: 'กาแฟ', sellingPrice: 30, margin: 5 },
      { id: '3', name: 'โกโก้', sellingPrice: 20, margin: 0 },
    ] as never;
    const a = buildDashboardAlerts({ inventoryKpi: KPI, menus, ...noDrafts });
    const alert = a.find((x) => x.id === 'price-below-cost')!;
    expect(alert.count).toBe(1);
    expect(alert.detail).toContain('ชาไทย');
  });

  it('6 margin เท่ากับ 0 ไม่นับว่าขาดทุน', () => {
    const menus = [{ id: '1', name: 'x', sellingPrice: 10, margin: 0 }] as never;
    expect(buildDashboardAlerts({ inventoryKpi: KPI, menus, ...noDrafts }).some((x) => x.id === 'price-below-cost')).toBe(false);
  });

  it('7 เมนูที่ยังไม่ตั้งราคา แยกจากเมนูที่ขาดทุน', () => {
    const menus = [{ id: '1', name: 'x', sellingPrice: null, margin: null }] as never;
    const a = buildDashboardAlerts({ inventoryKpi: KPI, menus, ...noDrafts });
    expect(a.find((x) => x.id === 'menu-unpriced')?.count).toBe(1);
    expect(a.some((x) => x.id === 'price-below-cost')).toBe(false);
  });

  it('8 ร่างเอกสารที่ค้างกลายเป็นเรื่องต้องจัดการ พร้อมทางไปต่อ', () => {
    const a = buildDashboardAlerts({ inventoryKpi: KPI, receivingDrafts: 2, issueDrafts: 3 });
    expect(a.find((x) => x.id === 'receiving-draft')!.ctaTo).toBe('/receiving');
    expect(a.find((x) => x.id === 'issue-draft')!.count).toBe(3);
  });

  it('9 ทุกเรื่องมีปุ่มไปต่อและปลายทางจริง', () => {
    const a = buildDashboardAlerts({
      inventoryKpi: { ...KPI, outCount: 1, lowCount: 1, negativeCount: 1 },
      itemsWithoutPrice: 2, receivingDrafts: 1, issueDrafts: 1,
    });
    expect(a.length).toBeGreaterThan(4);
    for (const x of a) {
      expect(x.ctaLabel.length).toBeGreaterThan(0);
      expect(x.ctaTo.startsWith('/')).toBe(true);
    }
  });

  it('10 ไม่มีข้อมูลคลัง (ไม่มีสิทธิ์) → ไม่เดาว่าสต็อกมีปัญหา', () => {
    expect(buildDashboardAlerts({ ...noDrafts }).length).toBe(0);
  });
});

describe('restock list', () => {
  it('11 เรียงติดลบ → หมด → ใกล้หมด', () => {
    const list = restockList([
      row({ itemId: 'a', status: 'LOW', available: 5 }),
      row({ itemId: 'b', status: 'NEGATIVE', available: -2 }),
      row({ itemId: 'c', status: 'OUT', available: 0 }),
    ]);
    expect(list.map((r) => r.status)).toEqual(['NEGATIVE', 'OUT', 'LOW']);
  });

  it('12 ไม่เอารายการที่ปกติมาแสดง', () => {
    expect(restockList([row({ status: 'IN_STOCK' })])).toEqual([]);
  });

  it('13 จำกัดจำนวนตามที่ขอ', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ itemId: `i${i}`, status: 'LOW', available: i }));
    expect(restockList(rows, 6)).toHaveLength(6);
  });
});

describe('document counting', () => {
  const today = new Date('2026-08-20T10:00:00.000Z');
  const rows: DocRow[] = [
    { id: '1', status: 'CONFIRMED', receiptDate: '2026-08-20T09:00:00.000Z' },
    { id: '2', status: 'DRAFT', receiptDate: '2026-08-20T08:00:00.000Z' },
    { id: '3', status: 'CONFIRMED', receiptDate: '2026-08-19T09:00:00.000Z' },
    { id: '4', status: 'REVERSED', receiptDate: '2026-08-20T07:00:00.000Z' },
  ];

  it('14 นับเฉพาะเอกสารของวันนี้', () => {
    expect(countToday(rows, 'receiptDate', today).total).toBe(3);
  });

  it('15 แยกยืนยัน / ร่าง / กลับรายการ', () => {
    const c = countToday(rows, 'receiptDate', today);
    expect(c).toMatchObject({ confirmed: 1, draft: 1, reversed: 1 });
  });

  it('16 ใบเบิกที่ ISSUED นับเป็นยืนยันแล้ว', () => {
    const c = countToday([{ id: '1', status: 'ISSUED', issueDate: '2026-08-20T09:00:00.000Z' }], 'issueDate', today);
    expect(c.confirmed).toBe(1);
  });

  it('17 ไม่มีข้อมูล → ศูนย์ทั้งหมด ไม่ throw', () => {
    expect(countToday(undefined, 'receiptDate', today)).toEqual({ total: 0, draft: 0, confirmed: 0, reversed: 0 });
  });

  it('18 วันที่ผิดรูปแบบถูกข้าม ไม่พังทั้งการ์ด', () => {
    expect(countToday([{ id: '1', status: 'DRAFT', receiptDate: 'ไม่ใช่วันที่' }], 'receiptDate', today).total).toBe(0);
  });

  it('19 ร่างค้างนับทุกวัน ไม่ใช่เฉพาะวันนี้', () => {
    expect(draftCount(rows)).toBe(1);
    expect(draftCount(undefined)).toBe(0);
  });
});

describe('permissions', () => {
  it('20 SUPER_ADMIN ผ่านทุกสิทธิ์เหมือนที่ backend ทำ', () => {
    expect(canAny(['SUPER_ADMIN'], [], 'ANYTHING')).toBe(true);
  });

  it('21 ต้องมีสิทธิ์ข้อใดข้อหนึ่ง', () => {
    expect(canAny(['STAFF'], ['RECEIVING_VIEW'], 'RECEIVING_VIEW', 'RECEIVING_CREATE')).toBe(true);
    expect(canAny(['STAFF'], ['OTHER'], 'RECEIVING_VIEW')).toBe(false);
  });
});

describe('activity label mapping', () => {
  /* PHASE 12 — เดิมข้อนี้ทดสอบ GOODS_RECEIPT_CONFIRMED / STOCK_ISSUE_ISSUED
     ซึ่งตรวจกับ audit_logs จริงแล้วไม่เคยมี backend ไม่เคยเขียน action ชื่อนี้
     (ของจริงคือ CONFIRM บน entity GoodsReceipt) จึงเปลี่ยนมาใช้ action ที่มีจริง */
  it('22 แปลงชื่อเหตุการณ์เป็นภาษาไทย', () => {
    expect(activityLabel('CONFIRM')).toBe('ยืนยันเอกสาร');
    expect(activityLabel('RECIPE_UPDATED')).toBe('บันทึกเวอร์ชันสูตร');
    expect(activityLabel('SWITCH_COMPANY')).toBe('สลับบริษัท');
  });

  it('23 ไม่รู้จัก → คืนค่าเดิม ไม่เดาความหมาย', () => {
    expect(activityLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

/* ---------- โครงหน้า / CSS ---------- */
const SRC = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(SRC, 'pages/DashboardPage.tsx'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'styles/dashboard.css'), 'utf8');

describe('dashboard page/css', () => {
  it('24 ใช้ primitive จาก Phase 2+3 ไม่สร้าง shell ใหม่', () => {
    expect(page).toContain('<PageContainer size="wide"');
    expect(page).toContain('<PageHeader');
    expect(page).toContain('<KPIGrid');
    expect(page).toContain('<ContentCard');
  });

  it('25 ไม่มี inline style เหลืออยู่', () => {
    expect(page).not.toContain('style={{');
  });

  it('26 ไม่มี chart ประเภท donut/pie', () => {
    expect(page).not.toContain('conic-gradient');
    expect(css).not.toContain('conic-gradient');
  });

  it('27 loading ใช้ skeleton ตามตำแหน่งจริง ไม่ใช่ spinner กลางจอ', () => {
    expect(page).toContain('KPISkeleton');
    expect(page).toContain('CardSkeleton');
  });

  it('28 การ์ดที่ล้มมี retry เป็นของตัวเอง', () => {
    expect(page).toContain('CardError');
    expect(page).toContain('ลองใหม่');
    expect(page).toMatch(/isError \? <CardError/);
  });

  it('29 CSS ใช้ token ไม่ hardcode สีธีม', () => {
    expect(css).toContain('var(--space-');
    expect(css).toContain('var(--control-h)');
    expect(css).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(css).not.toMatch(/color:\s*#[0-9a-f]{6}/i);
  });

  it('30 breakpoint ตรงมาตรฐานระบบ (+1366 สำหรับ grid 12 คอลัมน์)', () => {
    const bps = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(bps.every((b) => [1366, 1024, 760, 430].includes(b))).toBe(true);
  });

  it('31 gold ใช้เป็น accent จุดเดียว ไม่ใช่ทุกการ์ด', () => {
    expect((css.match(/var\(--gold\)/g) ?? []).length).toBeLessThanOrEqual(2);
  });
});
