/**
 * API Client กลาง — จุดเดียวสำหรับเรียก Backend
 * ห้ามเขียน URL backend กระจายในหลายไฟล์ ให้เรียกผ่านที่นี่เท่านั้น
 * base URL มาจาก VITE_API_URL (ค่าเริ่มต้น "/api" — ผ่าน Vite proxy ไป :1415)
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiError;

/** error ที่ throw ออกมาเมื่อ API ตอบไม่สำเร็จ */
export class ApiClientError extends Error {
  code: string;
  details?: unknown;
  status: number;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  token?: string | null;
}

const ACCESS_KEY = 's2a_access_token';
const REFRESH_KEY = 's2a_refresh_token';
const COMPANY_KEY = 's2a_company_id';
export const sessionStore = {
  accessToken: () => localStorage.getItem(ACCESS_KEY),
  refreshToken: () => localStorage.getItem(REFRESH_KEY),
  save: (accessToken: string, refreshToken: string) => { localStorage.setItem(ACCESS_KEY, accessToken); localStorage.setItem(REFRESH_KEY, refreshToken); },
  companyId: () => localStorage.getItem(COMPANY_KEY),
  saveCompany: (accessToken: string, companyId: string) => { localStorage.setItem(ACCESS_KEY, accessToken); localStorage.setItem(COMPANY_KEY, companyId); },
  clear: () => { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY); localStorage.removeItem(COMPANY_KEY); },
};

async function request<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const { body, token, headers, ...rest } = options;
  const accessToken = token === undefined ? sessionStore.accessToken() : token;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // response ไม่ใช่ JSON
    throw new ApiClientError('INTERNAL_ERROR', 'รูปแบบข้อมูลตอบกลับไม่ถูกต้อง', res.status);
  }

  if (!payload.success) {
    const refreshToken = sessionStore.refreshToken();
    const mayRefresh = res.status === 401 && !retried && Boolean(refreshToken) && path !== '/auth/refresh' && path !== '/auth/login';
    if (mayRefresh) {
      try {
        const refreshed = await request<{ accessToken: string; refreshToken: string }>('/auth/refresh', { method: 'POST', body: { refreshToken, companyId: sessionStore.companyId() ?? undefined }, token: null }, true);
        sessionStore.save(refreshed.accessToken, refreshed.refreshToken);
        return request<T>(path, options, true);
      } catch {
        sessionStore.clear();
      }
    }
    throw new ApiClientError(
      payload.error.code,
      payload.error.message,
      res.status,
      payload.error.details,
    );
  }

  return payload.data;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  blob: async (path: string) => {
    const res = await fetch(`${BASE_URL}${path}`, { headers: sessionStore.accessToken() ? { Authorization: `Bearer ${sessionStore.accessToken()}` } : {} });
    if (!res.ok) throw new ApiClientError('DOWNLOAD_FAILED', 'ไม่สามารถสร้างเอกสารได้', res.status);
    return res.blob();
  },
};
