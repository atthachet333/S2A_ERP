import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePasswordChanged, requirePermission } from '../auth/auth.guard.js';
import { writeAudit } from '../../lib/http.js';
import { universalFactor } from '../../lib/unit-convert.js';

// หน่วยเป็น master data ที่ใช้ร่วม — ผู้ที่สร้าง/แก้วัตถุดิบ/บรรจุภัณฑ์เพิ่มหน่วยได้
const MANAGE = requirePermission('INGREDIENT_CREATE', 'PACKAGING_CREATE', 'INGREDIENT_EDIT', 'PACKAGING_EDIT');

const createSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(60),
});

const conversionSchema = z.object({
  fromUnitId: z.string().min(1),
  toUnitId: z.string().min(1),
  factor: z.number().positive(),
});

/**
 * หน่วยนับ (Unit) + Unit Conversion มาตรฐาน
 * หมายเหตุ: การแปลงหน่วยเฉพาะวัตถุดิบ (เช่น 1 กำ = 80 กรัม) เก็บที่ Item.purchaseToBaseFactor
 * ส่วน UnitConversion ที่นี่ใช้สำหรับการแปลงมาตรฐานทั่วไป (kg↔g, l↔ml)
 */
export default async function unitRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePasswordChanged }, async () => {
    const units = await prisma.unit.findMany({
      where: { deletedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, isActive: true },
    });
    return ok(units);
  });

  app.get('/conversions', { preHandler: requirePasswordChanged }, async () => {
    const conversions = await prisma.unitConversion.findMany({
      include: { fromUnit: { select: { code: true, name: true } }, toUnit: { select: { code: true, name: true } } },
    });
    // จำนวนบรรทัดในสูตรที่ใช้หน่วยต้นทาง/ปลายทางอยู่ — ใช้เตือนก่อนลบ และแสดงคอลัมน์ "ใช้งานที่"
    const unitIds = [...new Set(conversions.flatMap((c) => [c.fromUnitId, c.toUnitId]))];
    const usage = unitIds.length
      ? await prisma.recipeIngredient.groupBy({ by: ['unitId'], where: { unitId: { in: unitIds } }, _count: { _all: true } })
      : [];
    const usageMap = new Map(usage.map((u) => [u.unitId, u._count._all]));
    return ok(conversions.map((c) => ({
      id: c.id,
      fromUnitId: c.fromUnitId,
      toUnitId: c.toUnitId,
      fromCode: c.fromUnit.code,
      toCode: c.toUnit.code,
      fromName: c.fromUnit.name,
      toName: c.toUnit.name,
      factor: Number(c.factor.toString()),
      usageCount: (usageMap.get(c.fromUnitId) ?? 0) + (usageMap.get(c.toUnitId) ?? 0),
    })));
  });

  app.post('/', { preHandler: MANAGE }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const existing = await prisma.unit.findUnique({ where: { code: body.code } });
    if (existing) return reply.status(409).send(fail('CONFLICT', `มีหน่วยรหัส ${body.code} อยู่แล้ว`));
    const unit = await prisma.unit.create({ data: { code: body.code, name: body.name } });
    await writeAudit(req, { action: 'CREATE', entity: 'Unit', entityId: unit.id, after: unit });
    return reply.status(201).send(ok(unit, 'เพิ่มหน่วยนับสำเร็จ'));
  });

  app.post('/conversions', { preHandler: MANAGE }, async (req, reply) => {
    const body = conversionSchema.parse(req.body);
    if (body.fromUnitId === body.toUnitId) return reply.status(400).send(fail('VALIDATION_ERROR', 'หน่วยต้นทางและปลายทางต้องต่างกัน'));

    // กันค่าขัดแย้ง: ถ้ามีเส้นทางแปลงเดิมอยู่แล้ว (เช่น KG→G→...) ค่าใหม่ต้องไม่ขัดกับของเดิม
    const others = (await prisma.unitConversion.findMany({ select: { fromUnitId: true, toUnitId: true, factor: true } }))
      .filter((e) => !(e.fromUnitId === body.fromUnitId && e.toUnitId === body.toUnitId))
      .filter((e) => !(e.fromUnitId === body.toUnitId && e.toUnitId === body.fromUnitId))
      .map((e) => ({ fromUnitId: e.fromUnitId, toUnitId: e.toUnitId, factor: Number(e.factor.toString()) }));
    const derived = universalFactor(body.fromUnitId, body.toUnitId, others);
    if (derived != null && Math.abs(derived - body.factor) > Math.max(1e-6, Math.abs(derived) * 1e-6)) {
      return reply.status(409).send(fail('CONVERSION_CONFLICT', `ค่านี้ขัดกับสูตรที่มีอยู่ — ระบบคำนวณได้ ${derived} จากสูตรอื่นที่ตั้งไว้แล้ว`));
    }

    const conversion = await prisma.unitConversion.upsert({
      where: { fromUnitId_toUnitId: { fromUnitId: body.fromUnitId, toUnitId: body.toUnitId } },
      update: { factor: new Prisma.Decimal(body.factor) },
      create: { fromUnitId: body.fromUnitId, toUnitId: body.toUnitId, factor: new Prisma.Decimal(body.factor) },
    });
    await writeAudit(req, { action: 'UPSERT', entity: 'UnitConversion', entityId: conversion.id, after: { factor: body.factor } });
    return reply.status(201).send(ok({ id: conversion.id }, 'บันทึกการแปลงหน่วยสำเร็จ'));
  });

  /**
   * ลบอัตราแปลงหน่วย — ตรวจการอ้างอิงก่อนเสมอ
   * ถ้ามีบรรทัดในสูตรที่ใช้หน่วยต้นทาง/ปลายทางอยู่ การลบอาจทำให้คิดต้นทุนไม่ได้ จึงปฏิเสธ
   */
  app.delete('/conversions/:id', { preHandler: MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversion = await prisma.unitConversion.findUnique({ where: { id } });
    if (!conversion) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบอัตราแปลงหน่วยนี้'));

    const referencedBy = await prisma.recipeIngredient.count({
      where: { unitId: { in: [conversion.fromUnitId, conversion.toUnitId] } },
    });
    if (referencedBy > 0) {
      return reply.status(409).send(fail('CONVERSION_IN_USE', `มีรายการในสูตร ${referencedBy} รายการที่ใช้หน่วยนี้อยู่ จึงลบอัตราแปลงไม่ได้ (แก้หน่วยในสูตรก่อน)`));
    }
    await prisma.unitConversion.delete({ where: { id } });
    await writeAudit(req, { action: 'DELETE', entity: 'UnitConversion', entityId: id, before: { fromUnitId: conversion.fromUnitId, toUnitId: conversion.toUnitId, factor: Number(conversion.factor.toString()) } });
    return ok({ id, deleted: true }, 'ลบอัตราแปลงหน่วยสำเร็จ');
  });
}
