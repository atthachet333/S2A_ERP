import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { apiClient, filenameFromDisposition } from '@/lib/api-client';

/**
 * PHASE 13 — เทสต์เส้นทางดาวน์โหลดไฟล์
 *
 * บั๊กที่แก้: หน้าส่งออก Excel เรียก fetch('/api/...') ด้วย path สัมพัทธ์
 * บน production เว็บถูกเสิร์ฟด้วย static server ที่มี SPA fallback
 * ทำให้ /api/... ตอบ 200 + text/html (index.html) แทนไฟล์ xlsx
 * โค้ดเดิมเช็คแค่ res.ok จึงบันทึก HTML เป็นไฟล์ .xlsx และ Excel เปิดไม่ได้
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

/** จำลอง fetch หนึ่งครั้ง พร้อม header ที่ต้องการ */
function mockFetch(body: BodyInit, init: { status?: number; type: string; disposition?: string }) {
  const headers = new Headers({ 'Content-Type': init.type });
  if (init.disposition) headers.set('Content-Disposition', init.disposition);
  const res = new Response(body, { status: init.status ?? 200, headers });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
}

/** ดัก <a>.click เพื่อดูว่าไฟล์ถูกสั่งบันทึกด้วยชื่ออะไร */
function captureDownload() {
  const clicked: { name: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ name: this.download });
  });
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
  } else {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }
  return clicked;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('PHASE 13 — ตัวช่วยดาวน์โหลด', () => {
  it('บันทึกไฟล์เมื่อ content-type เป็น xlsx จริง', async () => {
    const clicked = captureDownload();
    mockFetch(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="GR-receiving-20260821-1530.xlsx"',
    });
    const out = await apiClient.download('/business/receiving/export.xlsx', { expect: 'xlsx', fallbackName: 'receiving.xlsx' });
    expect(out.name).toBe('GR-receiving-20260821-1530.xlsx');
    expect(out.size).toBeGreaterThan(0);
    expect(clicked[0].name).toBe('GR-receiving-20260821-1530.xlsx');
  });

  it('ปฏิเสธเมื่อเซิร์ฟเวอร์ตอบ index.html — คือบั๊กเดิมที่ทำให้ไฟล์เปิดไม่ได้', async () => {
    captureDownload();
    mockFetch('<!doctype html><html lang="th"><head></head></html>', { type: 'text/html' });
    await expect(apiClient.download('/business/receiving/export.xlsx', { expect: 'xlsx', fallbackName: 'receiving.xlsx' }))
      .rejects.toMatchObject({ code: 'DOWNLOAD_NOT_BINARY' });
  });

  it('ปฏิเสธไฟล์ว่าง', async () => {
    captureDownload();
    mockFetch(new Uint8Array([]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await expect(apiClient.download('/x.xlsx', { expect: 'xlsx', fallbackName: 'a.xlsx' }))
      .rejects.toMatchObject({ code: 'DOWNLOAD_EMPTY' });
  });

  it('ปฏิเสธเมื่อ HTTP ไม่สำเร็จ', async () => {
    captureDownload();
    mockFetch('nope', { status: 500, type: 'text/plain' });
    await expect(apiClient.download('/x.xlsx', { expect: 'xlsx', fallbackName: 'a.xlsx' }))
      .rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  });

  it('ไม่มีชื่อไฟล์จาก header → ใช้ชื่อสำรอง', async () => {
    const clicked = captureDownload();
    mockFetch(new Uint8Array([0x50, 0x4b]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await apiClient.download('/x.xlsx', { expect: 'xlsx', fallbackName: 'receiving.xlsx' });
    expect(clicked[0].name).toBe('receiving.xlsx');
  });

  it('ยิงผ่าน BASE_URL ของ API ไม่ใช่ path สัมพัทธ์ของเว็บ', async () => {
    captureDownload();
    mockFetch(new Uint8Array([0x50, 0x4b]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await apiClient.download('/business/receiving/export.xlsx', { expect: 'xlsx', fallbackName: 'a.xlsx' });
    const url = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(url).toContain('/business/receiving/export.xlsx');
    expect(url).not.toMatch(/^\/api\//);
  });

  it('ตรวจ content-type ของ PDF แยกจาก xlsx', async () => {
    captureDownload();
    mockFetch(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { type: 'application/pdf' });
    const out = await apiClient.download('/business/documents/x.pdf', { expect: 'pdf', fallbackName: 'doc.pdf' });
    expect(out.contentType).toContain('application/pdf');
  });
});

describe('PHASE 13 — อ่านชื่อไฟล์จาก Content-Disposition', () => {
  it('อ่านรูปแบบธรรมดา', () => {
    expect(filenameFromDisposition('attachment; filename="GR-001.xlsx"')).toBe('GR-001.xlsx');
  });

  it('อ่านชื่อไทยจาก filename* (RFC 5987)', () => {
    const h = `attachment; filename="GR-_____-001.xlsx"; filename*=UTF-8''${encodeURIComponent('GR-รับของ-001.xlsx')}`;
    expect(filenameFromDisposition(h)).toBe('GR-รับของ-001.xlsx');
  });

  it('ไม่มี header → null', () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('')).toBeNull();
  });
});

describe('PHASE 13 — ไม่มี path สัมพัทธ์ /api หลงเหลือ', () => {
  it('ทุกการเรียก backend ต้องผ่าน api-client', () => {
    const files = ['pages/OperationsPages.tsx', 'lib/catalog.ts'];
    for (const f of files) {
      // ตัดคอมเมนต์ทิ้งก่อน เพราะคอมเมนต์อธิบายบั๊กมีข้อความ '/api/...' อยู่
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, `${f} ยังมี fetch ไปยัง path สัมพัทธ์`).not.toMatch(/fetch\(\s*[`'"]\/api\//);
    }
  });

  it('หน้าส่งออก Excel ใช้ตัวช่วยกลางและระบุชนิดไฟล์ที่คาด', () => {
    const src = read('pages/OperationsPages.tsx');
    expect(src).toContain("apiClient.download(");
    expect(src).toContain("expect: 'xlsx'");
  });
});
