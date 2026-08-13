/* eslint-disable react-refresh/only-export-components -- provider module also exports theme utilities */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * ระบบธีม light / dark / system
 * - เก็บค่าเลือกไว้ใน localStorage (คงอยู่หลังรีเฟรช)
 * - ถ้ายังไม่เคยเลือก ใช้ค่าตามระบบ (prefers-color-scheme)
 * - ตั้งคลาส `dark` บน <html> (Tailwind darkMode:'class') + colorScheme ให้ native controls
 */
export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 's2a.theme';
const prefersDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
const resolve = (c: ThemeChoice): 'light' | 'dark' => (c === 'system' ? (prefersDark() ? 'dark' : 'light') : c);

export function readThemeChoice(): ThemeChoice {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}
export function applyTheme(choice: ThemeChoice) {
  const mode = resolve(choice);
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
}
// ใช้ธีมทันทีตอน import (ก่อน React render) เพื่อลดการกระพริบ (FOUC)
if (typeof document !== 'undefined') applyTheme(readThemeChoice());

interface ThemeCtx { theme: ThemeChoice; resolved: 'light' | 'dark'; setTheme: (c: ThemeChoice) => void; toggle: () => void }
const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readThemeChoice);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(readThemeChoice()));

  const setTheme = useCallback((c: ThemeChoice) => {
    localStorage.setItem(KEY, c);
    setThemeState(c);
  }, []);
  const toggle = useCallback(() => setTheme(resolved === 'dark' ? 'light' : 'dark'), [resolved, setTheme]);

  // ใช้ธีมกับ <html> ทุกครั้งที่ค่าเปลี่ยน + ตอน mount (รองรับค่าที่บันทึกไว้)
  useEffect(() => { applyTheme(theme); setResolved(resolve(theme)); }, [theme]);

  // ติดตามการเปลี่ยนธีมของระบบเมื่อผู้ใช้เลือกโหมด 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { applyTheme('system'); setResolved(resolve('system')); };
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [theme]);

  const value = useMemo(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used within ThemeProvider');
  return v;
}
