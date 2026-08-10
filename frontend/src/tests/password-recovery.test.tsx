import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './test-utils';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiClient: { post } }));
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/PasswordRecoveryPages';

describe('password recovery pages', () => {
  beforeEach(() => post.mockReset());
  it('renders forgot password and always shows the neutral completion message', async () => {
    post.mockResolvedValue({ deliveryAvailable: false }); renderWithProviders(<ForgotPasswordPage />, { route: '/forgot-password' });
    fireEvent.change(screen.getByRole('textbox', { name: /Username หรือ Email/ }), { target: { value: 'unknown@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'ดำเนินการต่อ' }));
    expect(await screen.findByText(/หากข้อมูลตรงกับบัญชีในระบบ/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/auth/forgot-password', { identifier: 'unknown@example.com' }, { token: null });
  });
  it('validates matching reset passwords before calling the API', async () => {
    renderWithProviders(<ResetPasswordPage />, { route: '/reset-password?token=abcdefghijklmnopqrstuvwxyz' });
    const fields = screen.getAllByLabelText(/รหัสผ่าน/);
    fireEvent.change(fields[0], { target: { value: 'ValidReset123!' } }); fireEvent.change(fields[1], { target: { value: 'Different123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่ตรงกัน'); expect(post).not.toHaveBeenCalled();
  });
  it('submits a valid reset token and password', async () => {
    post.mockResolvedValue(null); renderWithProviders(<ResetPasswordPage />, { route: '/reset-password?token=abcdefghijklmnopqrstuvwxyz' });
    const fields = screen.getAllByLabelText(/รหัสผ่าน/); fireEvent.change(fields[0], { target: { value: 'ValidReset123!' } }); fireEvent.change(fields[1], { target: { value: 'ValidReset123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/reset-password', { token: 'abcdefghijklmnopqrstuvwxyz', newPassword: 'ValidReset123!' }, { token: null }));
  });
});
