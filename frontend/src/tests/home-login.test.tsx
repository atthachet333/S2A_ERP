import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from './test-utils';

const loginMock = vi.hoisted(() => vi.fn());
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: null, login: loginMock }) }));

import HomePage from '@/pages/HomePage';
import LoginExperience from '@/components/auth/LoginExperience';

describe('Homepage', () => {
  it('แสดง headline หลักและปุ่มเข้าสู่ระบบชี้ไป /login', () => {
    renderWithProviders(<HomePage />, { route: '/' });
    expect(screen.getByRole('heading', { name: /ระบบคิดคำนวณต้นทุนและคิดคำนวณสูตรเมนูอาหาร/ })).toBeInTheDocument();
    const loginLinks = screen.getAllByRole('link', { name: /เข้าสู่ระบบ/ });
    expect(loginLinks.length).toBeGreaterThan(0);
    loginLinks.forEach((link) => expect(link).toHaveAttribute('href', '/login'));
  });

  it('มีเมนูนำทางและ CTA ดูการทำงานของระบบ', () => {
    renderWithProviders(<HomePage />, { route: '/' });
    const aboutLinks = screen.getAllByRole('link', { name: 'เกี่ยวกับระบบ' });
    expect(aboutLinks.length).toBeGreaterThan(0);
    aboutLinks.forEach((link) => expect(link).toHaveAttribute('href', '#about'));
    expect(screen.getByRole('link', { name: /ดูการทำงานของระบบ/ })).toHaveAttribute('href', '#process');
  });
});

describe('Login', () => {
  it('มีปุ่มกลับหน้าหลักที่ชี้ไป /', () => {
    renderWithProviders(<LoginExperience />, { route: '/login' });
    expect(screen.getByRole('link', { name: /กลับหน้าหลัก/ })).toHaveAttribute('href', '/');
  });

  it('แสดงฟอร์มเข้าสู่ระบบพร้อม subtitle ที่กระชับ', () => {
    renderWithProviders(<LoginExperience />, { route: '/login' });
    expect(screen.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeInTheDocument();
    expect(screen.getByText('เข้าสู่พื้นที่ทำงานของคุณ')).toBeInTheDocument();
  });
  it('มีลิงก์ลืมรหัสผ่าน', () => {
    renderWithProviders(<LoginExperience />, { route: '/login' });
    expect(screen.getByRole('link', { name: 'ลืมรหัสผ่าน?' })).toHaveAttribute('href', '/forgot-password');
  });
  it('แสดงสถานะกำลังเข้าสู่ระบบระหว่างรอ Auth', async () => {
    loginMock.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<LoginExperience />, { route: '/login' });
    fireEvent.change(screen.getByPlaceholderText('กรอกชื่อผู้ใช้'), { target: { value: 'win' } });
    fireEvent.change(screen.getByPlaceholderText('กรอกรหัสผ่าน'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /เข้าสู่ระบบ/ }));
    expect(await screen.findByRole('button', { name: /กำลังเข้าสู่ระบบ/ })).toBeDisabled();
  });
});
