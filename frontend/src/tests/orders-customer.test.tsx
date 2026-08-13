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

import OrdersPage from '@/pages/OrdersPage';

describe('OrdersPage — inline customer create + auto-select', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPost.mockReset();
    store.user = makeUser({ permissions: ['ORDER_VIEW', 'ORDER_CREATE', 'CUSTOMER_CREATE'] });
    store.customers = [{ id: '1', code: 'A0001', name: 'บริษัท แอลเอส จำกัด', phone: '090-662-5464' }];
    apiGet.mockImplementation((url: string) => Promise.resolve(url.includes('/customers') ? store.customers : []));
  });

  it('creates a customer from the order page and auto-selects it', async () => {
    apiPost.mockImplementation((url: string, body: { name: string }) => {
      const created = { id: '9', code: 'CUS-00009', name: body.name };
      if (url.includes('/customers')) store.customers = [...store.customers, created];
      return Promise.resolve(created);
    });
    renderWithProviders(<OrdersPage />, { route: '/orders' });

    // เปิดฟอร์มสร้างออเดอร์
    fireEvent.click(await screen.findByRole('button', { name: /สร้างออเดอร์/ }));
    // เปิด dropdown ลูกค้า และเห็นลูกค้าเดิม
    fireEvent.click(screen.getByRole('button', { name: 'ลูกค้า' }));
    expect(await screen.findByText('บริษัท แอลเอส จำกัด')).toBeInTheDocument();
    // เปิด quick add
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มลูกค้าใหม่/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // กรอกชื่อและบันทึก
    fireEvent.change(screen.getByLabelText(/ชื่อลูกค้า/), { target: { value: 'ร้านใหม่' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกลูกค้า' }));
    // ลูกค้าใหม่ถูกเลือกเข้าออเดอร์ (แสดงบนปุ่ม combobox)
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/business/customers', expect.objectContaining({ name: 'ร้านใหม่' })));
    expect(await screen.findByText('ร้านใหม่')).toBeInTheDocument();
  });
});
