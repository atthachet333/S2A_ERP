import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

const store = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));

import Sidebar from '@/components/layout/Sidebar';

describe('Sidebar', () => {
  it('แสดงโลโก้จริงและชื่อระบบ', () => {
    store.user = makeUser();
    renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);
    const logo = screen.getByAltText('โลโก้ S2A ERP') as HTMLImageElement;
    expect(logo).toBeInTheDocument();
    expect(logo.getAttribute('src')).toContain('s2a-logo.png');
    expect(screen.getByText('S2A ERP')).toBeInTheDocument();
  });

  it('SUPER_ADMIN เห็นเมนูผู้ใช้งานและตั้งค่าระบบ', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);
    expect(screen.getByText('ผู้ใช้งาน')).toBeInTheDocument();
    expect(screen.getByText('ตั้งค่าระบบ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ภาพรวม' })).toBeInTheDocument();
  });

  it('ผู้ใช้ที่ไม่ใช่ SUPER_ADMIN ไม่เห็นเมนูเฉพาะผู้ดูแล', () => {
    store.user = makeUser({ roles: ['ADMIN'] });
    renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);
    expect(screen.queryByText('ผู้ใช้งาน')).not.toBeInTheDocument();
    expect(screen.queryByText('ประวัติการใช้งาน')).not.toBeInTheDocument();
    expect(screen.getByText('วัตถุดิบและสินค้า')).toBeInTheDocument();
  });

  it('มีปุ่มออกจากระบบและเรียก callback เมื่อคลิก', () => {
    store.user = makeUser();
    const onLogout = vi.fn();
    const { getByRole } = renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={onLogout} />);
    getByRole('button', { name: /ออกจากระบบ/ }).click();
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
