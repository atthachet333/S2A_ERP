import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attentionCard, costCompletenessSlices, costingCard, hasSliceData,
  inventoryCard, operationsCard, primaryCards, type PrimaryInput,
} from '@/lib/dashboard-primary';
import type { DashboardAlert } from '@/lib/dashboard-alerts';

/**
 * PHASE 22 — DASHBOARD V4
 * ทุกตัวเลขต้องมาจากข้อมูลจริง ไม่มีแนวโน้มหรือการพยากรณ์ที่สร้างขึ้นเอง
 */

const alert = (over: Partial<DashboardAlert> = {}): DashboardAlert => ({
  id: 'a', severity: 'critical', title: 'เรื่องหนึ่ง', detail: '', ctaLabel: 'ดู', ctaTo: '/inventory', count: 1, ...over,
});

const base: PrimaryInput = {
  alerts: [],
  itemsMissingCost: 0,
  inventory: { itemCount: 60, outCount: 0, lowCount: 0, negativeCount: 0, totalValue: 1000 },
  operations: { receivingDrafts: 0, issueDrafts: 0, todayMovements: 4 },
};

describe('การ์ดหลักต้องมีสี่ใบเสมอ', () => {
  it('ได้สี่ใบพอดี ไม่มากไม่น้อย และเรียงตามลำดับที่ต้องอ่าน', () => {
    const cards = primaryCards(base);
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.id)).toEqual(['attention', 'costing', 'inventory', 'operations']);
  });

  it('ได้สี่ใบแม้ไม่มีข้อมูลเลย และใบที่ไม่มีข้อมูลบอกตรง ๆ ว่ายังไม่มี', () => {
    const cards = primaryCards({ alerts: [] });
    expect(cards).toHaveLength(4);
    expect(cards.find((c) => c.id === 'inventory')?.value).toBeNull();
    expect(cards.find((c) => c.id === 'inventory')?.hint).toBe('ยังไม่มีข้อมูล');
  });

  it('ทุกใบมีทั้งป้ายและข้อความประกอบเสมอ — สีไม่ใช่ช่องทางสื่อสารเดียว', () => {
    for (const card of primaryCards(base)) {
      expect(card.label.length, card.id).toBeGreaterThan(0);
      expect(card.hint.length, card.id).toBeGreaterThan(0);
    }
  });
});

describe('การ์ดต้องจัดการตอนนี้', () => {
  it('มีเรื่องค้าง = โทนอันตราย และนับเฉพาะเรื่องที่ต้องลงมือจริง', () => {
    const card = attentionCard({
      ...base,
      alerts: [alert({ count: 3 }), alert({ id: 'b', severity: 'warning', count: 2 }), alert({ id: 'c', severity: 'info', count: 9 })],
    });
    expect(card.tone).toBe('danger');
    expect(card.value).toBe(5);
  });

  it('ไม่มีเรื่องค้าง = เปลี่ยนเป็นสถานะสงบ ไม่ค้างสีแดงไว้ตลอด', () => {
    const card = attentionCard(base);
    expect(card.value).toBe(0);
    expect(card.tone).toBe('healthy');
    expect(card.hint).toContain('ไม่มีเรื่องค้าง');
  });

  it('สรุปเป็นหมวด ไม่ยกชื่อเรื่องจากรายการด้านล่างมาซ้ำ', () => {
    const card = attentionCard({
      ...base,
      itemsMissingCost: 19,
      inventory: { itemCount: 60, outCount: 1, lowCount: 2, negativeCount: 1, totalValue: 1000 },
      operations: { receivingDrafts: 1, issueDrafts: 0, todayMovements: 0 },
      alerts: [alert({ title: 'สินค้าหมดสต็อก 1 รายการ' })],
    });
    expect(card.breakdown.map((b) => b.label)).toEqual(['วัตถุดิบยังไม่มีต้นทุน', 'สต็อกหมด/ติดลบ', 'เอกสารรอยืนยัน']);
    expect(card.breakdown.map((b) => b.value)).toEqual([19, 2, 1]);
    expect(card.breakdown.some((b) => b.label.includes('สินค้าหมดสต็อก 1 รายการ'))).toBe(false);
  });

  it('พาไปหน้าที่แก้เรื่องนั้นได้จริง', () => {
    expect(attentionCard({ ...base, alerts: [alert({ ctaTo: '/inventory?status=OUT' })] }).to).toBe('/inventory?status=OUT');
  });
});

describe('การ์ดต้นทุน สต็อก และงานปฏิบัติการ', () => {
  it('ต้นทุน — ยังขาดข้อมูลจะเตือน ครบแล้วจะสงบ', () => {
    expect(costingCard({ ...base, itemsMissingCost: 19 }).tone).toBe('costing');
    expect(costingCard({ ...base, itemsMissingCost: 0 }).tone).toBe('healthy');
    expect(costingCard({ ...base, itemsMissingCost: 19 }).to).toBe('/ingredients/cost-completion');
  });

  it('สต็อก — หมดหรือติดลบต้องขึ้นโทนอันตราย', () => {
    expect(inventoryCard({ ...base, inventory: { itemCount: 60, outCount: 1, lowCount: 0, negativeCount: 0, totalValue: 0 } }).tone).toBe('danger');
    expect(inventoryCard({ ...base, inventory: { itemCount: 60, outCount: 0, lowCount: 3, negativeCount: 0, totalValue: 0 } }).tone).toBe('inventory');
    expect(inventoryCard(base).tone).toBe('healthy');
  });

  it('งานปฏิบัติการ — บอกที่มาของจำนวนการเคลื่อนไหวว่ามาจาก ledger', () => {
    const card = operationsCard(base);
    expect(card.breakdown.some((b) => b.label === 'รายการเคลื่อนไหวสต็อกวันนี้')).toBe(true);
    expect(card.hint).toContain('ledger');
  });

  it('ไม่มีสิทธิ์ดู = บอกตรง ๆ และต้องไม่มีตัวเลขจริงหลุดออกมา', () => {
    const denied = primaryCards({ ...base, permissions: { canInventory: false, canOperations: false } });
    const inv = denied.find((c) => c.id === 'inventory')!;
    const ops = denied.find((c) => c.id === 'operations')!;
    expect(inv.hint).toBe('ไม่มีสิทธิ์ดูข้อมูลนี้');
    expect(inv.value).toBeNull();
    expect(inv.breakdown).toEqual([]);
    expect(ops.hint).toBe('ไม่มีสิทธิ์ดูข้อมูลนี้');
    expect(ops.value).toBeNull();
  });
});

describe('แผนภูมิใช้ข้อมูลจริงเท่านั้น', () => {
  it('สัดส่วนความครบถ้วนของต้นทุนมาจากตัวเลขจริง และตัดส่วนที่เป็นศูนย์ทิ้ง', () => {
    const slices = costCompletenessSlices({ priced: 43, explicitZero: 0, missing: 19 });
    expect(slices.map((s) => s.label)).toEqual(['มีต้นทุนแล้ว', 'ยังไม่มีข้อมูล']);
    expect(slices.map((s) => s.value)).toEqual([43, 19]);
  });

  it('ไม่มีข้อมูลก็ไม่วาดกราฟเปล่า', () => {
    expect(costCompletenessSlices(undefined)).toEqual([]);
    expect(hasSliceData([])).toBe(false);
    expect(hasSliceData(costCompletenessSlices({ priced: 0, explicitZero: 0, missing: 0 }))).toBe(false);
    expect(hasSliceData(costCompletenessSlices({ priced: 1, explicitZero: 0, missing: 0 }))).toBe(true);
  });
});

describe('หน้าภาพรวมและสไตล์', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
  const page = read('../pages/DashboardPage.tsx');
  const primaryLib = read('../lib/dashboard-primary.ts');
  const css = read('../styles/page-pattern.css') + read('../styles/dashboard.css');

  it('ใช้ KPIGrid/KPICard ของระบบ ไม่สร้างการ์ดเอง', () => {
    expect(page).toContain('<KPIGrid columns={4} className="dash-primary">');
    expect(page).toContain('<KPICard');
    expect(page).not.toContain('className="dp-card');
  });

  it('ไม่มีแนวโน้มหรือการพยากรณ์ที่สร้างขึ้นเอง', () => {
    // ตัดคอมเมนต์ทิ้งก่อน ไม่งั้นคำอธิบายที่บอกว่า "ไม่มีการพยากรณ์" จะถูกจับเอง
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const surface = strip(page) + strip(primaryLib);
    for (const fake of ['forecast', 'พยากรณ์', 'จากเดือนก่อน', 'MoM', 'WoW', 'เทียบเดือนที่แล้ว']) {
      expect(surface, fake).not.toContain(fake);
    }
  });

  it('โทนสีของทุกกลุ่มงานมาจาก token ไม่ hardcode', () => {
    const block = css.slice(css.indexOf('.s2-kpi--success .s2-kpi-value'));
    expect(block).toContain('var(--ops)');
    expect(block).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('มีโทนของงานปฏิบัติการทั้งธีมสว่างและธีมมืด', () => {
    const tokens = read('../styles/tokens.css');
    const split = tokens.indexOf('--info-bg: #16304d');
    expect(tokens.slice(0, split)).toContain('--ops:');
    expect(tokens.slice(split)).toContain('--ops:');
  });
});
