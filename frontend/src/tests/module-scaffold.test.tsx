import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import ModuleScaffold from '@/components/ModuleScaffold';
import { MODULE_STRUCTURE } from '@/components/layout/module-structure';
import { MODULES } from '@/components/layout/nav-config';
import { renderWithProviders } from './test-utils';

describe('ModuleScaffold', () => {
  it('แสดงโครงหน้าจอละเอียด (สรุป/ตัวกรอง/คอลัมน์) พร้อม empty state สำหรับ /items', () => {
    renderWithProviders(<ModuleScaffold />, { route: '/items' });
    expect(screen.getByRole('heading', { name: 'วัตถุดิบและสินค้า' })).toBeInTheDocument();
    // คอลัมน์ที่วางแผนไว้ต้องปรากฏเป็นหัวตาราง
    expect(screen.getByRole('columnheader', { name: 'ต้นทุนเฉลี่ย' })).toBeInTheDocument();
    // ไม่มีข้อมูลปลอม — แสดง empty state
    expect(screen.getByText('ยังไม่มีข้อมูลวัตถุดิบและสินค้า')).toBeInTheDocument();
    // ปุ่มสร้างต้อง disabled จนกว่า API พร้อม
    expect(screen.getByRole('button', { name: /เพิ่มรายการ/ })).toBeDisabled();
  });

  it('มีโครงสร้างครบทุก path ที่ประกาศ และคอลัมน์ไม่ว่าง', () => {
    for (const [path, structure] of Object.entries(MODULE_STRUCTURE)) {
      expect(MODULES[path], `MODULES ต้องมี meta ของ ${path}`).toBeTruthy();
      expect(structure.columns.length).toBeGreaterThan(0);
    }
  });

  it('fallback ไปหน้า placeholder เดิมเมื่อ path ไม่มีโครงสร้าง (/settings)', () => {
    renderWithProviders(<ModuleScaffold />, { route: '/settings' });
    expect(screen.getByRole('heading', { name: 'ตั้งค่าระบบ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /กลับสู่ภาพรวม/ })).toHaveAttribute('href', '/dashboard');
  });
});
