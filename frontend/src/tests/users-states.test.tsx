import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

/**
 * ทดสอบสถานะ loading / error ของหน้า Users แบบ deterministic
 * โดย mock useQuery เพื่อควบคุมสถานะโดยตรง (ไม่พึ่ง async ของ React Query)
 */
const store = vi.hoisted(() => ({
  user: null as AuthUser | null,
  query: {} as Record<string, unknown>,
}));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: () => store.query };
});

import UsersPage from '@/pages/UsersPage';

describe('UsersPage states', () => {
  it('แสดง loading skeleton ระหว่างโหลด', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    store.query = { data: undefined, isLoading: true, isError: false, isFetching: true, refetch: vi.fn() };
    const { container } = renderWithProviders(<UsersPage />, { route: '/users' });
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('แสดง error state พร้อมปุ่มลองอีกครั้ง', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    store.query = { data: undefined, isLoading: false, isError: true, error: new Error('เครือข่ายขัดข้อง'), isFetching: false, refetch: vi.fn() };
    renderWithProviders(<UsersPage />, { route: '/users' });
    expect(screen.getByText('โหลดข้อมูลไม่สำเร็จ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ลองอีกครั้ง/ })).toBeInTheDocument();
  });
});
