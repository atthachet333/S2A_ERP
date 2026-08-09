import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './test-utils';

const auth = vi.hoisted(() => ({ logout: vi.fn(), changePassword: vi.fn() }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: { fullName: 'วิน ผู้ดูแล', username: 'win', mustChangePassword: true }, logout: auth.logout, changePassword: auth.changePassword }) }));

import PasswordExperience from '@/components/auth/PasswordExperience';

describe('Change password switch account', () => {
  it('แสดงปุ่มใช้บัญชีอื่นใต้ข้อมูลบัญชี', () => {
    renderWithProviders(<PasswordExperience />, { route: '/change-password' });
    expect(screen.getByText('ไม่ใช่บัญชีของคุณ?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ใช้บัญชีอื่น/ })).toBeInTheDocument();
  });

  it('เรียก logout และไปหน้า login เมื่อเลือกใช้บัญชีอื่น', async () => {
    auth.logout.mockResolvedValueOnce(undefined);
    renderWithProviders(<Routes><Route path="/change-password" element={<PasswordExperience />} /><Route path="/login" element={<div>LOGIN DESTINATION</div>} /></Routes>, { route: '/change-password' });
    fireEvent.click(screen.getByRole('button', { name: /ใช้บัญชีอื่น/ }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('LOGIN DESTINATION')).toBeInTheDocument();
  });

  it('ไม่ทำให้ผู้ใช้ติดค้างแม้ backend logout ล้มเหลว', async () => {
    auth.logout.mockRejectedValueOnce(new Error('network'));
    renderWithProviders(<Routes><Route path="/change-password" element={<PasswordExperience />} /><Route path="/login" element={<div>LOGIN AFTER ERROR</div>} /></Routes>, { route: '/change-password' });
    fireEvent.click(screen.getByRole('button', { name: /ใช้บัญชีอื่น/ }));
    expect(await screen.findByText('LOGIN AFTER ERROR')).toBeInTheDocument();
  });
});
