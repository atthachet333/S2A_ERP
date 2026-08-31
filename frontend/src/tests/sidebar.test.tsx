import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

const store = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));

import Sidebar from '@/components/layout/Sidebar';
import { NAV_GROUPS } from '@/components/layout/nav-config';

describe('Sidebar', () => {
  it('แสดงโลโก้จริงและชื่อระบบ', () => {
    store.user = makeUser();
    renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);
    const logo = screen.getByAltText('โลโก้ S2 Accounting Consultant') as HTMLImageElement;
    expect(logo).toBeInTheDocument();
    expect(logo.getAttribute('src')).toContain('s2a-logo.png');
    expect(screen.getByText(/S2 ACCOUNTING/)).toBeInTheDocument();
    expect(screen.getByText(/CONSULTANT/)).toBeInTheDocument();
    expect(screen.getByText('PRODUCTION & INVENTORY')).toBeInTheDocument();
  });

  it('SUPER_ADMIN เห็นเมนูผู้ใช้งานและตั้งค่าระบบ', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);
    expect(screen.getByText('ผู้ใช้งาน')).toBeInTheDocument();
    expect(screen.getByText('ตั้งค่าระบบ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ภาพรวม' })).toBeInTheDocument();
  });

  it('ผู้ใช้ที่ไม่มีสิทธิ์ผู้ดูแล ไม่เห็นเมนูฝั่งผู้ดูแลเลย', () => {
    store.user = makeUser({ roles: ['OPERATIONS'], permissions: ['DASHBOARD_VIEW'] });
    renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);
    expect(screen.queryByText('ผู้ใช้งาน')).not.toBeInTheDocument();
    expect(screen.queryByText('บทบาทและสิทธิ์')).not.toBeInTheDocument();
    expect(screen.queryByText('ประวัติการใช้งาน')).not.toBeInTheDocument();
    expect(screen.getByText('วัตถุดิบ')).toBeInTheDocument();
    expect(screen.getByText('บรรจุภัณฑ์')).toBeInTheDocument();
  });

  it('PHASE 9 — ผู้ที่มี USER_MANAGE เห็นเมนูผู้ใช้ได้ แต่ประวัติการใช้งานยังเป็นของ SUPER_ADMIN', () => {
    // เมนูถูกปรับให้ตรงกับสิทธิ์ที่ backend ยอมให้เข้าจริง (GET /users รับ USER_VIEW|USER_MANAGE)
    store.user = makeUser({ roles: ['ADMIN'], permissions: ['DASHBOARD_VIEW', 'USER_MANAGE'] });
    renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);
    expect(screen.getByText('ผู้ใช้งาน')).toBeInTheDocument();
    expect(screen.getByText('คำขอสมัครใช้งาน')).toBeInTheDocument();
    // /activity ยังเป็น SUPER_ADMIN เท่านั้นตาม activity.route.ts
    expect(screen.queryByText('ประวัติการใช้งาน')).not.toBeInTheDocument();
  });

  it('PHASE 34 — จัดกลุ่มเมนูใหม่ ไม่มีกลุ่มไหนยาวเกิน 8 รายการ', () => {
    // เดิมกลุ่ม "คลังสินค้าและปฏิบัติการ" มี 15 เมนูในกลุ่มเดียว หาเมนูไม่เจอ
    for (const group of NAV_GROUPS) {
      expect(group.items.length, group.label).toBeLessThanOrEqual(8);
    }
  });

  it('PHASE 34 — ทุกกลุ่มมีหัวข้อที่กดพับได้ และพับแล้วเมนูข้างในหายไป', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);

    const toggle = screen.getByRole('button', { name: /จัดซื้อ/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('ใบสั่งซื้อ')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('ใบสั่งซื้อ')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText('ใบสั่งซื้อ')).toBeInTheDocument();
  });

  it('PHASE 34 — สถานะพับถูกจำไว้ใน localStorage', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    const { unmount } = renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /จัดซื้อ/ }));
    expect(localStorage.getItem('s2a_sidebar_groups_collapsed')).toContain('จัดซื้อ');
    unmount();

    renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={() => {}} />);
    expect(screen.queryByText('ใบสั่งซื้อ')).not.toBeInTheDocument();
    localStorage.removeItem('s2a_sidebar_groups_collapsed');
  });

  it('PHASE 34 — ทุก path ในเมนูยังมี route จริงใน App', () => {
    // กันการจัดกลุ่มใหม่ทำเมนูหลุดหายหรือชี้ไปหน้าที่ไม่มีอยู่
    const paths = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.path));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(34);
  });

  it('มีปุ่มออกจากระบบและเรียก callback เมื่อคลิก', () => {
    store.user = makeUser();
    const onLogout = vi.fn();
    const { getByRole } = renderWithProviders(<Sidebar collapsed={false} onNavigate={() => {}} onLogout={onLogout} />);
    getByRole('button', { name: /ออกจากระบบ/ }).click();
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
