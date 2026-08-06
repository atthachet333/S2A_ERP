import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

const store = vi.hoisted(() => ({ user: null as AuthUser | null, health: {} as Record<string, unknown> }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@/hooks/useHealth', () => ({ useHealth: () => store.health }));

import Header from '@/components/layout/Header';

const noop = () => {};

describe('Header', () => {
  it('แสดงสถานะระบบว่าพร้อมใช้งานเมื่อ health ปกติ', () => {
    store.user = makeUser();
    store.health = { data: { status: 'ok', db: 'up', version: '0.1.0' }, isLoading: false, isError: false };
    renderWithProviders(<Header onToggleSidebar={noop} onOpenDrawer={noop} onLogout={noop} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'ระบบทั้งหมดพร้อมใช้งาน');
    expect(screen.getByText('เซิร์ฟเวอร์')).toBeInTheDocument();
    expect(screen.getByText('ฐานข้อมูล')).toBeInTheDocument();
  });

  it('แสดงว่าระบบขัดข้องเมื่อฐานข้อมูล down', () => {
    store.user = makeUser();
    store.health = { data: { status: 'degraded', db: 'down', version: '0.1.0' }, isLoading: false, isError: false };
    renderWithProviders(<Header onToggleSidebar={noop} onOpenDrawer={noop} onLogout={noop} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'ระบบบางส่วนขัดข้อง');
  });

  it('เปิดเมนูผู้ใช้และแสดงตัวเลือกออกจากระบบ', () => {
    store.user = makeUser();
    store.health = { data: undefined, isLoading: true, isError: false };
    renderWithProviders(<Header onToggleSidebar={noop} onOpenDrawer={noop} onLogout={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /วิน ผู้ดูแล/ }));
    expect(screen.getByRole('menuitem', { name: /ออกจากระบบ/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /เปลี่ยนรหัสผ่าน/ })).toBeInTheDocument();
  });
});
