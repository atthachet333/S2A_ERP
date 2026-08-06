import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

const store = vi.hoisted(() => ({
  user: null as AuthUser | null,
  health: {} as Record<string, unknown>,
  summary: {} as Record<string, unknown>,
  activity: {} as Record<string, unknown>,
}));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@/hooks/useHealth', () => ({ useHealth: () => store.health }));
vi.mock('@/hooks/useDashboardSummary', () => ({ useDashboardSummary: () => store.summary }));
vi.mock('@/hooks/useActivity', () => ({ useActivity: () => store.activity }));

import DashboardPage from '@/pages/DashboardPage';

describe('DashboardPage', () => {
  beforeEach(() => {
    store.health = { data: { status: 'ok', db: 'up', version: '0.1.0' }, isLoading: false, isError: false };
    store.summary = { data: { users: 2, activeUsers: 2, units: 0, warehouses: 0, items: 0, recipes: 0 }, isLoading: false };
    store.activity = { data: { items: [], page: 1, pageSize: 6, total: 0, totalPages: 0 }, isLoading: false, isError: false };
  });

  it('แสดงชื่อผู้ใช้และทางลัดการทำงาน', () => {
    store.user = makeUser({ fullName: 'วิน ผู้ดูแล' });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('heading', { name: 'วิน ผู้ดูแล' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'เพิ่มวัตถุดิบ' })).toHaveAttribute('href', '/items');
    expect(screen.getByRole('link', { name: 'สร้างใบผลิต' })).toBeInTheDocument();
  });

  it('Quick Navigation เปิด route ที่ถูกต้อง', () => {
    store.user = makeUser();
    renderWithProviders(<DashboardPage />);
    const link = screen.getByRole('link', { name: /วัตถุดิบและสินค้า/ });
    expect(link).toHaveAttribute('href', '/items');
  });

  it('แสดงความคืบหน้าการตั้งค่าจากข้อมูลจริง', () => {
    store.user = makeUser();
    renderWithProviders(<DashboardPage />);
    // ฐานข้อมูล up + มีผู้ใช้ => อย่างน้อย 2/6
    expect(screen.getByText('เชื่อมต่อฐานข้อมูล')).toBeInTheDocument();
    expect(screen.getByText('สร้างสูตรแรก')).toBeInTheDocument();
  });

  it('Recent Activity แสดง empty state เมื่อไม่มีข้อมูล (admin)', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
  });

  it('Recent Activity จำกัดเฉพาะผู้ดูแลสำหรับผู้ใช้ทั่วไป', () => {
    store.user = makeUser({ roles: ['ADMIN'] });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('เฉพาะผู้ดูแลระบบ')).toBeInTheDocument();
  });
});
