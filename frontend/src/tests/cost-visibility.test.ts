import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PHASE 20C — มองเห็นวัตถุดิบที่ยังไม่มีต้นทุน
 *
 * เดิมหน้ารายการมีการ์ดบอกจำนวน "ยังไม่มีราคาซื้อ" แต่ไม่มีทางกรองให้เหลือเฉพาะรายการนั้น
 * ผู้ใช้เห็นตัวเลขแต่หาไม่เจอว่าคือรายการไหน ต้องไล่ดูทีละหน้า
 *
 * เทสต์ชุดนี้ไม่ตั้งสมมติฐานเรื่องราคาหรืออัตราแปลงของรายการใดทั้งสิ้น
 */

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('หน้ารายการวัตถุดิบ: กรองหาของที่ยังไม่มีต้นทุนได้', () => {
  const page = strip(read('../pages/catalog/ItemListWorkspace.tsx'));

  it('มีตัวกรองคุณภาพข้อมูลในแถบกรอง', () => {
    expect(page).toContain("aria-label=\"ความครบถ้วนของข้อมูล\"");
    expect(page).toContain('<option value="noPrice">เฉพาะที่ยังไม่มีราคาซื้อ</option>');
    expect(page).toContain('<option value="noFactor">เฉพาะที่ยังไม่ตั้งอัตราแปลง</option>');
  });

  it('ส่งตัวกรองไปที่ backend และใส่ไว้ใน queryKey ให้ผลไม่ค้าง', () => {
    expect(page).toMatch(/catalogApi\.items\(\{[^)]*dataIssue/);
    expect(page).toMatch(/queryKey: \['items', variant\.type, \{ search, status, dataIssue, page \}\]/);
  });

  it('กดการ์ด KPI แล้วกรองได้ทันที และกดซ้ำเพื่อยกเลิก', () => {
    expect(page).toMatch(/active=\{dataIssue === 'noPrice'\}/);
    expect(page).toMatch(/setDataIssue\(dataIssue === 'noPrice' \? '' : 'noPrice'\)/);
    expect(page).toMatch(/active=\{dataIssue === 'noFactor'\}/);
    expect(page).toMatch(/setDataIssue\(dataIssue === 'noFactor' \? '' : 'noFactor'\)/);
  });

  it('การ์ดที่ไม่มีรายการค้างอยู่ต้องกดไม่ได้ (ไม่หลอกว่ากดได้แล้วเจอหน้าว่าง)', () => {
    expect(page).toMatch(/onClick=\{kpi && kpi\.noPrice > 0 \? \(\) =>/);
    expect(page).toMatch(/onClick=\{kpi && kpi\.noFactor > 0 \? \(\) =>/);
  });

  it('ปุ่มล้างตัวกรองล้างตัวกรองใหม่ด้วย', () => {
    expect(page).toMatch(/setSearch\(''\); setStatus\(''\); setDataIssue\(''\); resetPage\(\);/);
    expect(page).toContain("Boolean(search || status || dataIssue)");
  });

  it('ยังไม่บล็อกการทำงานปกติ — เป็นการเตือนและตัวกรองเท่านั้น', () => {
    // ห้ามมีการปิดปุ่มบันทึกหรือกันการใช้งานเพราะต้นทุนเป็น 0
    expect(page).not.toMatch(/disabled=\{[^}]*noPrice/);
    expect(page).not.toMatch(/lastCost\s*<=\s*0\s*\)\s*return null/);
  });
});

describe('หน้าคำนวณต้นทุน: ยังบอกรายการที่ไม่มีราคาเหมือนเดิม', () => {
  const costing = strip(read('../pages/catalog/CostingWorkspacePage.tsx'));

  it('บอกชื่อวัตถุดิบที่ยังไม่มีราคาซื้อของสูตรนั้น', () => {
    expect(costing).toMatch(/lastCost <= 0/);
    expect(costing).toContain('ยังไม่มีราคาซื้อของ:');
  });

  it('บรรทัดที่ไม่มีราคายังมีป้ายกำกับของตัวเอง ไม่ได้ซ่อนไป', () => {
    expect(costing).toContain('ไม่มีราคา');
  });
});

describe('การแจ้งเตือนบนแดชบอร์ดยังอยู่ครบ', () => {
  const alerts = strip(read('../lib/dashboard-alerts.ts'));

  it('ยังเตือนเรื่องวัตถุดิบไม่มีราคาซื้อ พร้อมทางไปแก้', () => {
    expect(alerts).toContain('item-no-price');
    expect(alerts).toContain('ต้นทุนสูตรที่ใช้วัตถุดิบเหล่านี้จะต่ำกว่าความจริง');
    expect(alerts).toContain("ctaTo: '/ingredients'");
  });
});

describe('เมนูข้าง: ไม่เพิ่มทางเข้าที่ซ้ำกับหน้าเฉพาะทาง', () => {
  const nav = strip(read('../components/layout/nav-config.ts'));

  it('วัตถุดิบและบรรจุภัณฑ์ยังใช้หน้าเฉพาะของตัวเอง', () => {
    expect(nav).toContain("path: '/ingredients'");
    expect(nav).toContain("path: '/packaging'");
  });

  it('ไม่เพิ่ม /items เข้าเมนู เพราะจะซ้ำกับหน้าเฉพาะทางที่มีอยู่แล้ว', () => {
    expect(nav).not.toMatch(/\{ path: '\/items',/);
  });
});
