import type { FastifyInstance } from 'fastify';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';
import { Errors } from '../../lib/errors.js';
import { notificationChannels } from '../notifications/channel.service.js';
import { renderBusinessPdf, type BusinessDocument, type DocumentType } from './document.service.js';

const customerSchema = z.object({
  code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(160),
  customerType: z.string().max(60).optional(), contactName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(), email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(500).optional(), taxId: z.string().max(30).optional(), note: z.string().max(500).optional(),
});
const orderSchema = z.object({
  customerId: z.string().min(1), deliveryDate: z.coerce.date(), deliveryTime: z.string().max(10).optional(),
  contactName: z.string().max(120).optional(), phone: z.string().max(40).optional(), email: z.string().email().optional().or(z.literal('')),
  deliveryAddress: z.string().max(500).optional(), discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0), note: z.string().max(500).optional(), idempotencyKey: z.string().max(100).optional(),
  items: z.array(z.object({ menuId: z.string().min(1), menuNameSnapshot: z.string().min(1), quantity: z.coerce.number().positive(), unit: z.string().min(1), unitPrice: z.coerce.number().min(0), note: z.string().optional() })).min(1),
});
const transitions: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['SENT_TO_PREP', 'CANCELLED'],
  SENT_TO_PREP: ['PICKING', 'CANCELLED'], PICKING: ['ISSUED', 'CANCELLED'], ISSUED: ['READY'],
  READY: ['DELIVERED'], DELIVERED: [], CANCELLED: [],
};
const timestampFor = (status: SalesOrderStatus) => ({
  ...(status === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
  ...(status === 'SENT_TO_PREP' ? { sentToOperationsAt: new Date() } : {}),
  ...(status === 'ISSUED' ? { issuedAt: new Date() } : {}),
  ...(status === 'READY' ? { readyAt: new Date() } : {}),
  ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
  ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
});

export default async function businessRoutes(app: FastifyInstance) {
  app.get('/documents/:type/:id.pdf', { preHandler: requirePermission('DOCUMENT_DOWNLOAD') }, async (req, reply) => {
    const { type, id } = z.object({ type: z.enum(['ORDER_SLIP','KITCHEN_PREPARATION_SLIP','STOCK_ISSUE_SLIP','GOODS_RECEIPT_SLIP','RECIPE_COST_SHEET','SALES_REPORT']), id: z.string().min(1) }).parse(req.params) as { type: DocumentType; id: string };
    const companyId = req.user.companyId!; const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const identity = { ...company, nameTh: company.code === 'S2A-PRIMARY' ? 'ครัวสดดี' : company.nameTh }; let document: BusinessDocument | undefined;
    if (type === 'ORDER_SLIP' || type === 'KITCHEN_PREPARATION_SLIP') {
      const order = await prisma.salesOrder.findFirst({ where: { id, companyId }, include: { customer: true, items: true, createdBy: { select: { fullName: true } } } });
      if (order) document = { type, title: type, documentNo: order.orderNo, date: order.deliveryDate, company: identity, createdBy: order.createdBy.fullName, subject: [{ label: 'ลูกค้า', value: order.customer.name }, { label: 'ผู้ติดต่อ', value: order.contactName ?? '—' }, { label: 'กำหนดส่ง', value: `${order.deliveryDate.toLocaleDateString('th-TH')} ${order.deliveryTime ?? ''}` }], lines: order.items.map((line) => ({ name: line.menuNameSnapshot, detail: line.note ?? undefined, quantity: line.quantity.toString(), unit: line.unit, price: line.unitPrice.toString(), total: line.lineTotal.toString() })), total: type === 'ORDER_SLIP' ? order.totalAmount.toString() : undefined, note: order.note };
    } else if (type === 'GOODS_RECEIPT_SLIP') {
      const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId }, include: { supplier: true, warehouse: true, items: { include: { item: true } } } });
      if (receipt) document = { type, title: type, documentNo: receipt.receiptNo, date: receipt.receiptDate, company: identity, subject: [{ label: 'Supplier', value: receipt.supplier?.name ?? '—' }, { label: 'คลัง', value: receipt.warehouse.name }, { label: 'สถานะ', value: receipt.status }], lines: receipt.items.map((line) => ({ name: line.item.name, detail: [line.lotNo && `Lot ${line.lotNo}`, line.expiryDate && `Expiry ${line.expiryDate.toLocaleDateString('th-TH')}`].filter(Boolean).join(' · '), quantity: line.quantity.toString(), unit: line.item.baseUnitId, price: line.unitPrice.toString(), total: line.totalCost.toString() })), total: receipt.items.reduce((sum,line)=>sum.plus(line.totalCost),new Prisma.Decimal(0)).toString(), note: receipt.note };
    } else if (type === 'STOCK_ISSUE_SLIP') {
      const issue = await prisma.stockIssue.findFirst({ where: { id, companyId }, include: { order: true, createdBy: { select: { fullName: true } }, items: true } });
      if (issue) { const itemNames = new Map((await prisma.item.findMany({ where: { companyId, id: { in: issue.items.map((line)=>line.itemId) } }, select: { id: true, name: true } })).map((item)=>[item.id,item.name])); document = { type, title: type, documentNo: issue.issueNo, date: issue.issueDate, company: identity, createdBy: issue.createdBy.fullName, subject: [{ label: 'Order', value: issue.order?.orderNo ?? '—' }, { label: 'ปลายทาง', value: issue.destination }, { label: 'สถานะ', value: issue.status }], lines: issue.items.map((line)=>({ name:itemNames.get(line.itemId)??line.itemId,quantity:line.issuedQty.toString(),unit:line.unit })), note: issue.note }; }
    } else if (type === 'RECIPE_COST_SHEET') {
      const recipe = await prisma.recipe.findFirst({ where: { id, companyId }, include: { product: true, versions: { where: { isActive: true }, take: 1, include: { ingredients: { include: { item: true, unit: true } }, costs: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } } }); const version=recipe?.versions[0]; const cost=version?.costs[0];
      if(recipe&&version)document={type,title:type,documentNo:`${recipe.code}-V${version.versionNo}`,date:cost?.calculatedAt??version.createdAt,company:identity,subject:[{label:'เมนู',value:recipe.product.name},{label:'Version',value:String(version.versionNo)},{label:'Yield',value:version.standardYieldQty.toString()}],lines:version.ingredients.map((line)=>({name:line.item.name,quantity:line.quantity.toString(),unit:line.unit?.code??line.item.baseUnitId,price:line.item.lastCost.toString(),total:line.quantity.mul(line.item.lastCost).toString()})),total:cost?.totalCost.toString(),note:version.note};
    } else {
      const start=new Date(new Date().getFullYear(),new Date().getMonth(),1);const orders=await prisma.salesOrder.findMany({where:{companyId,status:'DELIVERED',deliveredAt:{gte:start}},include:{customer:true}});document={type,title:type,documentNo:`SALES-${start.toISOString().slice(0,7)}`,date:new Date(),company:identity,subject:[{label:'รอบรายงาน',value:start.toLocaleDateString('th-TH',{month:'long',year:'numeric'})},{label:'ออเดอร์ส่งสำเร็จ',value:String(orders.length)}],lines:orders.map((order)=>({name:order.orderNo,detail:order.customer.name,quantity:1,unit:'order',total:order.totalAmount.toString()})),total:orders.reduce((sum,order)=>sum.plus(order.totalAmount),new Prisma.Decimal(0)).toString()};
    }
    if (!document) return reply.status(404).send(fail('DOCUMENT_SOURCE_NOT_FOUND', 'ไม่พบข้อมูลต้นทางของเอกสารในบริษัทปัจจุบัน'));
    const pdf = await renderBusinessPdf(document); await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'DOWNLOAD', entity: type, entityId: id } });
    return reply.header('Content-Type','application/pdf').header('Content-Disposition',`inline; filename="${type.toLowerCase()}-${document.documentNo}.pdf"`).send(pdf);
  });

  app.get('/operations/lookups', { preHandler: requirePermission('RECEIVING_CREATE', 'STOCK_ISSUE_CREATE', 'ORDER_VIEW') }, async (req) => {
    const companyId = req.user.companyId!;
    const [warehouses, suppliers, items, orders] = await Promise.all([
      prisma.warehouse.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.supplier.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true, type: true, imageUrl: true, lastCost: true, purchaseToBaseFactor: true, baseUnit: { select: { code: true, name: true } }, purchaseUnit: { select: { code: true, name: true } }, stockBalances: { select: { warehouseId: true, onHand: true, reserved: true } } }, orderBy: { name: 'asc' } }),
      prisma.salesOrder.findMany({ where: { companyId, status: { in: ['CONFIRMED', 'SENT_TO_PREP', 'PICKING'] } }, select: { id: true, orderNo: true, deliveryDate: true, deliveryTime: true, status: true, customer: { select: { name: true } }, items: { select: { menuNameSnapshot: true, quantity: true } } }, orderBy: { deliveryDate: 'asc' }, take: 100 }),
    ]);
    return ok({ warehouses, suppliers, items, orders });
  });

  app.get('/receiving', { preHandler: requirePermission('RECEIVING_VIEW', 'RECEIVING_CREATE') }, async (req) => ok(await prisma.goodsReceipt.findMany({
    where: { companyId: req.user.companyId! },
    include: { supplier: { select: { name: true } }, warehouse: { select: { name: true } }, items: { include: { item: { select: { name: true, code: true } } } } },
    orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }], take: 200,
  })));

  app.get('/receiving/:id', { preHandler: requirePermission('RECEIVING_VIEW', 'RECEIVING_CREATE') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId: req.user.companyId! }, include: { supplier: true, warehouse: true, items: { include: { item: { include: { baseUnit: true, purchaseUnit: true } } } } } });
    return receipt ? ok(receipt) : reply.status(404).send(fail('RECEIPT_NOT_FOUND', 'ไม่พบรายการรับของในบริษัทปัจจุบัน'));
  });

  app.get('/stock-issues', { preHandler: requirePermission('STOCK_ISSUE_VIEW', 'STOCK_ISSUE_CREATE') }, async (req) => ok(await prisma.stockIssue.findMany({
    where: { companyId: req.user.companyId! }, include: { order: { select: { orderNo: true, customer: { select: { name: true } } } }, createdBy: { select: { fullName: true } }, items: true }, orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }], take: 200,
  })));

  app.get('/stock-issues/:id', { preHandler: requirePermission('STOCK_ISSUE_VIEW', 'STOCK_ISSUE_CREATE') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const issue = await prisma.stockIssue.findFirst({ where: { id, companyId: req.user.companyId! }, include: { order: { include: { customer: true } }, createdBy: { select: { fullName: true } }, items: true } });
    return issue ? ok(issue) : reply.status(404).send(fail('STOCK_ISSUE_NOT_FOUND', 'ไม่พบรายการเบิกของในบริษัทปัจจุบัน'));
  });

  app.get('/company', { preHandler: requirePermission('SYSTEM_SETTINGS') }, async (req, reply) => {
    const company = await prisma.company.findUnique({ where: { id: req.user.companyId! } });
    if (!company) return reply.status(404).send(fail('COMPANY_NOT_FOUND', 'ไม่พบบริษัท'));
    return ok({ ...company, nameTh: company.code === 'S2A-PRIMARY' ? 'ครัวสดดี' : company.nameTh, providers: { email: notificationChannels.email.configured(), line: notificationChannels.line.configured() } });
  });

  app.patch('/company', { preHandler: requirePermission('SYSTEM_SETTINGS') }, async (req) => {
    const body = z.object({ nameTh: z.string().trim().min(1).max(160), nameEn: z.string().trim().max(160).nullable().optional(), logoUrl: z.string().max(500).nullable().optional(), taxId: z.string().max(30).nullable().optional(), address: z.string().max(500).nullable().optional(), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional(), website: z.string().max(250).nullable().optional(), authorizedName: z.string().max(160).nullable().optional(), documentFooter: z.string().max(500).nullable().optional() }).parse(req.body);
    const before = await prisma.company.findUniqueOrThrow({ where: { id: req.user.companyId! } });
    const company = await prisma.company.update({ where: { id: before.id }, data: body });
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId: before.id, action: 'UPDATE', entity: 'CompanySettings', entityId: before.id, before, after: company } });
    return ok(company);
  });

  app.get('/customers', { preHandler: requirePermission('CUSTOMER_VIEW') }, async (req) => {
    const customers = await prisma.customer.findMany({ where: { companyId: req.user.companyId!, isActive: true }, include: { orders: { select: { id: true, orderNo: true, deliveryDate: true, status: true, totalAmount: true }, orderBy: { deliveryDate: 'desc' } } }, orderBy: { name: 'asc' } });
    return ok(customers.map(({ orders, ...customer }) => ({ ...customer, orderCount: orders.length, lastOrder: orders[0] ?? null, deliveredSales: orders.filter((order) => order.status === 'DELIVERED').reduce((sum, order) => sum.plus(order.totalAmount), new Prisma.Decimal(0)), upcomingOrders: orders.filter((order) => !['DELIVERED','CANCELLED'].includes(order.status) && order.deliveryDate >= new Date()).length })));
  });
  app.post('/customers', { preHandler: requirePermission('CUSTOMER_CREATE') }, async (req, reply) => {
    const body = customerSchema.parse(req.body);
    const customer = await prisma.customer.create({ data: { ...body, email: body.email || null, companyId: req.user.companyId! } });
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId: req.user.companyId, action: 'CREATE', entity: 'Customer', entityId: customer.id } });
    return reply.status(201).send(ok(customer));
  });

  app.get('/orders', { preHandler: requirePermission('ORDER_VIEW') }, async (req) => ok(await prisma.salesOrder.findMany({ where: { companyId: req.user.companyId! }, include: { customer: true, items: true }, orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'desc' }] })));
  app.post('/orders', { preHandler: requirePermission('ORDER_CREATE') }, async (req, reply) => {
    const body = orderSchema.parse(req.body); const companyId = req.user.companyId!;
    const customer = await prisma.customer.findFirst({ where: { id: body.customerId, companyId } });
    if (!customer) return reply.status(404).send(fail('CUSTOMER_NOT_FOUND', 'ไม่พบลูกค้าในบริษัทปัจจุบัน'));
    if (body.idempotencyKey) { const existing = await prisma.salesOrder.findFirst({ where: { companyId, idempotencyKey: body.idempotencyKey }, include: { items: true } }); if (existing) return ok(existing); }
    const subtotal = body.items.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.quantity).mul(item.unitPrice)), new Prisma.Decimal(0));
    const totalAmount = Prisma.Decimal.max(0, subtotal.minus(body.discount).plus(body.tax));
    const order = await prisma.$transaction(async (tx) => {
      const count = await tx.salesOrder.count({ where: { companyId } });
      const created = await tx.salesOrder.create({ data: { companyId, orderNo: `SO-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`, customerId: customer.id, deliveryDate: body.deliveryDate, deliveryTime: body.deliveryTime, contactName: body.contactName ?? customer.contactName, phone: body.phone ?? customer.phone, email: body.email || customer.email, deliveryAddress: body.deliveryAddress ?? customer.address, subtotal, discount: body.discount, tax: body.tax, totalAmount, note: body.note, idempotencyKey: body.idempotencyKey, createdByUserId: req.user.sub, items: { create: body.items.map((item) => ({ ...item, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: new Prisma.Decimal(item.quantity).mul(item.unitPrice) })) } }, include: { items: true, customer: true } });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'CREATE', entity: 'SalesOrder', entityId: created.id } });
      return created;
    });
    return reply.status(201).send(ok(order));
  });

  app.post('/orders/:id/transition', { preHandler: requirePermission('ORDER_CONFIRM', 'ORDER_SEND', 'ORDER_COMPLETE', 'ORDER_CANCEL') }, async (req, reply) => {
    const { id } = req.params as { id: string }; const { status, cancellationReason } = z.object({ status: z.nativeEnum(SalesOrderStatus), cancellationReason: z.string().max(500).optional() }).parse(req.body); const companyId = req.user.companyId!;
    const order = await prisma.salesOrder.findFirst({ where: { id, companyId } });
    if (!order) return reply.status(404).send(fail('ORDER_NOT_FOUND', 'ไม่พบออเดอร์ในบริษัทปัจจุบัน'));
    if (order.status === status) return ok(order);
    if (!transitions[order.status].includes(status)) return reply.status(409).send(fail('INVALID_TRANSITION', `ไม่สามารถเปลี่ยนสถานะจาก ${order.status} เป็น ${status}`));
    if (status === 'CANCELLED' && !cancellationReason?.trim()) return reply.status(400).send(fail('CANCELLATION_REASON_REQUIRED', 'กรุณาระบุเหตุผลการยกเลิก'));
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.salesOrder.update({ where: { id }, data: { status, cancellationReason, ...timestampFor(status) } });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STATUS_CHANGE', entity: 'SalesOrder', entityId: id, before: { status: order.status }, after: { status } } });
      if (status === 'SENT_TO_PREP') {
        const recipients = await tx.companyMembership.findMany({ where: { companyId, isActive: true, role: { name: 'OPERATIONS' } } });
        if (recipients.length) await tx.notification.createMany({ data: recipients.map(({ userId }) => ({ companyId, userId, type: 'ORDER_SENT_TO_PREP', severity: 'ACTION_REQUIRED', title: 'มีออเดอร์ใหม่รอเตรียม', message: `${order.orderNo} ถูกส่งให้ฝ่ายปฏิบัติการ`, entityType: 'SalesOrder', entityId: id, actionUrl: `/orders/${id}` })) });
      }
      return changed;
    });
    return ok(updated);
  });

  app.get('/orders/:id/demand', { preHandler: requirePermission('ORDER_VIEW') }, async (req, reply) => {
    const { id } = req.params as { id: string }; const companyId = req.user.companyId!;
    const order = await prisma.salesOrder.findFirst({ where: { id, companyId }, include: { items: true } });
    if (!order) return reply.status(404).send(fail('ORDER_NOT_FOUND', 'ไม่พบออเดอร์ในบริษัทปัจจุบัน'));
    const demand = new Map<string, { itemId: string; name: string; unit: string; quantity: Prisma.Decimal }>(); const warnings: string[] = [];
    for (const line of order.items) {
      const recipe = await prisma.recipe.findFirst({ where: { companyId, productId: line.menuId, deletedAt: null }, include: { versions: { where: { isActive: true }, take: 1, include: { ingredients: { include: { item: true, unit: true } } } } } });
      const version = recipe?.versions[0]; if (!version) { warnings.push(`เมนู ${line.menuNameSnapshot} ยังไม่มีสูตรที่ใช้งาน`); continue; }
      for (const ingredient of version.ingredients) { const quantity = ingredient.quantity.mul(line.quantity); const current = demand.get(ingredient.itemId); if (current) current.quantity = current.quantity.plus(quantity); else demand.set(ingredient.itemId, { itemId: ingredient.itemId, name: ingredient.item.name, unit: ingredient.unit?.code ?? ingredient.item.baseUnitId, quantity }); }
    }
    return ok({ items: [...demand.values()].map((item) => ({ ...item, quantity: item.quantity.toString() })), warnings });
  });

  app.get('/kpi', { preHandler: requirePermission('KPI_VIEW', 'DASHBOARD_VIEW') }, async (req) => {
    const companyId = req.user.companyId!; const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1); const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [totalOrders, todayOrders, monthOrders, deliveredToday, deliveredMonth, pending] = await Promise.all([
      prisma.salesOrder.count({ where: { companyId } }), prisma.salesOrder.count({ where: { companyId, deliveryDate: { gte: dayStart } } }), prisma.salesOrder.count({ where: { companyId, createdAt: { gte: monthStart } } }),
      prisma.salesOrder.aggregate({ where: { companyId, status: 'DELIVERED', deliveredAt: { gte: dayStart } }, _sum: { totalAmount: true } }), prisma.salesOrder.aggregate({ where: { companyId, status: 'DELIVERED', deliveredAt: { gte: monthStart } }, _sum: { totalAmount: true } }),
      prisma.salesOrder.aggregate({ where: { companyId, status: { notIn: ['DELIVERED', 'CANCELLED'] } }, _sum: { totalAmount: true } }),
    ]);
    return ok({ totalOrders, todayOrders, monthOrders, revenueToday: deliveredToday._sum.totalAmount ?? 0, revenueMonth: deliveredMonth._sum.totalAmount ?? 0, pendingRevenue: pending._sum.totalAmount ?? 0 });
  });

  app.get('/notifications', { preHandler: requirePermission('NOTIFICATION_VIEW') }, async (req) => ok(await prisma.notification.findMany({ where: { companyId: req.user.companyId!, userId: req.user.sub }, orderBy: { createdAt: 'desc' }, take: 50 })));
  app.post('/notifications/read-all', { preHandler: requirePermission('NOTIFICATION_VIEW') }, async (req) => ok(await prisma.notification.updateMany({ where: { companyId: req.user.companyId!, userId: req.user.sub, readAt: null }, data: { readAt: new Date() } })));

  app.post('/receiving', { preHandler: requirePermission('RECEIVING_CREATE') }, async (req, reply) => {
    const body = z.object({ receiptNo: z.string().min(1).max(50), warehouseId: z.string().min(1), supplierId: z.string().optional(), receiptDate: z.coerce.date().default(() => new Date()), note: z.string().max(500).optional(), items: z.array(z.object({ itemId: z.string().min(1), quantity: z.coerce.number().positive(), unitPrice: z.coerce.number().min(0), lotNo: z.string().optional(), expiryDate: z.coerce.date().optional() })).min(1) }).parse(req.body);
    const companyId = req.user.companyId!;
    const duplicate = await prisma.goodsReceipt.findUnique({ where: { receiptNo: body.receiptNo } });
    if (duplicate) return duplicate.companyId === companyId ? ok(duplicate) : reply.status(409).send(fail('RECEIPT_NO_CONFLICT', 'เลขที่ใบรับซ้ำกับบริษัทอื่น'));
    const warehouse = await prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId } });
    if (!warehouse) return reply.status(404).send(fail('WAREHOUSE_NOT_FOUND', 'ไม่พบคลังในบริษัทปัจจุบัน'));
    const received = await prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.create({ data: { companyId, receiptNo: body.receiptNo, warehouseId: body.warehouseId, supplierId: body.supplierId, receiptDate: body.receiptDate, note: body.note, status: 'CONFIRMED', createdById: req.user.sub, items: { create: body.items.map((item) => ({ ...item, totalCost: new Prisma.Decimal(item.quantity).mul(item.unitPrice) })) } }, include: { items: true } });
      for (const line of body.items) {
        const item = await tx.item.findFirst({ where: { id: line.itemId, companyId } });
        if (!item) throw new Error(`ITEM_NOT_FOUND:${line.itemId}`);
        const balance = await tx.stockBalance.findFirst({ where: { itemId: line.itemId, warehouseId: body.warehouseId, locationId: null, lotId: null } });
        const onHand = (balance?.onHand ?? new Prisma.Decimal(0)).plus(line.quantity);
        if (balance) await tx.stockBalance.update({ where: { id: balance.id }, data: { onHand, version: { increment: 1 } } });
        else await tx.stockBalance.create({ data: { itemId: line.itemId, warehouseId: body.warehouseId, onHand } });
        await tx.stockLedger.create({ data: { movementType: 'PURCHASE_RECEIPT', refType: 'GOODS_RECEIPT', refId: receipt.id, refNo: receipt.receiptNo, itemId: line.itemId, warehouseId: body.warehouseId, qtyIn: line.quantity, balanceAfter: onHand, unitCost: line.unitPrice, totalValue: new Prisma.Decimal(line.quantity).mul(line.unitPrice), createdById: req.user.sub } });
        await tx.itemPriceHistory.create({ data: { companyId, itemId: line.itemId, price: line.unitPrice, source: 'PURCHASE', note: `Goods receipt ${receipt.receiptNo}`, createdById: req.user.sub } });
        await tx.item.update({ where: { id: line.itemId }, data: { lastCost: line.unitPrice, updatedById: req.user.sub } });
      }
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'CONFIRM', entity: 'GoodsReceipt', entityId: receipt.id } });
      return receipt;
    });
    return reply.status(201).send(ok(received));
  });

  app.post('/stock-issues', { preHandler: requirePermission('STOCK_ISSUE_CREATE') }, async (req, reply) => {
    const body = z.object({ issueNo: z.string().min(1).max(50), warehouseId: z.string().min(1), orderId: z.string().optional(), note: z.string().max(500).optional(), idempotencyKey: z.string().min(1).max(100), items: z.array(z.object({ itemId: z.string().min(1), requiredQty: z.coerce.number().min(0), issuedQty: z.coerce.number().positive(), unit: z.string().min(1), baseQty: z.coerce.number().positive(), note: z.string().optional() })).min(1) }).parse(req.body);
    const companyId = req.user.companyId!;
    const existing = await prisma.stockIssue.findFirst({ where: { companyId, idempotencyKey: body.idempotencyKey }, include: { items: true } });
    if (existing) return ok(existing);
    const issued = await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { id: body.warehouseId, companyId } });
      if (!warehouse) throw new Error('WAREHOUSE_NOT_FOUND');
      if (body.orderId && !await tx.salesOrder.findFirst({ where: { id: body.orderId, companyId } })) throw new Error('ORDER_NOT_FOUND');
      for (const line of body.items) {
        const item = await tx.item.findFirst({ where: { id: line.itemId, companyId } });
        const balance = await tx.stockBalance.findFirst({ where: { itemId: line.itemId, warehouseId: body.warehouseId, locationId: null, lotId: null } });
        if (!item || !balance || balance.onHand.lt(line.baseQty)) throw new Error(`INSUFFICIENT_STOCK:${item?.name ?? line.itemId}`);
      }
      const issue = await tx.stockIssue.create({ data: { companyId, issueNo: body.issueNo, warehouseId: body.warehouseId, orderId: body.orderId, note: body.note, idempotencyKey: body.idempotencyKey, createdByUserId: req.user.sub, status: 'ISSUED', issuedAt: new Date(), items: { create: body.items } }, include: { items: true } });
      for (const line of body.items) {
        const balance = await tx.stockBalance.findFirstOrThrow({ where: { itemId: line.itemId, warehouseId: body.warehouseId, locationId: null, lotId: null } });
        const onHand = balance.onHand.minus(line.baseQty);
        await tx.stockBalance.update({ where: { id: balance.id }, data: { onHand, version: { increment: 1 } } });
        await tx.stockLedger.create({ data: { movementType: 'PRODUCTION_ISSUE', refType: 'STOCK_ISSUE', refId: issue.id, refNo: issue.issueNo, itemId: line.itemId, warehouseId: body.warehouseId, qtyOut: line.baseQty, balanceAfter: onHand, createdById: req.user.sub } });
      }
      if (body.orderId) await tx.salesOrder.update({ where: { id: body.orderId }, data: { status: 'ISSUED', issuedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'ISSUE', entity: 'StockIssue', entityId: issue.id } });
      return issue;
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'STOCK_ISSUE_FAILED';
      if (message.startsWith('INSUFFICIENT_STOCK:')) throw Errors.insufficientStock({ item: message.split(':')[1] });
      throw error;
    });
    return reply.status(201).send(ok(issued));
  });
}
