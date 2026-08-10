import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider, LOCALE_KEY, useI18n } from '@/i18n/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';

function Probe() { const { messages } = useI18n(); return <><LanguageSwitcher/><span>{messages.auth.signIn}</span></>; }

describe('internationalization foundation', () => {
  beforeEach(() => localStorage.clear());
  it('honors a saved Thai preference', () => { localStorage.setItem(LOCALE_KEY, 'th'); render(<I18nProvider><Probe/></I18nProvider>); expect(screen.getByText('เข้าสู่ระบบ')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('th'); });
  it('switches to English and persists the locale', () => { render(<I18nProvider><Probe/></I18nProvider>); fireEvent.click(screen.getByRole('button', { name: 'EN' })); expect(screen.getByText('Sign in')).toBeInTheDocument(); expect(localStorage.getItem(LOCALE_KEY)).toBe('en'); expect(document.documentElement.lang).toBe('en'); });
  it('switches to Simplified Chinese', () => { render(<I18nProvider><Probe/></I18nProvider>); fireEvent.click(screen.getByRole('button', { name: '中文' })); expect(screen.getByText('登录')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('zh-CN'); });
});
