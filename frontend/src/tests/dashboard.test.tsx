import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

const store = vi.hoisted(() => ({
  user: null as AuthUser | null,
  summary: {} as Record<string, unknown>,
  activity: {} as Record<string, unknown>,
}));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@/hooks/useDashboardSummary', () => ({ useDashboardSummary: () => store.summary }));
vi.mock('@/hooks/useActivity', () => ({ useActivity: () => store.activity }));
vi.mock('@/lib/catalog', () => ({ catalogApi: { items: vi.fn(() => Promise.resolve({ items: [], total: 0 })), menus: vi.fn(() => Promise.resolve([])) } }));

import DashboardPage from '@/pages/DashboardPage';

describe('DashboardPage', () => {
  beforeEach(() => {
    store.summary = { data: { users: 2, activeUsers: 2, units: 3, warehouses: 0, items: 5, recipes: 1, rawMaterials: 4, menus: 2, activeRecipes: 1, itemsWithoutPrice: 0 }, isLoading: false };
    store.activity = { data: { items: [], page: 1, pageSize: 6, total: 0, totalPages: 0 }, isLoading: false, isError: false };
  });

  it('แสดงชื่อผู้ใช้และทางลัดการทำงานของระบบคิดต้นทุน', () => {
    store.user = makeUser({ fullName: 'วิน ผู้ดูแล' });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('heading', { name: 'วิน ผู้ดูแล' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'เพิ่มวัตถุดิบ' })).toHaveAttribute('href', '/ingredients/new');
    expect(screen.getByRole('link', { name: 'เพิ่มบรรจุภัณฑ์' })).toHaveAttribute('href', '/packaging/new');
    expect(screen.getByRole('link', { name: 'ตั้งราคาขาย' })).toHaveAttribute('href', '/pricing');
  });

  it('ทางลัดเปิด route ของโมดูลหลักได้ถูกต้อง', () => {
    store.user = makeUser();
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('link', { name: /สูตรเมนูอาหาร/ })).toHaveAttribute('href', '/recipes');
    expect(screen.getByRole('link', { name: /สรุปการขาย/ })).toHaveAttribute('href', '/sales');
  });

  it('แสดงความคืบหน้าการตั้งค่าจากข้อมูลจริง', () => {
    store.user = makeUser();
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('เพิ่มวัตถุดิบ', { selector: '.si-main strong' })).toBeInTheDocument();
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
