import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/response.js';
import { getHealth } from './health.service.js';

/**
 * GET /api/health — ตรวจสถานะระบบและฐานข้อมูล
 */
export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    const health = await getHealth();
    const message = health.status === 'ok' ? 'ระบบพร้อมใช้งาน' : 'ระบบทำงานได้บางส่วน';
    return reply.send(ok(health, message));
  });
}
