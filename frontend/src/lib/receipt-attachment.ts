import { ApiClientError, apiUrl, sessionStore } from './api-client';

/**
 * PHASE 22 — เอกสารต้นฉบับจากผู้ขายที่แนบกับใบรับของ
 *
 * ไฟล์ต้นฉบับเป็นหลักฐานประกอบเท่านั้น ไม่ใช่แหล่งความจริงของรายการรับของ
 * และเป็นคนละไฟล์กับใบรับของของ S2A ที่ระบบสร้างเอง — ปุ่มสองปุ่มจึงต้องแยกกันชัดเจน
 */

export interface ReceiptAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedById: string | null;
  url: string;
}

/** ชนิดไฟล์ที่ backend ตรวจ magic bytes ได้แน่นอน */
export const ACCEPTED_ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * อัปโหลดไฟล์ต้นฉบับ — ใช้รูปแบบเดียวกับ uploadImage เดิมของระบบ
 * ต้องยิงไปที่ apiUrl เต็ม ไม่ใช่ path สัมพัทธ์ ไม่งั้นจะไปโดน static server (บทเรียน PHASE 13)
 */
export async function uploadReceiptAttachment(receiptId: string, file: File): Promise<ReceiptAttachment> {
  const form = new FormData();
  form.append('file', file);
  const token = sessionStore.accessToken();
  const res = await fetch(apiUrl(`/business/receiving/${receiptId}/attachments`), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const payload = await res.json().catch(() => null);
  if (!payload || !payload.success) {
    throw new ApiClientError(payload?.error?.code ?? 'UPLOAD_FAILED', payload?.error?.message ?? 'แนบไฟล์ไม่สำเร็จ', res.status);
  }
  return payload.data as ReceiptAttachment;
}

/** ใบที่ยังเป็นร่างเท่านั้นที่แก้ไฟล์แนบได้ — ยืนยันแล้วไฟล์กลายเป็นหลักฐาน */
export const canEditAttachments = (status: string | null | undefined): boolean => status === 'DRAFT';

export interface DocumentActions {
  /** ใบรับของที่ระบบสร้าง — มีเสมอเมื่อเอกสารไม่ใช่ร่าง */
  s2a: { available: boolean; url: string | null };
  /** ไฟล์ต้นฉบับจากผู้ขาย — ไม่มีไฟล์ก็ต้องไม่ทำปุ่มที่กดแล้วไม่เกิดอะไร */
  original: { available: boolean; url: string | null; label: string };
}

/**
 * ปุ่มเอกสารสองปุ่มของใบรับของ
 * ทั้งสองไฟล์อยู่คนละเส้นทางและไม่มีทางเขียนทับกัน
 */
export function documentActions(input: {
  receiptId: string;
  status: string | null | undefined;
  attachments: ReceiptAttachment[];
}): DocumentActions {
  const first = input.attachments[0];
  return {
    s2a: {
      available: input.status !== 'DRAFT',
      url: input.status !== 'DRAFT' ? `/business/documents/GOODS_RECEIPT_SLIP/${input.receiptId}.pdf` : null,
    },
    original: {
      available: Boolean(first),
      url: first?.url ?? null,
      label: first ? 'ดูไฟล์ต้นฉบับ' : 'ไม่มีไฟล์ต้นฉบับ',
    },
  };
}
