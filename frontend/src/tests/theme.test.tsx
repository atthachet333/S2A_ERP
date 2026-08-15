import { describe, it, expect, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/theme/ThemeContext';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true, configurable: true,
    value: (query: string) => ({ matches, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
}

function Probe() {
  const { theme, resolved, setTheme, toggle } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.classList.remove('dark'); mockMatchMedia(false); });

  it('defaults to system and stays light when the OS prefers light', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('applies and persists dark mode', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('s2a.theme')).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('toggles back to light and removes the dark class', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText('dark'));
    fireEvent.click(screen.getByText('toggle'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('s2a.theme')).toBe('light');
  });

  it('honors a persisted dark choice on mount', () => {
    localStorage.setItem('s2a.theme', 'dark');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('switching theme is visual-only and preserves child form state', () => {
    function Form() {
      const { toggle } = useTheme();
      const [v, setV] = useState('');
      return (<><input aria-label="field" value={v} onChange={(e) => setV(e.target.value)} /><button onClick={toggle}>toggle</button></>);
    }
    render(<ThemeProvider><Form /></ThemeProvider>);
    fireEvent.change(screen.getByLabelText('field'), { target: { value: 'พริกไทย' } });
    fireEvent.click(screen.getByText('toggle'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect((screen.getByLabelText('field') as HTMLInputElement).value).toBe('พริกไทย');
  });

  it('system mode follows the OS dark preference', () => {
    mockMatchMedia(true);
    localStorage.setItem('s2a.theme', 'system');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
