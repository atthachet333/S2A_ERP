import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

const store = vi.hoisted(() => ({ user: null as AuthUser | null }));
const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: apiGet } }));

import UsersPage from '@/pages/UsersPage';

const sampleUsers = [
  { id: '1', username: 'win', fullName: 'วิน ผู้ดูแล', email: 'win@s2a.co', isActive: true, mustChangePassword: false, roles: ['SUPER_ADMIN'], company: { id: 'c1', nameTh: 'ครัวสดดี' }, lastLoginAt: '2026-08-06T02:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: '2', username: 'pueng', fullName: 'ปึ้ง แอดมิน', email: 'pueng@s2a.co', isActive: false, mustChangePassword: true, roles: ['ADMIN'], company: { id: 'c1', nameTh: 'ครัวสดดี' }, lastLoginAt: null, createdAt: '2026-02-01T00:00:00.000Z' },
];

describe('UsersPage', () => {
  beforeEach(() => apiGet.mockReset());

  it('ผู้ใช้ที่ไม่ใช่ SUPER_ADMIN เห็นหน้าไม่มีสิทธิ์', () => {
    store.user = makeUser({ roles: ['ADMIN'], permissions: [] });
    renderWithProviders(<UsersPage />, { route: '/users' });
    expect(screen.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeInTheDocument();
  });

  it('แสดงตารางผู้ใช้จาก API พร้อม badge บทบาทและสถานะ', async () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    apiGet.mockResolvedValue(sampleUsers);
    renderWithProviders(<UsersPage />, { route: '/users' });
    expect(await screen.findByText('วิน ผู้ดูแล')).toBeInTheDocument();
    expect(screen.getByText('ปึ้ง แอดมิน')).toBeInTheDocument();
    expect(screen.getByText('2 รายการ')).toBeInTheDocument();
    // Phase 9 — ตารางแสดงชื่อบทบาทเป็นภาษาไทย (โค้ดจริงยังเห็นได้ในหน้าจัดการสิทธิ์)
    expect(screen.getAllByText('ผู้ดูแลระบบสูงสุด').length).toBeGreaterThan(0);
  });

  it('แสดง empty state เมื่อไม่มีผู้ใช้', async () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    apiGet.mockResolvedValue([]);
    renderWithProviders(<UsersPage />, { route: '/users' });
    expect(await screen.findByText('ยังไม่มีผู้ใช้งาน')).toBeInTheDocument();
  });
});
