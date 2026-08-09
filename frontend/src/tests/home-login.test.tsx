import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from './test-utils';

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: null, login: vi.fn() }),
}));

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
    expect(screen.getByText(/จัดการต้นทุน สูตรอาหาร วัตถุดิบ และราคาขาย/)).toBeInTheDocument();
  });
});
