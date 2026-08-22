import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { shrinkPng } from '../../lib/png-resize.js';

/**
 * PHASE 14B — เตรียมไฟล์ภาพให้เอกสาร PDF
 *
 * PDFKit ฝังไฟล์ภาพลง PDF ตามขนาดไบต์จริงของไฟล์ ไม่ได้ย่อให้ตามขนาดที่วาด
 * โลโก้ต้นฉบับความละเอียดสูงจึงทำให้ไฟล์เอกสารใหญ่เกินจำเป็นมาก
 *
 * ที่นี่จะย่อสำเนาไว้ใช้เฉพาะงานเอกสาร แล้วเก็บแคชไว้บนดิสก์
 * ไฟล์ต้นฉบับความละเอียดสูงยังอยู่ครบสำหรับใช้บนเว็บ
 */

const CACHE_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './data/uploads', '.doc-assets');

/** ความกว้างที่พอสำหรับงานพิมพ์ — วาดจริงราว 26–30pt จึงเผื่อไว้ที่ ~4 เท่า */
export const DOC_LOGO_WIDTH = 160;

/**
 * คืน path ของภาพที่ย่อแล้วสำหรับฝังลงเอกสาร
 * ถ้าย่อไม่ได้ (ไม่ใช่ PNG ที่รองรับ หรือเล็กอยู่แล้ว) จะคืนไฟล์เดิม — ไม่ทำให้เอกสารพัง
 */
export function documentImage(sourcePath: string | null, maxWidth = DOC_LOGO_WIDTH): string | null {
  if (!sourcePath || !existsSync(sourcePath)) return null;
  if (!/\.png$/i.test(sourcePath)) return sourcePath;   // JPEG ฝังได้เลย ไม่ต้องย่อ

  try {
    const stat = statSync(sourcePath);
    /* คีย์แคชผูกกับไฟล์ต้นทาง+ขนาดเป้าหมาย ถ้าผู้ใช้อัปโหลดโลโก้ใหม่ คีย์จะเปลี่ยนเอง */
    const key = createHash('sha1')
      .update(`${sourcePath}|${stat.size}|${stat.mtimeMs}|${maxWidth}`)
      .digest('hex')
      .slice(0, 16);
    const cached = path.join(CACHE_DIR, `${key}.png`);
    if (existsSync(cached)) return cached;

    const shrunk = shrinkPng(readFileSync(sourcePath), maxWidth);
    if (!shrunk) return sourcePath;                     // เล็กอยู่แล้ว หรือรูปแบบไม่รองรับ

    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cached, shrunk);
    return cached;
  } catch {
    return sourcePath;                                  // ย่อไม่สำเร็จก็ยังออกเอกสารได้
  }
}
