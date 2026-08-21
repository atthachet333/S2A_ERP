import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

type C = { id: string; code: string; name: string; phone?: string };
const store = vi.hoisted(() => ({ user: null as AuthUser | null, customers: [] as C[] }));
const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: apiGet, post: apiPost, blob: vi.fn() } }));

import OrderWorkspacePage from '@/pages/orders/OrderWorkspacePage';

/**
 * PHASE 8 — flow เดิมที่ต้องไม่พังหลังย้ายมาหน้าสร้างออเดอร์ใหม่
 * เพิ่มลูกค้าด่วนจากในหน้าสร้างออเดอร์ แล้วต้องถูกเลือกเข้าออเดอร์ให้ทันที
 */
describe('OrderWorkspacePage — เพิ่มลูกค้าด่วนแล้วเลือกให้อัตโนมัติ', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPost.mockReset();
    store.user = makeUser({ permissions: ['ORDER_VIEW', 'ORDER_CREATE', 'CUSTOMER_CREATE'] });
    store.customers = [{ id: '1', code: 'A0001', name: 'บริษัท แอลเอส จำกัด', phone: '090-662-5464' }];
    apiGet.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/customers') ? store.customers : []));
  });

  it('สร้างลูกค้าจากหน้าออเดอร์แล้วถูกเลือกให้ทันที', async () => {
    apiPost.mockImplementation((url: string, body: { name: string }) => {
      const created = { id: '9', code: 'CUS-00009', name: body.name };
      if (url.includes('/customers')) store.customers = [...store.customers, created];
      return Promise.resolve(created);
    });
    renderWithProviders(<OrderWorkspacePage />, { route: '/orders/new' });

    // ตัวเลือกลูกค้าเปิดอยู่ตั้งแต่แรกเมื่อยังไม่ได้เลือกใคร
    expect(await screen.findByText(/บริษัท แอลเอส จำกัด/)).toBeInTheDocument();

    // เปิดฟอร์มเพิ่มลูกค้าด่วนจากท้ายรายการ
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มลูกค้า/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/ชื่อลูกค้า/), { target: { value: 'ร้านใหม่' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกลูกค้า' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/business/customers', expect.objectContaining({ name: 'ร้านใหม่' })));
    // ลูกค้าใหม่ถูกเลือกเข้าออเดอร์ → เห็นการ์ดสรุปลูกค้าพร้อมปุ่มเปลี่ยนลูกค้า
    expect(await screen.findByRole('button', { name: 'เปลี่ยนลูกค้า' })).toBeInTheDocument();
  });

  it('ไม่มีสิทธิ์เพิ่มลูกค้า → ไม่แสดงปุ่มเพิ่มลูกค้า', async () => {
    store.user = makeUser({ roles: ['OPERATIONS'], permissions: ['ORDER_VIEW', 'ORDER_CREATE'] });
    renderWithProviders(<OrderWorkspacePage />, { route: '/orders/new' });
    expect(await screen.findByText(/บริษัท แอลเอส จำกัด/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เพิ่มลูกค้า/ })).not.toBeInTheDocument();
  });

  it('ไม่มีสิทธิ์สร้างออเดอร์ → เห็นข้อความแทนฟอร์ม', async () => {
    store.user = makeUser({ roles: ['OPERATIONS'], permissions: ['ORDER_VIEW'] });
    renderWithProviders(<OrderWorkspacePage />, { route: '/orders/new' });
    expect(await screen.findByText('ไม่มีสิทธิ์สร้างออเดอร์')).toBeInTheDocument();
  });
});
