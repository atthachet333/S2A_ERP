import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from './test-utils';
import { I18nProvider, LOCALE_KEY, type Locale } from '@/i18n/i18n';
import { homeContent } from '@/i18n/home-content';

const loginMock = vi.hoisted(() => vi.fn());
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: null, login: loginMock }) }));

import HomePage from '@/pages/HomePage';
import LoginExperience from '@/components/auth/LoginExperience';

afterEach(() => localStorage.removeItem(LOCALE_KEY));

describe('Homepage', () => {
  const renderLocale = (locale: Locale) => {
    localStorage.setItem(LOCALE_KEY, locale);
    return renderWithProviders(<I18nProvider><HomePage /></I18nProvider>, { route: '/' });
  };

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

  it.each([
    ['th','ทุกอย่างที่ร้านอาหารต้องใช้ ในระบบเดียว','เริ่มใช้งานได้ใน 7 ขั้นตอน','เปลี่ยนการเดาต้นทุน ให้เป็นตัวเลขที่เชื่อถือได้','แดชบอร์ดที่บอกทุกอย่างในหน้าเดียว','จากต้นทุนทุกบาท สู่ราคาขายที่ทำกำไร'],
    ['en','Everything a food business needs, in one system','Get started in 7 steps','Turn cost estimates into reliable numbers','One dashboard tells the whole story','Turn every baht of cost into a profitable selling price'],
    ['zh-CN','餐饮企业所需功能，尽在一个系统','7 步即可开始使用','将成本估算转化为可信数据','一个仪表板掌握全部信息','让每一泰铢成本转化为可盈利的售价'],
  ] as const)('renders every major Homepage section in %s', (locale, features, workflow, benefits, kpi, profit) => {
    renderLocale(locale);
    [features, workflow, benefits, kpi, profit].forEach((text) => expect(screen.getByText(text)).toBeInTheDocument());
    expect(screen.getAllByTestId('home-feature')).toHaveLength(7);
    expect(screen.getAllByTestId('home-workflow-step')).toHaveLength(7);
    expect(screen.getAllByTestId('home-benefit')).toHaveLength(6);
  });

  it('keeps Homepage collection lengths identical across locales', () => {
    const locales: Locale[] = ['th','en','zh-CN'];
    expect(new Set(locales.map((locale)=>homeContent[locale].features.length))).toEqual(new Set([7]));
    expect(new Set(locales.map((locale)=>homeContent[locale].steps.length))).toEqual(new Set([7]));
    expect(new Set(locales.map((locale)=>homeContent[locale].why.length))).toEqual(new Set([6]));
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
    expect(screen.getByText(/เข้าสู่พื้นที่ทำงานของคุณ/)).toBeInTheDocument();
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
