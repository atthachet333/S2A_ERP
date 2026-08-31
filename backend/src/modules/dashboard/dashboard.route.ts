import type { FastifyInstance } from 'fastify';
import { ItemType, ProductionStatus, PurchaseOrderStatus } from '@prisma/client';
import { num } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { ok } from '../../lib/response.js';
import { requireCompany } from '../auth/auth.guard.js';
import { costStatusOf } from '../../lib/cost-status.js';

/**
 * GET /api/dashboard/summary — ตัวเลขสรุปจากฐานข้อมูลจริง (read-only)
 * ใช้กับ Dashboard: System Overview และ Setup Progress
 * ตรวจ auth + ต้องเปลี่ยนรหัสผ่านแล้ว ตาม guard เดิม (ไม่แก้ auth flow)
 */
export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/summary', { preHandler: requireCompany }, async (req) => {
    const [users, activeUsers, units, warehouses, items, recipes, rawMaterials, menus, activeRecipes, itemsWithoutPrice, productionRuns, purchasePlans, purchaseOrders, valuationBalances, valuationSnapshots, costMoverItems] = await Promise.all([
      prisma.companyMembership.count({ where: { companyId: req.user.companyId!, user: { deletedAt: null } } }),
      prisma.companyMembership.count({ where: { companyId: req.user.companyId!, isActive: true, user: { deletedAt: null, isActive: true } } }),
      prisma.unit.count({ where: { deletedAt: null } }),
      prisma.warehouse.count({ where: { deletedAt: null, companyId: req.user.companyId! } }),
      prisma.item.count({ where: { deletedAt: null, companyId: req.user.companyId! } }),
      prisma.recipe.count({ where: { deletedAt: null, companyId: req.user.companyId! } }),
      prisma.item.count({ where: { deletedAt: null, type: ItemType.RAW_MATERIAL, companyId: req.user.companyId! } }),
      prisma.item.count({ where: { deletedAt: null, type: ItemType.FINISHED_GOOD, companyId: req.user.companyId! } }),
      prisma.recipe.count({ where: { deletedAt: null, isActive: true, companyId: req.user.companyId!, versions: { some: { isActive: true } } } }),
      /* PHASE 21 — นับเฉพาะที่ "ยังไม่มีข้อมูลต้นทุน" จริง ๆ
         รายการที่ยืนยันแล้วว่าต้นทุนเป็น 0 (เช่น น้ำประปา) จะมีแถวประวัติราคาอยู่
         จึงหลุดออกจากคำเตือนนี้เอง ไม่ต้องเตือนซ้ำทั้งที่จัดการเรียบร้อยแล้ว
         เพิ่ม isActive เพราะของที่ปิดใช้งานแล้วไม่กระทบต้นทุนสูตรที่ใช้อยู่ */
      prisma.item.count({ where: { deletedAt: null, isActive: true, companyId: req.user.companyId!, type: { not: ItemType.FINISHED_GOOD }, priceHistory: { none: {} } } }),
      prisma.productionOrder.findMany({ where: { companyId: req.user.companyId!, status: ProductionStatus.COMPLETED }, select: { plannedQty: true, producedQty: true, standardCost: true, actualCost: true, recipeVersion: { select: { yieldMode: true } }, wastes: { select: { quantity: true, unitCode: true } } } }),
      prisma.purchasePlan.findMany({ where: { companyId: req.user.companyId!, status: { in: ['DRAFT', 'READY'] } }, select: { status: true, requirements: { select: { shortageQty: true, estimatedCost: true } } } }),
      prisma.purchaseOrder.findMany({ where: { companyId: req.user.companyId!, status: { not: PurchaseOrderStatus.CANCELLED } }, select: { status: true, expectedDeliveryAt: true } }),
      prisma.stockBalance.findMany({ where: { warehouse: { companyId: req.user.companyId! }, item: { companyId: req.user.companyId!, deletedAt: null } }, select: { onHand: true, item: { select: { lastCost: true, _count: { select: { priceHistory: true } } } } } }),
      prisma.inventoryValuationSnapshot.findMany({ where: { companyId: req.user.companyId! }, orderBy: { businessDate: 'desc' }, take: 12, select: { id: true, businessDate: true, knownInventoryValue: true, valuationCompleteness: true } }),
      prisma.item.findMany({ where: { companyId: req.user.companyId!, deletedAt: null, priceHistory: { some: {} } }, select: { id: true, code: true, name: true, priceHistory: { orderBy: { createdAt: 'desc' }, take: 2, select: { price: true, createdAt: true, source: true } } } }),
    ]);
    const measurable = productionRuns.filter((row) => row.recipeVersion?.yieldMode !== 'BATCH' && num(row.plannedQty) > 0);
    const wasteByUnit = new Map<string, number>(); for (const row of productionRuns) for (const waste of row.wastes) wasteByUnit.set(waste.unitCode ?? 'ไม่ระบุหน่วย', (wasteByUnit.get(waste.unitCode ?? 'ไม่ระบุหน่วย') ?? 0) + num(waste.quantity));
    const now = new Date();
    const valued = valuationBalances.map((balance) => ({ onHand: num(balance.onHand), cost: num(balance.item.lastCost), status: costStatusOf({ lastCost: num(balance.item.lastCost), priceRecordCount: balance.item._count.priceHistory }) }));
    const costMovers=costMoverItems.flatMap((item)=>item.priceHistory.length<2?[]:[{itemId:item.id,itemCode:item.code,itemName:item.name,previousCost:num(item.priceHistory[1]!.price),latestCost:num(item.priceHistory[0]!.price),change:num(item.priceHistory[0]!.price.minus(item.priceHistory[1]!.price)),latestAt:item.priceHistory[0]!.createdAt,latestSource:item.priceHistory[0]!.source}]).sort((a,b)=>Math.abs(b.change)-Math.abs(a.change)).slice(0,3);
    return ok({ users, activeUsers, units, warehouses, items, recipes, rawMaterials, menus, activeRecipes, itemsWithoutPrice, production: { runs: productionRuns.length, averageYieldPercent: measurable.length ? measurable.reduce((sum, row) => sum + num(row.producedQty) / num(row.plannedQty) * 100, 0) / measurable.length : null, costVariance: productionRuns.reduce((sum, row) => sum + num(row.actualCost) - num(row.standardCost), 0), recordedWaste: [...wasteByUnit].map(([unitCode, quantity]) => ({ unitCode, quantity })), lowSample: productionRuns.length > 0 && productionRuns.length < 3 }, purchasePlanning: { plans: purchasePlans.length, draftPlans: purchasePlans.filter((plan) => plan.status === 'DRAFT').length, shortageItems: purchasePlans.reduce((sum, plan) => sum + plan.requirements.filter((line) => num(line.shortageQty) > 0).length, 0), estimatedCost: purchasePlans.reduce((sum, plan) => sum + plan.requirements.reduce((subtotal, line) => subtotal + num(line.estimatedCost), 0), 0) }, purchaseOrders: { draft: purchaseOrders.filter((order) => order.status === PurchaseOrderStatus.DRAFT).length, awaitingDelivery: purchaseOrders.filter((order) => order.status === PurchaseOrderStatus.CONFIRMED).length, partial: purchaseOrders.filter((order) => order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED).length, overdue: purchaseOrders.filter((order) => (order.status === PurchaseOrderStatus.CONFIRMED || order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED) && order.expectedDeliveryAt != null && order.expectedDeliveryAt < now).length }, inventoryValuation: { knownValue: valued.filter((row) => row.status !== 'MISSING').reduce((sum, row) => sum + row.onHand * row.cost, 0), unknownCostStockCount: valued.filter((row) => row.status === 'MISSING' && row.onHand !== 0).length, history: valuationSnapshots.reverse().map((row) => ({ snapshotId: row.id, businessDate: row.businessDate, knownValue: num(row.knownInventoryValue), completeness: num(row.valuationCompleteness) })) }, costInsights:{productionVariance:productionRuns.reduce((sum,row)=>sum+num(row.actualCost)-num(row.standardCost),0),productionRunCount:productionRuns.length,movers:costMovers} });
  });
}
