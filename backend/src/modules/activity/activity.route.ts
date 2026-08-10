import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok, paginate } from '../../lib/response.js';
import { requireCompany } from '../auth/auth.guard.js';

/**
 * GET /api/activity — ประวัติการใช้งานจริง (audit log + login log) แบบ read-only
 * เข้าถึงได้เฉพาะ SUPER_ADMIN เท่านั้น (ข้อมูลอ่อนไหว) — backend ตรวจสิทธิ์เอง
 * รองรับ pagination ผ่าน query ?page & ?pageSize
 */
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

type ActivityEntry = {
  id: string;
  type: 'AUDIT' | 'LOGIN';
  action: string;
  entity: string | null;
  actor: string | null;
  success: boolean;
  ip: string | null;
  createdAt: string;
};

export default async function activityRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireCompany }, async (req, reply) => {
    if (!req.user.roles.includes('SUPER_ADMIN')) {
      return reply.status(403).send(fail('FORBIDDEN', 'คุณไม่มีสิทธิ์ดูประวัติการใช้งาน'));
    }
    const { page, pageSize } = querySchema.parse(req.query ?? {});
    const window = page * pageSize;

    const [audits, logins] = await Promise.all([
      prisma.auditLog.findMany({
        where: { companyId: req.user.companyId! },
        orderBy: { createdAt: 'desc' },
        take: window,
        include: { user: { select: { username: true, fullName: true } } },
      }),
      prisma.loginLog.findMany({ where: { user: { companyMemberships: { some: { companyId: req.user.companyId! } } } }, orderBy: { createdAt: 'desc' }, take: window }),
    ]);

    const merged: ActivityEntry[] = [
      ...audits.map((a) => ({
        id: `audit_${a.id}`,
        type: 'AUDIT' as const,
        action: a.action,
        entity: a.entity,
        actor: a.user?.fullName ?? a.user?.username ?? null,
        success: true,
        ip: a.ip,
        createdAt: a.createdAt.toISOString(),
      })),
      ...logins.map((l) => ({
        id: `login_${l.id}`,
        type: 'LOGIN' as const,
        action: l.success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
        entity: 'Auth',
        actor: l.username,
        success: l.success,
        ip: l.ip,
        createdAt: l.createdAt.toISOString(),
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = merged.length;
    const start = (page - 1) * pageSize;
    return ok(paginate(merged.slice(start, start + pageSize), total, page, pageSize));
  });
}
