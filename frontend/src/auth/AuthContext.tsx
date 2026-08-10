import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiClient, sessionStore } from '@/lib/api-client';

export interface AuthCompany { id: string; code: string; nameTh: string; nameEn: string | null; logoUrl: string | null; role: string; isDefault: boolean }
export interface AuthUser { id: string; username: string; email: string; fullName: string; mustChangePassword: boolean; roles: string[]; permissions: string[]; companies: AuthCompany[]; activeCompany: AuthCompany | null; defaultLandingPage: string; lastLoginAt: string | null; createdAt: string; updatedAt: string }
interface LoginResult { accessToken: string; refreshToken: string; user: AuthUser }
interface AuthContextValue { user: AuthUser | null; loading: boolean; login: (username: string, password: string) => Promise<AuthUser>; logout: () => Promise<void>; changePassword: (currentPassword: string, newPassword: string) => Promise<void>; selectCompany: (companyId: string) => Promise<AuthUser> }
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!sessionStore.accessToken() && !sessionStore.refreshToken()) { setLoading(false); return; }
    apiClient.get<AuthUser>('/auth/me').then(setUser).catch(() => sessionStore.clear()).finally(() => setLoading(false));
  }, []);
  const value = useMemo<AuthContextValue>(() => ({
    user, loading,
    login: async (username, password) => { const result = await apiClient.post<LoginResult>('/auth/login', { username, password }, { token: null }); sessionStore.save(result.accessToken, result.refreshToken); setUser(result.user); return result.user; },
    logout: async () => { const refreshToken = sessionStore.refreshToken(); try { await apiClient.post('/auth/logout', refreshToken ? { refreshToken } : undefined, { token: null }); } finally { sessionStore.clear(); setUser(null); } },
    changePassword: async (currentPassword, newPassword) => {
      const result = await apiClient.post<LoginResult>('/auth/change-password', { currentPassword, newPassword });
      sessionStore.save(result.accessToken, result.refreshToken);
      setUser(result.user);
    },
    selectCompany: async (companyId) => {
      const result = await apiClient.post<{ accessToken: string; user: AuthUser }>('/auth/select-company', { companyId });
      sessionStore.saveCompany(result.accessToken, companyId);
      setUser(result.user);
      return result.user;
    },
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used inside AuthProvider'); return value; }
