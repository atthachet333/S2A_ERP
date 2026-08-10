import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CookieConsent, { COOKIE_KEY } from '@/components/CookieConsent';

describe('CookieConsent gate', () => {
  beforeEach(() => localStorage.clear());

  it('blocks first visit and cannot be dismissed by backdrop or Escape', () => {
    render(<CookieConsent />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByTestId('cookie-backdrop'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog).toBeInTheDocument();
    expect(document.body).toHaveClass('cookie-gated');
  });

  it('stores Accept All and Essential Only decisions', () => {
    const { unmount } = render(<CookieConsent />);
    fireEvent.click(screen.getByRole('button', { name: 'ยอมรับทั้งหมด' }));
    expect(JSON.parse(localStorage.getItem(COOKIE_KEY)!).preferences).toBe(true);
    unmount(); localStorage.clear();
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole('button', { name: 'เฉพาะที่จำเป็น' }));
    const stored = JSON.parse(localStorage.getItem(COOKIE_KEY)!);
    expect(stored).toMatchObject({ version: 1, essential: true, preferences: false });
  });

  it('does not gate after consent and can reopen settings', () => {
    localStorage.setItem(COOKIE_KEY, JSON.stringify({ version: 1, essential: true, preferences: false, acceptedAt: new Date().toISOString() }));
    render(<CookieConsent />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent(window, new Event('s2a:cookie-settings'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
