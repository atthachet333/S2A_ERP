import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { ThemeProvider } from '@/theme/ThemeContext';
import type { AuthUser } from '@/auth/AuthContext';

/** ผู้ใช้ตัวอย่างสำหรับเทสต์ (ปรับ role ได้) */
export function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1', username: 'win', email: 'win@s2a.co', fullName: 'วิน ผู้ดูแล',
    mustChangePassword: false, roles: ['SUPER_ADMIN'], permissions: ['DASHBOARD_VIEW', 'USER_MANAGE'],
    companies: [], activeCompany: null, defaultLandingPage: '/admin',
    lastLoginAt: '2026-08-06T02:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** render พร้อม Providers ที่จำเป็น (Query + Router + Toast) */
export function renderWithProviders(ui: ReactElement, { route = '/dashboard' }: { route?: string } = {}) {
  // onError no-op: กัน RQ โยน unhandled rejection ระหว่างเทสต์ error state
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    queryCache: new QueryCache({ onError: () => {} }),
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>
          <ToastProvider>{children}</ToastProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
