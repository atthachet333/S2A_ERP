import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { authenticate } from '../auth/auth.guard.js';

const createSchema = z.object({
  nameTh: z.string().trim().min(1, 'กรุณาระบุชื่อบริษัท').max(160),
  nameEn: z.string().trim().max(160).optional().nullable(),
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9-]+$/, 'รหัสใช้ได้เฉพาะ A-Z, 0-9 และขีดกลาง').transform((value) => value.toUpperCase()),
  logoUrl: z.string().trim().max(300).refine((value) => value === '' || value.startsWith('/') || /^https:\/\//i.test(value), 'Logo ต้องเป็น HTTPS URL หรือ path ภายในระบบ').optional().nullable(),
  taxId: z.string().trim().regex(/^\d{10,13}$/, 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 10-13 หลัก').optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง').optional().or(z.literal('')),
  address: z.string().trim().max(500).optional().nullable(),
});

export default async function companyRoutes(app: FastifyInstance) {
  app.post('/', { preHandler: authenticate }, async (req, reply) => {
    if (!req.user.roles.includes('SUPER_ADMIN')) return reply.status(403).send(fail('FORBIDDEN', 'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่สร้างบริษัทได้'));
    const body = createSchema.parse(req.body);
    if (await prisma.company.findUnique({ where: { code: body.code } })) return reply.status(409).send(fail('CONFLICT', 'รหัสบริษัทนี้ถูกใช้งานแล้ว'));
    const role = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
    if (!role) return reply.status(500).send(fail('ROLE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าบทบาทผู้ดูแลระบบ'));
    const company = await prisma.$transaction(async (tx) => {
      const created = await tx.company.create({ data: {
        code: body.code, nameTh: body.nameTh, nameEn: body.nameEn || null, logoUrl: body.logoUrl || null,
        taxId: body.taxId || null, phone: body.phone || null, email: body.email || null, address: body.address || null,
      } });
      await tx.companyMembership.create({ data: { userId: req.user.sub, companyId: created.id, roleId: role.id } });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId: created.id, action: 'COMPANY_CREATED', entity: 'Company', entityId: created.id, after: { code: created.code, nameTh: created.nameTh }, ip: req.ip } });
      return created;
    });
    return reply.status(201).send(ok({ id: company.id, code: company.code, nameTh: company.nameTh, nameEn: company.nameEn, logoUrl: company.logoUrl, role: 'SUPER_ADMIN', isDefault: false }, 'สร้างบริษัทสำเร็จ'));
  });
}
