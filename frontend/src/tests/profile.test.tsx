import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

const store = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));

import ProfilePage from '@/pages/ProfilePage';

describe('ProfilePage', () => {
  it('แสดงข้อมูลบัญชี บทบาท และสิทธิ์', () => {
    store.user = makeUser({ fullName: 'ปึ้ง แอดมิน', username: 'pueng', roles: ['ADMIN'], permissions: ['DASHBOARD_VIEW', 'PROFILE_VIEW'] });
    renderWithProviders(<ProfilePage />, { route: '/profile' });
    expect(screen.getByRole('heading', { name: 'ปึ้ง แอดมิน' })).toBeInTheDocument();
    expect(screen.getByText('@pueng')).toBeInTheDocument();
    expect(screen.getByText('DASHBOARD_VIEW')).toBeInTheDocument();
    expect(screen.getByText(/สิทธิ์ทั้งหมด 2 รายการ/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /เปลี่ยนรหัสผ่าน/ })).toHaveAttribute('href', '/account/change-password');
  });
});
