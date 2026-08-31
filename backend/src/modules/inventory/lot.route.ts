import type { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { costStatusOf } from '../../lib/cost-status.js';
import { businessDateKey, expiryStatus, EXPIRY_SOON_DAYS, suggestFefo } from '../../lib/inventory-lot.js';
import { ok, fail } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';

const VIEW = requirePermission('INVENTORY_VIEW', 'STOCK_VIEW');
const D = (value: unknown) => Number(String(value));
const daysRemaining = (expiryDate: Date | null) => expiryDate ? Math.round((Date.parse(expiryDate.toISOString().slice(0, 10)) - Date.parse(businessDateKey())) / 86_400_000) : null;

const querySchema = z.object({
  warehouseId: z.string().optional(), itemId: z.string().optional(), categoryId: z.string().optional(),
  status: z.enum(['GOOD', 'EXPIRING_SOON', 'EXPIRED', 'NO_EXPIRY']).optional(),
  expiryFrom: z.coerce.date().optional(), expiryTo: z.coerce.date().optional(), keyword: z.string().trim().max(100).optional(),
});

async function lotRows(companyId: string, query: z.infer<typeof querySchema>) {
  const balances = await prisma.stockBalance.findMany({
    where: {
      lotId: { not: null }, warehouse: { companyId }, ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      item: { companyId, deletedAt: null, ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(query.keyword ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] } : {}) },
      lot: { companyId, ...(query.expiryFrom || query.expiryTo ? { expiryDate: { ...(query.expiryFrom ? { gte: query.expiryFrom } : {}), ...(query.expiryTo ? { lte: query.expiryTo } : {}) } } : {}) },
    },
    include: { lot: true, warehouse: { select: { id: true, code: true, name: true } }, item: { include: { baseUnit: true, category: true, priceHistory: { select: { id: true } } } } },
  });
  return balances.map((balance) => {
    const onHand = D(balance.onHand); const reserved = D(balance.reserved); const unitCost = D(balance.item.lastCost);
    const costStatus = costStatusOf({ lastCost: unitCost, priceRecordCount: balance.item.priceHistory.length });
    const status = expiryStatus(balance.lot!.expiryDate);
    return {
      lotId: balance.lotId!, lotNo: balance.lot!.lotNo, itemId: balance.itemId, itemCode: balance.item.code, itemName: balance.item.name,
      categoryId: balance.item.categoryId, categoryName: balance.item.category?.name ?? null,
      warehouseId: balance.warehouseId, warehouseCode: balance.warehouse.code, warehouseName: balance.warehouse.name,
      onHand, reserved, available: onHand - reserved, unit: balance.item.baseUnit.code,
      manufactureDate: balance.lot!.manufactureDate, receivedDate: balance.lot!.receivedDate, expiryDate: balance.lot!.expiryDate,
      daysRemaining: daysRemaining(balance.lot!.expiryDate), status, estimatedValue: costStatus === 'MISSING' ? null : Number(new Prisma.Decimal(onHand).mul(unitCost)),
      unitCost: costStatus === 'MISSING' ? null : unitCost, costStatus, sourceType: balance.lot!.sourceType,
      sourceReceiptId: balance.lot!.sourceReceiptId, sourceProductionId: balance.lot!.sourceProductionId,
    };
  }).filter((row) => !query.status || row.status === query.status).sort((a, b) => (a.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.itemName.localeCompare(b.itemName, 'th') || a.lotId.localeCompare(b.lotId));
}

const styleSheet = (sheet: ExcelJS.Worksheet) => {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.autoFilter = { from: 'A1', to: 'M1' };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A47' } };
};
const xlsxReply = async (reply: FastifyReply, workbook: ExcelJS.Workbook) => reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', 'attachment; filename="lot-expiry-inventory.xlsx"').send(Buffer.from(await workbook.xlsx.writeBuffer()));

export default async function lotRoutes(app: FastifyInstance) {
  app.get('/inventory/lots', { preHandler: VIEW }, async (req) => {
    const rows = await lotRows(req.user.companyId!, querySchema.parse(req.query ?? {}));
    const positive = rows.filter((row) => row.onHand > 0);
    return ok({ thresholdDays: EXPIRY_SOON_DAYS, basis: 'มูลค่าสต็อกโดยประมาณจากต้นทุนปัจจุบัน', rows, kpi: {
      activeLots: positive.length, expiringSoon: positive.filter((row) => row.status === 'EXPIRING_SOON').length,
      expiredLots: positive.filter((row) => row.status === 'EXPIRED').length,
      knownValueAtRisk: positive.filter((row) => row.status === 'EXPIRED' || row.status === 'EXPIRING_SOON').reduce((sum, row) => sum + (row.estimatedValue ?? 0), 0),
      unknownValueAtRisk: positive.filter((row) => (row.status === 'EXPIRED' || row.status === 'EXPIRING_SOON') && row.estimatedValue == null).length,
    } });
  });

  app.post('/inventory/lots/suggest', { preHandler: VIEW }, async (req, reply) => {
    const body = z.object({ warehouseId: z.string().min(1), itemId: z.string().min(1), quantity: z.coerce.number().positive() }).parse(req.body);
    const companyId = req.user.companyId!;
    const [warehouse, item] = await Promise.all([prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId } }), prisma.item.findFirst({ where: { id: body.itemId, companyId, deletedAt: null } })]);
    if (!warehouse || !item) return reply.status(404).send(fail('LOT_SCOPE_NOT_FOUND', 'ไม่พบคลังหรือสินค้าในบริษัทปัจจุบัน'));
    return ok(await prisma.$transaction((tx) => suggestFefo(tx, companyId, body.warehouseId, body.itemId, body.quantity)));
  });

  app.get('/inventory/lots/export.xlsx', { preHandler: VIEW }, async (req, reply) => {
    const rows = await lotRows(req.user.companyId!, querySchema.parse(req.query ?? {})); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Lot & Expiry Inventory');
    sheet.columns = [
      { header: 'Item', key: 'itemName', width: 28 }, { header: 'Lot', key: 'lotNo', width: 18 }, { header: 'Warehouse', key: 'warehouseName', width: 24 },
      { header: 'On Hand', key: 'onHand', width: 14, style: { numFmt: '#,##0.0000' } }, { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Manufacture Date', key: 'manufactureDate', width: 18, style: { numFmt: 'yyyy-mm-dd' } }, { header: 'Expiry Date', key: 'expiryDate', width: 16, style: { numFmt: 'yyyy-mm-dd' } },
      { header: 'Days Remaining', key: 'daysRemaining', width: 16, style: { numFmt: '0' } }, { header: 'Status', key: 'status', width: 18 },
      { header: 'Estimated Value', key: 'estimatedValue', width: 18, style: { numFmt: '#,##0.00' } }, { header: 'Cost Status', key: 'costStatus', width: 14 },
      { header: 'Source', key: 'sourceType', width: 18 }, { header: 'Received Date', key: 'receivedDate', width: 16, style: { numFmt: 'yyyy-mm-dd' } },
    ]; sheet.addRows(rows); styleSheet(sheet); return xlsxReply(reply, workbook);
  });

  app.get('/inventory/lots/:id', { preHandler: VIEW }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params); const companyId = req.user.companyId!;
    const lot = await prisma.inventoryLot.findFirst({ where: { id, companyId, item: { companyId } }, include: {
      item: { include: { baseUnit: true } }, sourceReceipt: { select: { id: true, receiptNo: true } }, sourceProduction: { select: { id: true, orderNo: true } },
      stockBalances: { include: { warehouse: { select: { id: true, code: true, name: true } } } }, stockLedgers: { orderBy: { createdAt: 'desc' }, include: { warehouse: { select: { code: true, name: true } } } },
    } });
    if (!lot) return reply.status(404).send(fail('LOT_NOT_FOUND', 'ไม่พบ Lot ในบริษัทปัจจุบัน'));
    return ok({ ...lot, status: expiryStatus(lot.expiryDate), daysRemaining: daysRemaining(lot.expiryDate), balances: lot.stockBalances.map((row) => ({ ...row, onHand: D(row.onHand), reserved: D(row.reserved), available: D(row.onHand) - D(row.reserved) })) });
  });
}
