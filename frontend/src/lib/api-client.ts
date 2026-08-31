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
  blob: async (path: string, expect?: 'xlsx' | 'pdf') => {
    const res = await fetch(`${BASE_URL}${path}`, { headers: sessionStore.accessToken() ? { Authorization: `Bearer ${sessionStore.accessToken()}` } : {} });
    if (!res.ok) throw new ApiClientError('DOWNLOAD_FAILED', 'ไม่สามารถสร้างเอกสารได้', res.status);
    // ถ้าระบุชนิดไว้ ต้องได้ไบนารีจริง ไม่ใช่หน้า HTML จาก SPA fallback
    if (expect && !(res.headers.get('Content-Type') ?? '').toLowerCase().includes(EXPECTED_MIME[expect])) {
      throw new ApiClientError('DOWNLOAD_NOT_BINARY', 'เซิร์ฟเวอร์ไม่ได้ส่งเอกสารกลับมา', res.status);
    }
    return res.blob();
  },
  /**
   * ดาวน์โหลดไฟล์ไบนารี (xlsx / pdf) แล้วสั่งบันทึกลงเครื่อง
   *
   * PHASE 13 — เดิมหน้าส่งออก Excel เรียก fetch('/api/...') ตรง ๆ ด้วย path สัมพัทธ์
   * บน production เว็บถูกเสิร์ฟด้วย static server ที่มี SPA fallback
   * ทำให้ /api/... ตอบ 200 พร้อม index.html แทนไฟล์จริง
   * โค้ดเดิมเช็คแค่ res.ok จึงบันทึก HTML 564 ไบต์เป็นไฟล์ .xlsx → Excel เปิดไม่ได้
   *
   * ที่นี่จึงต้อง:
   *   1) ยิงผ่าน BASE_URL เดียวกับ API อื่นเสมอ
   *   2) ปฏิเสธถ้า content-type ไม่ใช่ไบนารีที่คาดไว้ (กันกรณี fallback ซ้ำ)
   *   3) ปฏิเสธถ้าไฟล์ว่าง
   */
  download: async (path: string, opts: { expect: 'xlsx' | 'pdf'; fallbackName: string }) => {
    const token = sessionStore.accessToken();
    const res = await fetch(`${BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiClientError('DOWNLOAD_FAILED', 'ดาวน์โหลดไฟล์ไม่สำเร็จ', res.status);

    const contentType = (res.headers.get('Content-Type') ?? '').toLowerCase();
    if (!contentType.includes(EXPECTED_MIME[opts.expect])) {
      throw new ApiClientError(
        'DOWNLOAD_NOT_BINARY',
        'เซิร์ฟเวอร์ไม่ได้ส่งไฟล์กลับมา (ตรวจการตั้งค่าที่อยู่ API)',
        res.status,
      );
    }

    const blob = await res.blob();
    if (blob.size === 0) throw new ApiClientError('DOWNLOAD_EMPTY', 'ไฟล์ที่ได้รับว่างเปล่า', res.status);

    const name = filenameFromDisposition(res.headers.get('Content-Disposition')) ?? opts.fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { name, size: blob.size, contentType };
  },
  downloadPost: async (path: string, body: unknown, opts: { expect: 'xlsx' | 'pdf'; fallbackName: string }) => {
    const token = sessionStore.accessToken();
    const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    if (!res.ok) throw new ApiClientError('DOWNLOAD_FAILED', 'ดาวน์โหลดไฟล์ไม่สำเร็จ', res.status);
    const contentType = (res.headers.get('Content-Type') ?? '').toLowerCase();
    if (!contentType.includes(EXPECTED_MIME[opts.expect])) throw new ApiClientError('DOWNLOAD_NOT_BINARY', 'เซิร์ฟเวอร์ไม่ได้ส่งไฟล์กลับมา', res.status);
    const blob = await res.blob(); if (blob.size === 0) throw new ApiClientError('DOWNLOAD_EMPTY', 'ไฟล์ที่ได้รับว่างเปล่า', res.status);
    const name = filenameFromDisposition(res.headers.get('Content-Disposition')) ?? opts.fallbackName, url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);return{name,size:blob.size,contentType};
  },
};

const EXPECTED_MIME: Record<'xlsx' | 'pdf', string> = {
  xlsx: 'spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * อ่านชื่อไฟล์จาก Content-Disposition
 * รองรับทั้ง filename="..." และ filename*=UTF-8''... (RFC 5987) สำหรับชื่อภาษาไทย
 */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const encoded = /filename\*=\s*UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try { return decodeURIComponent(encoded[1].trim()); } catch { /* ใช้ค่าถัดไปแทน */ }
  }
  const plain = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** ที่อยู่เต็มของ API — ใช้กับ fetch ที่ต้องทำเอง(เช่น multipart upload) */
export const apiUrl = (path: string) => `${BASE_URL}${path}`;
