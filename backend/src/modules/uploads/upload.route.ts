import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';
import { writeAudit } from '../../lib/http.js';

/**
 * Image upload ที่ปลอดภัย (PART 10)
 * - ตรวจ extension + MIME + magic bytes
 * - filename เป็น UUID (ไม่ใช้ชื่อจาก user) กัน path traversal / double extension / executable
 * - เก็บไฟล์บนดิสก์ (ไม่เก็บ base64 ใน DB); DB เก็บ relative path
 * - GET เสิร์ฟรูปแบบ read-only ด้วยชื่อไฟล์ที่ผ่าน whitelist เท่านั้น
 */
const KINDS = new Set(['items', 'menus']);
// อัปโหลดรูปวัตถุดิบ/บรรจุภัณฑ์/เมนู — ให้ผู้ที่จัดการรายการเหล่านั้นอัปโหลดได้
const MANAGE = requirePermission('INGREDIENT_CREATE', 'PACKAGING_CREATE', 'INGREDIENT_EDIT', 'PACKAGING_EDIT', 'RECIPE_CREATE', 'RECIPE_EDIT');

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** ตรวจ magic bytes: JPEG FFD8FF, PNG 89504E470D0A1A0A, WEBP RIFF....WEBP */
function detectImage(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const uploadBaseDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
const FILENAME_RE = /^[a-f0-9-]{36}\.(jpg|png|webp)$/;
const CONTENT_TYPE: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export default async function uploadRoutes(app: FastifyInstance) {
  async function handleUpload(kind: 'items' | 'menus', req: FastifyRequest, reply: FastifyReply) {
    const file = await req.file();
    if (!file) return reply.status(400).send(fail('VALIDATION_ERROR', 'ไม่พบไฟล์ที่อัปโหลด'));

    const declaredExt = EXT_BY_MIME[file.mimetype];
    if (!declaredExt) return reply.status(415).send(fail('UNSUPPORTED_MEDIA', 'รองรับเฉพาะ JPG, PNG, WEBP'));

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.status(413).send(fail('FILE_TOO_LARGE', 'ไฟล์ใหญ่เกิน 5 MB'));
    }
    if (file.file.truncated || buffer.length > env.UPLOAD_MAX_BYTES) {
      return reply.status(413).send(fail('FILE_TOO_LARGE', 'ไฟล์ใหญ่เกิน 5 MB'));
    }

    const detected = detectImage(buffer);
    if (!detected || detected !== file.mimetype) {
      return reply.status(415).send(fail('UNSUPPORTED_MEDIA', 'ไฟล์ไม่ใช่รูปภาพที่ถูกต้อง (ตรวจ magic bytes ไม่ผ่าน)'));
    }

    const ext = EXT_BY_MIME[detected];
    const filename = `${randomUUID()}.${ext}`;
    const dir = path.join(uploadBaseDir, kind);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);

    const url = `/api/uploads/${kind}/${filename}`;
    await writeAudit(req, { action: 'UPLOAD', entity: 'Image', entityId: filename, after: { kind, size: buffer.length, mime: detected } });
    return reply.status(201).send(ok({ url, filename, mimeType: detected, size: buffer.length }, 'อัปโหลดรูปสำเร็จ'));
  }

  app.post('/items', { preHandler: MANAGE }, (req, reply) => handleUpload('items', req, reply));
  app.post('/menus', { preHandler: MANAGE }, (req, reply) => handleUpload('menus', req, reply));

  // เสิร์ฟรูป (read-only, public) — ชื่อไฟล์ต้องผ่าน whitelist ป้องกัน path traversal
  app.get('/:kind/:name', async (req, reply) => {
    const { kind, name } = req.params as { kind: string; name: string };
    if (!KINDS.has(kind) || !FILENAME_RE.test(name)) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบไฟล์'));
    const filePath = path.join(uploadBaseDir, kind, name);
    if (!filePath.startsWith(uploadBaseDir) || !existsSync(filePath)) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบไฟล์'));
    const ext = name.split('.').pop() as string;
    const data = await readFile(filePath);
    reply.header('Content-Type', CONTENT_TYPE[ext] ?? 'application/octet-stream');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(data);
  });
}
