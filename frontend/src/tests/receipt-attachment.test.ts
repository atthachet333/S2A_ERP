import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_ATTACHMENT_TYPES, canEditAttachments, documentActions, formatFileSize,
  type ReceiptAttachment,
} from '@/lib/receipt-attachment';

/**
 * PHASE 22 — เอกสารต้นฉบับจากผู้ขาย
 *
 * ไฟล์ต้นฉบับเป็นหลักฐานประกอบ ไม่แทนที่ใบรับของของ S2A
 * และการแนบไฟล์ต้องไม่บังคับ
 */

const file = (over: Partial<ReceiptAttachment> = {}): ReceiptAttachment => ({
  id: 'f1', originalName: 'ใบส่งของ.pdf', mimeType: 'application/pdf', sizeBytes: 2048,
  uploadedAt: '2026-08-23T00:00:00.000Z', uploadedById: 'u1',
  url: '/api/business/receiving/attachments/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf',
  ...over,
});

describe('ปุ่มเอกสารสองปุ่มต้องแยกกันเด็ดขาด', () => {
  it('มีทั้งใบของ S2A และไฟล์ต้นฉบับ — คนละเส้นทาง ไม่ทับกัน', () => {
    const actions = documentActions({ receiptId: 'r1', status: 'CONFIRMED', attachments: [file()] });
    expect(actions.s2a.available).toBe(true);
    expect(actions.s2a.url).toBe('/business/documents/GOODS_RECEIPT_SLIP/r1.pdf');
    expect(actions.original.available).toBe(true);
    expect(actions.original.url).toContain('/receiving/attachments/');
    expect(actions.s2a.url).not.toBe(actions.original.url);
  });

  it('ไม่มีไฟล์ต้นฉบับ = ปุ่มไม่พร้อมใช้และบอกตรง ๆ ไม่ใช่กดแล้วไม่เกิดอะไร', () => {
    const actions = documentActions({ receiptId: 'r1', status: 'CONFIRMED', attachments: [] });
    expect(actions.original.available).toBe(false);
    expect(actions.original.url).toBeNull();
    expect(actions.original.label).toBe('ไม่มีไฟล์ต้นฉบับ');
  });

  it('ใบที่ยังเป็นร่างยังไม่มีใบของ S2A ให้เปิด แต่แนบไฟล์ต้นฉบับได้แล้ว', () => {
    const actions = documentActions({ receiptId: 'r1', status: 'DRAFT', attachments: [file()] });
    expect(actions.s2a.available).toBe(false);
    expect(actions.s2a.url).toBeNull();
    expect(actions.original.available).toBe(true);
  });
});

describe('สิทธิ์แก้ไฟล์แนบตามสถานะเอกสาร', () => {
  it('ร่างเท่านั้นที่แก้ได้ — ยืนยันแล้วไฟล์กลายเป็นหลักฐาน', () => {
    expect(canEditAttachments('DRAFT')).toBe(true);
    for (const status of ['CONFIRMED', 'REVERSED', 'CANCELLED', null, undefined]) {
      expect(canEditAttachments(status), String(status)).toBe(false);
    }
  });
});

describe('ชนิดไฟล์และการแสดงขนาด', () => {
  it('รับเฉพาะชนิดที่ backend ตรวจ magic bytes ได้แน่นอน', () => {
    expect(ACCEPTED_ATTACHMENT_TYPES).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    // XLSX เป็นไฟล์ ZIP แยกด้วย magic bytes อย่างเดียวไม่ได้ จึงต้องไม่อยู่ในรายการ
    expect(ACCEPTED_ATTACHMENT_TYPES.join()).not.toContain('spreadsheet');
  });

  it('แสดงขนาดไฟล์อ่านง่ายและทนค่าที่ผิดปกติ', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatFileSize(Number.NaN)).toBe('—');
    expect(formatFileSize(-1)).toBe('—');
  });
});

describe('หน้าจอรับของ', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
  const section = read('../components/receiving/OriginalDocument.tsx');
  const detail = read('../pages/OperationDetailPages.tsx');

  it('บอกชัดว่าไม่บังคับ และรับของได้ตามปกติโดยไม่แนบไฟล์', () => {
    expect(section).toContain('ไม่บังคับ สามารถรับสินค้าได้ตามปกติโดยไม่แนบไฟล์');
  });

  it('แสดงชื่อไฟล์ ชนิด และขนาด', () => {
    expect(section).toContain('file.originalName');
    expect(section).toContain('formatFileSize(file.sizeBytes)');
    expect(section).toContain('file.mimeType');
  });

  it('ปุ่มลบมีเฉพาะตอนที่แก้ได้ และบอกเหตุผลเมื่อแก้ไม่ได้', () => {
    expect(section).toMatch(/\{canEdit && \(\s*<button/);
    expect(section).toContain('ใบรับของนี้ยืนยันแล้ว ไฟล์ต้นฉบับจึงเป็นหลักฐานที่แก้ไขไม่ได้');
  });

  it('หน้าเอกสารมีปุ่มแยกสองปุ่มจริง', () => {
    expect(detail).toContain('ดูใบรับเข้าของ S2A');
    expect(detail).toContain('docs.original.label');
    expect(detail).toContain('documentActions(');
  });

  it('เปิดใบของ S2A ผ่าน blob ไม่ใช่ลิงก์ตรง', () => {
    expect(detail).toContain("apiClient.blob(path, 'pdf')");
  });

  it('อัปโหลดยิงไปที่ API เต็ม ไม่ใช่ path สัมพัทธ์', () => {
    const lib = read('../lib/receipt-attachment.ts');
    expect(lib).toContain('apiUrl(`/business/receiving/${receiptId}/attachments`)');
  });
});
