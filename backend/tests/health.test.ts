import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * ทดสอบ GET /api/health ให้ตอบกลับตาม envelope มาตรฐาน
 * (ไม่ต้องมี DB จริง — ถ้า DB ล่ม status จะเป็น degraded แต่ยัง success)
 */
describe('GET /api/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('ตอบกลับ envelope มาตรฐานและมีฟิลด์ที่จำเป็น', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.success).toBe(true);
    expect(body).toHaveProperty('message');
    expect(body.data).toHaveProperty('status');
    expect(['ok', 'degraded']).toContain(body.data.status);
    expect(body.data).toHaveProperty('uptime');
    expect(body.data).toHaveProperty('timestamp');
    expect(['up', 'down']).toContain(body.data.db);
  });

  it('แนบ header x-request-id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('เส้นทางที่ไม่มีอยู่ตอบ 404 พร้อม envelope error', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/not-exist' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
