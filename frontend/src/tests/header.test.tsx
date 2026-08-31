import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

const store = vi.hoisted(() => ({ user: null as AuthUser | null, health: {} as Record<string, unknown> }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@/hooks/useHealth', () => ({ useHealth: () => store.health }));

import Header from '@/components/layout/Header';
import { navGroupLabelForPath } from '@/components/layout/nav-config';

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

  it('เพิ่ม scrolled state เมื่อ window เลื่อนเกิน threshold', () => {
    store.user = makeUser(); store.health = { data: undefined, isLoading: true, isError: false };
    Object.defineProperty(window, 'scrollY', { value: 24, writable: true, configurable: true });
    const { container } = renderWithProviders(<Header onToggleSidebar={noop} onOpenDrawer={noop} onLogout={noop} />);
    fireEvent.scroll(window);
    expect(container.querySelector('.app-header')).toHaveClass('app-header--scrolled');
    window.scrollY = 0; fireEvent.scroll(window);
    expect(container.querySelector('.app-header')).not.toHaveClass('app-header--scrolled');
  });
});

/* ============================================================
   PHASE 34 — breadcrumb ต้องบอกกลุ่มจริงที่เมนูสังกัดอยู่
   ยืนยันจากภาพหน้าจอจริง: หน้า /dashboard เคยขึ้นว่า "ระบบ > ภาพรวม"
   ทั้งที่ภาพรวมไม่ได้อยู่ในกลุ่ม "ระบบ"
   ============================================================ */
describe('PHASE 34 — breadcrumb group', () => {
  it('จับคู่ path เข้ากับกลุ่มที่ถูกต้องใน NAV_GROUPS', () => {
    expect(navGroupLabelForPath('/dashboard')).toBe('ภาพรวม');
    expect(navGroupLabelForPath('/ingredients')).toBe('ต้นทุนและสูตร');
    expect(navGroupLabelForPath('/orders')).toBe('การขายและลูกค้า');
    expect(navGroupLabelForPath('/purchase-orders')).toBe('จัดซื้อ');
    expect(navGroupLabelForPath('/production')).toBe('การผลิต');
    expect(navGroupLabelForPath('/activity')).toBe('การตรวจสอบระบบ');
  });

  it('เลือก prefix ที่ยาวที่สุด ไม่ให้หน้าลูกตกไปอยู่กลุ่มของหน้าแม่', () => {
    // /inventory อยู่กลุ่ม "สินค้าและคลัง" ส่วน /inventory/valuation อยู่ "รายงานและวิเคราะห์"
    expect(navGroupLabelForPath('/inventory')).toBe('สินค้าและคลัง');
    expect(navGroupLabelForPath('/inventory/valuation')).toBe('รายงานและวิเคราะห์');
    expect(navGroupLabelForPath('/inventory/valuation/history')).toBe('รายงานและวิเคราะห์');
  });

  it('path ที่ไม่มีในเมนู คืนค่าว่าง เพื่อให้หัวเว็บถอยไปใช้ค่าสำรองเดิม', () => {
    expect(navGroupLabelForPath('/profile')).toBeUndefined();
  });

  it('ไม่มีหน้าไหนถูกบังคับให้เป็นกลุ่ม "ระบบ" อีก', () => {
    const forced = ['/dashboard', '/ingredients', '/recipes', '/orders', '/customers', '/production']
      .filter((path) => navGroupLabelForPath(path) === 'ระบบ');
    expect(forced).toEqual([]);
  });
});

/* PHASE 34 — ยืนยันจากภาพหน้าจอจริงที่ 1559px:
   หัวเว็บขึ้น "ภาพรวม > ภาพรวม" เพราะชื่อกลุ่มกับชื่อหน้าเป็นคำเดียวกัน */
describe('PHASE 34 — breadcrumb ไม่ซ้ำชื่อหน้า', () => {
  it('ซ่อน breadcrumb เมื่อชื่อกลุ่มตรงกับชื่อหน้า', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    store.health = { data: undefined, isLoading: true, isError: false };
    renderWithProviders(<Header onToggleSidebar={noop} onOpenDrawer={noop} onLogout={noop} />, { route: '/dashboard' });
    // ชื่อหน้ายังอยู่ครบ แต่ไม่มีแถบ breadcrumb ซ้ำคำเดิม
    expect(screen.getByRole('heading', { level: 1, name: 'ภาพรวม' })).toBeInTheDocument();
    expect(screen.queryByLabelText('เส้นทาง')).not.toBeInTheDocument();
  });

  it('ยังแสดง breadcrumb เมื่อกลุ่มกับชื่อหน้าต่างกัน', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    store.health = { data: undefined, isLoading: true, isError: false };
    renderWithProviders(<Header onToggleSidebar={noop} onOpenDrawer={noop} onLogout={noop} />, { route: '/ingredients' });
    expect(screen.getByLabelText('เส้นทาง')).toHaveTextContent('ต้นทุนและสูตร');
  });
});
