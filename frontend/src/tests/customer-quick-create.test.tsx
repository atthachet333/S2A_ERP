import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from './test-utils';

const apiPost = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiClient: { post: apiPost } }));

import CustomerQuickCreateModal from '@/components/customers/CustomerQuickCreateModal';

describe('CustomerQuickCreateModal', () => {
  beforeEach(() => apiPost.mockReset());

  it('opens as a dialog with the quick-add title', () => {
    renderWithProviders(<CustomerQuickCreateModal onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('เพิ่มลูกค้าอย่างรวดเร็ว')).toBeInTheDocument();
  });

  it('requires only the customer name — blocks save when empty', () => {
    const onCreated = vi.fn();
    renderWithProviders(<CustomerQuickCreateModal onClose={() => {}} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกลูกค้า' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByText('กรุณากรอกชื่อลูกค้า')).toBeInTheDocument();
  });

  it('saves with only the name; optional fields may stay empty', async () => {
    apiPost.mockResolvedValue({ id: 'c9', code: 'CUS-00009', name: 'ร้านทดสอบ' });
    const onCreated = vi.fn();
    renderWithProviders(<CustomerQuickCreateModal onClose={() => {}} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/ชื่อลูกค้า/), { target: { value: 'ร้านทดสอบ' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกลูกค้า' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/business/customers', expect.objectContaining({ name: 'ร้านทดสอบ' }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'c9' }));
  });

  it('validates email format only when entered', () => {
    renderWithProviders(<CustomerQuickCreateModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText(/ชื่อลูกค้า/), { target: { value: 'ร้าน' } });
    fireEvent.change(screen.getByLabelText(/อีเมล/), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกลูกค้า' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.getByText('รูปแบบอีเมลไม่ถูกต้อง')).toBeInTheDocument();
  });

  it('shows the success toast after a successful save', async () => {
    apiPost.mockResolvedValue({ id: 'c9', code: 'CUS-00009', name: 'ร้านทดสอบ' });
    renderWithProviders(<CustomerQuickCreateModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText(/ชื่อลูกค้า/), { target: { value: 'ร้านทดสอบ' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกลูกค้า' }));
    expect(await screen.findByText('เพิ่มลูกค้าสำเร็จ')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderWithProviders(<CustomerQuickCreateModal onClose={onClose} onCreated={() => {}} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
