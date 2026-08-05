/**
 * ตัวช่วยสร้าง Response ตาม envelope มาตรฐานของระบบ
 * สำเร็จ: { success: true, data, message }
 * ผิดพลาด: { success: false, error: { code, message, details } }
 */

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  message: string;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function ok<T>(data: T, message = 'ดำเนินการสำเร็จ'): SuccessEnvelope<T> {
  return { success: true, data, message };
}

export function fail(code: string, message: string, details?: unknown): ErrorEnvelope {
  return { success: false, error: { code, message, details } };
}

/** โครงสร้างผลลัพธ์แบบแบ่งหน้า (pagination) */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}
