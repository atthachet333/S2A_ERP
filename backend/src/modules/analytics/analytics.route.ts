import type { FastifyInstance, FastifyReply } from 'fastify';
import { DocumentStatus, ItemType, Prisma, PurchaseOrderStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { costStatusOf } from '../../lib/cost-status.js';
import { num } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';
import { createInventorySnapshot, currentSnapshotPreview } from './inventory-snapshot.service.js';

const purchasingRead = requirePermission('RECEIVING_VIEW', 'PURCHASE_ORDER_VIEW');
const stockRead = requirePermission('INVENTORY_VIEW', 'STOCK_VIEW');
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const pct = (value: Prisma.Decimal) => Number(value.toDecimalPlaces(4));
const comparable = (line: { purchaseUnitCode: string | null; purchaseToBaseFactor: Prisma.Decimal | null }) =>
  Boolean(line.purchaseUnitCode && line.purchaseToBaseFactor?.gt(0));
const xlsxReply = async (reply: FastifyReply, workbook: ExcelJS.Workbook, filename: string) => {
  const buffer = await workbook.xlsx.writeBuffer();
  return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('Content-Disposition', `attachment; filename="${filename}"`).send(Buffer.from(buffer));
};

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B5B' } };
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + sheet.columnCount)}1` };
}

export async function supplierSummary(companyId: string) {
  const [suppliers, receipts, orders] = await Promise.all([
    prisma.supplier.findMany({ where: { companyId, deletedAt: null }, orderBy: { name: 'asc' } }),
    prisma.goodsReceipt.findMany({ where: { companyId, status: DocumentStatus.CONFIRMED, supplierId: { not: null } }, select: { supplierId: true, receiptDate: true, items: { select: { itemId: true, totalCost: true } } } }),
    prisma.purchaseOrder.findMany({ where: { companyId }, select: { supplierId: true, status: true } }),
  ]);
  const receiptMap = new Map<string, typeof receipts>();
  for (const row of receipts) { const list = receiptMap.get(row.supplierId!) ?? []; list.push(row); receiptMap.set(row.supplierId!, list); }
  const orderMap = new Map<string, typeof orders>();
  for (const row of orders) { const list = orderMap.get(row.supplierId) ?? []; list.push(row); orderMap.set(row.supplierId, list); }
  return suppliers.map((supplier) => {
    const rs = receiptMap.get(supplier.id) ?? []; const os = orderMap.get(supplier.id) ?? [];
    return { ...supplier, receiptCount: rs.length, poCount: os.filter((o) => o.status !== PurchaseOrderStatus.CANCELLED).length,
      totalReceivedValue: Number(rs.reduce((sum, r) => sum.plus(r.items.reduce((s, i) => s.plus(i.totalCost), D(0))), D(0))),
      latestPurchaseDate: rs.reduce<Date | null>((latest, r) => !latest || r.receiptDate > latest ? r.receiptDate : latest, null),
      distinctItemsPurchased: new Set(rs.flatMap((r) => r.items.map((i) => i.itemId))).size,
      openPoCount: os.filter((o) => o.status === PurchaseOrderStatus.CONFIRMED).length,
      partialPoCount: os.filter((o) => o.status === PurchaseOrderStatus.PARTIALLY_RECEIVED).length,
      fullyReceivedPoCount: os.filter((o) => o.status === PurchaseOrderStatus.RECEIVED).length,
      cancelledPoCount: os.filter((o) => o.status === PurchaseOrderStatus.CANCELLED).length,
      dataWarnings: [!supplier.taxId && 'MISSING_TAX_ID', !supplier.phone && !supplier.email && 'MISSING_CONTACT'].filter(Boolean),
    };
  });
}

async function supplierDetail(companyId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId, deletedAt: null } });
  if (!supplier) return null;
  const [receipts, orders] = await Promise.all([
    prisma.goodsReceipt.findMany({ where: { companyId, supplierId, status: DocumentStatus.CONFIRMED }, orderBy: { receiptDate: 'desc' }, include: { purchaseOrder: { select: { id: true, poNo: true } }, items: { include: { item: { include: { baseUnit: true } }, purchaseOrderItem: true } } } }),
    prisma.purchaseOrder.findMany({ where: { companyId, supplierId }, orderBy: { orderDate: 'desc' }, include: { items: { include: { goodsReceiptItems: { where: { goodsReceipt: { status: DocumentStatus.CONFIRMED } }, include: { goodsReceipt: { select: { receiptDate: true, receiptNo: true } } } } } } } }),
  ]);
  type Observation = { itemId: string; itemCode: string; itemName: string; baseUnitCode: string; purchaseUnitCode: string | null; factor: number | null; quantity: number; unitPrice: number; basePrice: number | null; receivedAt: Date; receiptNo: string; poPrice: number | null };
  const observations: Observation[] = receipts.flatMap((receipt) => receipt.items.map((line) => ({ itemId: line.itemId, itemCode: line.item.code, itemName: line.item.name, baseUnitCode: line.item.baseUnit.code,
    purchaseUnitCode: line.purchaseUnitCode, factor: line.purchaseToBaseFactor ? num(line.purchaseToBaseFactor) : null, quantity: num(line.quantity), unitPrice: num(line.unitPrice),
    basePrice: comparable(line) ? num(line.unitPrice.div(line.purchaseToBaseFactor!)) : null, receivedAt: receipt.receiptDate, receiptNo: receipt.receiptNo, poPrice: line.purchaseOrderItem ? num(line.purchaseOrderItem.unitPrice) : null })));
  const byItem = new Map<string, Observation[]>(); for (const o of observations) { const list = byItem.get(o.itemId) ?? []; list.push(o); byItem.set(o.itemId, list); }
  const itemHistory = [...byItem.values()].map((list) => {
    const sorted = [...list].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()); const latest = sorted[0];
    const sameUnit = sorted.filter((o) => o.purchaseUnitCode === latest.purchaseUnitCode && o.factor === latest.factor);
    const prices = sameUnit.map((o) => o.unitPrice); const previous = sameUnit[1] ?? null;
    return { itemId: latest.itemId, itemCode: latest.itemCode, itemName: latest.itemName, purchaseUnitCode: latest.purchaseUnitCode, baseUnitCode: latest.baseUnitCode,
      lastActualPrice: latest.unitPrice, previousPrice: previous?.unitPrice ?? null, averageActualPrice: prices.reduce((s, p) => s + p, 0) / prices.length,
      minActualPrice: Math.min(...prices), maxActualPrice: Math.max(...prices), lastReceivedDate: latest.receivedAt,
      totalPurchasedQuantity: sameUnit.reduce((s, o) => s + o.quantity, 0), observationCount: sameUnit.length,
      priceChange: previous ? { amount: latest.unitPrice - previous.unitPrice, percent: previous.unitPrice === 0 ? null : (latest.unitPrice - previous.unitPrice) / previous.unitPrice * 100 } : null,
      incompatibleObservationCount: sorted.length - sameUnit.length,
      points: sameUnit.slice().reverse().map((o) => ({ date: o.receivedAt, price: o.unitPrice, receiptNo: o.receiptNo })),
    };
  }).sort((a, b) => b.lastReceivedDate.getTime() - a.lastReceivedDate.getTime());
  const linked = observations.filter((o) => o.poPrice != null);
  const varianceRows = linked.map((o) => ({ ...o, variance: o.unitPrice - o.poPrice!, variancePercent: o.poPrice === 0 ? null : (o.unitPrice - o.poPrice!) / o.poPrice! * 100 }));
  const weightedPo = linked.reduce((s, o) => s.plus(D(o.poPrice!).mul(o.quantity)), D(0)); const weightedActual = linked.reduce((s, o) => s.plus(D(o.unitPrice).mul(o.quantity)), D(0));
  const totalSpend = receipts.reduce((sum, r) => sum.plus(r.items.reduce((s, i) => s.plus(i.totalCost), D(0))), D(0));
  return { supplier, summary: { receiptCount: receipts.length, poCount: orders.filter((o) => o.status !== PurchaseOrderStatus.CANCELLED).length, totalReceivedValue: Number(totalSpend), latestPurchaseDate: receipts[0]?.receiptDate ?? null,
    distinctItemsPurchased: byItem.size, openPoCount: orders.filter((o) => o.status === PurchaseOrderStatus.CONFIRMED).length, partialPoCount: orders.filter((o) => o.status === PurchaseOrderStatus.PARTIALLY_RECEIVED).length,
    poVsActualVariancePercent: weightedPo.eq(0) ? null : pct(weightedActual.minus(weightedPo).div(weightedPo).mul(100)) }, itemHistory, varianceRows,
    orders: orders.map((order) => ({ id: order.id, poNo: order.poNo, status: order.status, orderDate: order.orderDate, expectedDeliveryAt: order.expectedDeliveryAt,
      ordered: order.items.reduce((s, i) => s + num(i.orderedQty), 0), received: order.items.reduce((s, i) => s + i.goodsReceiptItems.reduce((x, r) => x + num(r.quantity), 0), 0),
      remaining: order.items.reduce((s, i) => s + Math.max(num(i.orderedQty) - i.goodsReceiptItems.reduce((x, r) => x + num(r.quantity), 0), 0), 0),
      overReceived: order.items.reduce((s, i) => s + Math.max(i.goodsReceiptItems.reduce((x, r) => x + num(r.quantity), 0) - num(i.orderedQty), 0), 0) })),
    warnings: [!supplier.taxId && 'MISSING_TAX_ID', !supplier.phone && !supplier.email && 'MISSING_CONTACT', receipts.some((r) => !r.purchaseOrderId) && 'RECEIPTS_WITHOUT_PO', itemHistory.some((i) => i.incompatibleObservationCount > 0) && 'INCOMPATIBLE_UNITS'].filter(Boolean) };
}

export async function valuation(companyId: string, query: { warehouseId?: string; type?: ItemType; categoryId?: string; costStatus?: 'PRICED'|'ZERO'|'MISSING'; stock?: 'POSITIVE'|'ZERO'|'NEGATIVE' }) {
  const balances = await prisma.stockBalance.findMany({ where: { ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}), warehouse: { companyId }, item: { companyId, deletedAt: null, ...(query.type ? { type: query.type } : {}), ...(query.categoryId ? { categoryId: query.categoryId } : {}) } },
    include: { warehouse: { select: { id: true, code: true, name: true } }, item: { include: { baseUnit: true, category: true, priceHistory: { orderBy: { createdAt: 'desc' }, take: 1 } } } } });
  const rows = balances.map((b) => { const onHand = num(b.onHand); const reserved = num(b.reserved); const cost = num(b.item.lastCost); const status = costStatusOf({ lastCost: cost, priceRecordCount: b.item.priceHistory.length });
    const source = status === 'MISSING' ? 'UNKNOWN' : status === 'ZERO' ? 'EXPLICIT_ZERO' : (['PURCHASE','PRODUCTION'].includes(b.item.priceHistory[0]?.source ?? '') ? b.item.priceHistory[0]!.source : 'UNKNOWN');
    return { itemId: b.itemId, itemCode: b.item.code, itemName: b.item.name, itemType: b.item.type, categoryId: b.item.categoryId, categoryName: b.item.category?.name ?? null, warehouseId: b.warehouseId, warehouseCode: b.warehouse.code, warehouseName: b.warehouse.name,
      onHand, reserved, available: onHand - reserved, baseUnitCode: b.item.baseUnit.code, unitCost: status === 'MISSING' ? null : cost, value: status === 'MISSING' ? null : Number(D(onHand).mul(cost)), costStatus: status, costSource: source };
  }).filter((r) => (!query.costStatus || r.costStatus === query.costStatus) && (!query.stock || (query.stock === 'POSITIVE' ? r.onHand > 0 : query.stock === 'NEGATIVE' ? r.onHand < 0 : r.onHand === 0)));
  const allCount = rows.length; const known = rows.filter((r) => r.costStatus !== 'MISSING');
  const group = (key: 'warehouseName'|'itemType') => {
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) { const list = grouped.get(row[key]) ?? []; list.push(row); grouped.set(row[key], list); }
    return [...grouped.entries()].map(([name, groupRows]) => ({ name, knownValue: groupRows.reduce((s, r) => s + (r.value ?? 0), 0), itemCount: new Set(groupRows.map((r) => r.itemId)).size, unknownCostItems: new Set(groupRows.filter((r) => r.costStatus === 'MISSING' && r.onHand !== 0).map((r) => r.itemId)).size, negativeStockItems: new Set(groupRows.filter((r) => r.onHand < 0).map((r) => r.itemId)).size }));
  };
  return { basis: 'มูลค่าสต็อกโดยประมาณจากต้นทุนปัจจุบัน (onHand × Item.lastCost ต่อหน่วยฐาน)', rows, summary: { knownValue: known.reduce((s, r) => s + (r.value ?? 0), 0), unknownCostStockCount: rows.filter((r) => r.costStatus === 'MISSING' && r.onHand !== 0).length, negativeStockCount: rows.filter((r) => r.onHand < 0).length, warehouses: new Set(rows.map((r) => r.warehouseId)).size,
    completeness: { known: known.length, total: allCount, percent: allCount ? Math.round(known.length / allCount * 10000) / 100 : 100 } }, byWarehouse: group('warehouseName'), byType: group('itemType') };
}

export default async function analyticsRoutes(app: FastifyInstance) {
  app.get('/supplier-analytics', { preHandler: purchasingRead }, async (req) => ok(await supplierSummary(req.user.companyId!)));
  app.get('/supplier-analytics/export.xlsx', { preHandler: purchasingRead }, async (req, reply) => { const rows = await supplierSummary(req.user.companyId!); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Supplier Purchase Analysis'); ws.columns = [{header:'Supplier',key:'name',width:30},{header:'Receipts',key:'receiptCount',width:12},{header:'POs',key:'poCount',width:10},{header:'Actual spend',key:'totalReceivedValue',width:18,style:{numFmt:'#,##0.00'}},{header:'Latest purchase',key:'latestPurchaseDate',width:18},{header:'Distinct items',key:'distinctItemsPurchased',width:15},{header:'Open PO',key:'openPoCount',width:12},{header:'Partial PO',key:'partialPoCount',width:12}]; ws.addRows(rows); styleSheet(ws); return xlsxReply(reply, wb, 'supplier-purchase-analysis.xlsx'); });
  app.get('/supplier-analytics/compare/:itemId', { preHandler: purchasingRead }, async (req, reply) => { const { itemId } = req.params as { itemId: string }; const item = await prisma.item.findFirst({ where: { id: itemId, companyId: req.user.companyId!, deletedAt: null }, include: { baseUnit: true } }); if (!item) return reply.status(404).send(fail('NOT_FOUND','ไม่พบสินค้าในบริษัทปัจจุบัน'));
    const lines = await prisma.goodsReceiptItem.findMany({ where: { itemId, goodsReceipt: { companyId: req.user.companyId!, status: DocumentStatus.CONFIRMED, supplierId: { not: null } }, purchaseToBaseFactor: { gt: 0 } }, orderBy: { goodsReceipt: { receiptDate: 'desc' } }, include: { goodsReceipt: { include: { supplier: true } } } }); const latest = new Map<string, typeof lines[number]>(); for (const line of lines) if (!latest.has(line.goodsReceipt.supplierId!)) latest.set(line.goodsReceipt.supplierId!, line); const rows = [...latest.values()].map((line) => ({ supplierId: line.goodsReceipt.supplierId, supplierName: line.goodsReceipt.supplier!.name, latestActualPrice: num(line.unitPrice), purchaseUnitCode: line.purchaseUnitCode, comparableBasePrice: num(line.unitPrice.div(line.purchaseToBaseFactor!)), latestDate: line.goodsReceipt.receiptDate })); const low = rows.length ? Math.min(...rows.map((r) => r.comparableBasePrice)) : null; return ok({ item: { id:item.id,code:item.code,name:item.name,baseUnitCode:item.baseUnit.code }, rows: rows.map((r) => ({...r,differenceFromLowestBase: low == null ? null : r.comparableBasePrice-low})) }); });
  app.get('/supplier-analytics/:id', { preHandler: purchasingRead }, async (req, reply) => { const detail = await supplierDetail(req.user.companyId!, (req.params as {id:string}).id); return detail ? ok(detail) : reply.status(404).send(fail('NOT_FOUND','ไม่พบผู้จำหน่ายในบริษัทปัจจุบัน')); });
  const valuationQuery = z.object({ warehouseId:z.string().optional(), type:z.nativeEnum(ItemType).optional(), categoryId:z.string().optional(), costStatus:z.enum(['PRICED','ZERO','MISSING']).optional(), stock:z.enum(['POSITIVE','ZERO','NEGATIVE']).optional() });
  app.get('/inventory/valuation', { preHandler: stockRead }, async (req) => ok(await valuation(req.user.companyId!, valuationQuery.parse(req.query ?? {}))));
  app.get('/inventory/valuation/export.xlsx', { preHandler: stockRead }, async (req, reply) => { const data = await valuation(req.user.companyId!, valuationQuery.parse(req.query ?? {})); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Inventory Valuation'); ws.columns=[{header:'Item code',key:'itemCode',width:16},{header:'Item',key:'itemName',width:30},{header:'Warehouse',key:'warehouseName',width:24},{header:'Type',key:'itemType',width:18},{header:'Category',key:'categoryName',width:20},{header:'On hand',key:'onHand',width:14,style:{numFmt:'#,##0.0000'}},{header:'Reserved',key:'reserved',width:14,style:{numFmt:'#,##0.0000'}},{header:'Available',key:'available',width:14,style:{numFmt:'#,##0.0000'}},{header:'Base unit',key:'baseUnitCode',width:12},{header:'Unit cost',key:'unitCost',width:14,style:{numFmt:'#,##0.0000'}},{header:'Value',key:'value',width:18,style:{numFmt:'#,##0.00'}},{header:'Cost status',key:'costStatus',width:14},{header:'Cost source',key:'costSource',width:14}]; ws.addRows(data.rows); styleSheet(ws); return xlsxReply(reply,wb,'inventory-valuation.xlsx'); });

  app.get('/inventory/valuation/snapshot-preview',{preHandler:stockRead},async req=>{const p=await currentSnapshotPreview(req.user.companyId!);return ok({...p,lines:undefined})});
  app.post('/inventory/valuation/snapshots',{preHandler:requirePermission('INVENTORY_ADJUST','SYSTEM_SETTINGS')},async(req,reply)=>{const result=await createInventorySnapshot(req.user.companyId!,req.user.sub);return reply.status(result.created?201:200).send(ok(result,result.created?'สร้าง Snapshot วันนี้แล้ว':'วันนี้มี Snapshot อยู่แล้ว'))});
  app.get('/inventory/valuation/history',{preHandler:stockRead},async req=>ok(await prisma.inventoryValuationSnapshot.findMany({where:{companyId:req.user.companyId!},orderBy:{businessDate:'asc'}})));
  app.get('/inventory/valuation/history/export.xlsx',{preHandler:stockRead},async(req,reply)=>{const rows=await prisma.inventoryValuationSnapshot.findMany({where:{companyId:req.user.companyId!},orderBy:{businessDate:'asc'}});const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Inventory Valuation History');ws.columns=[{header:'Business date',key:'businessDate',width:18,style:{numFmt:'yyyy-mm-dd'}},{header:'Snapshot at',key:'snapshotAt',width:22,style:{numFmt:'yyyy-mm-dd hh:mm:ss'}},{header:'Known value',key:'knownInventoryValue',width:18,style:{numFmt:'#,##0.00'}},{header:'Known balances',key:'knownBalanceCount',width:16},{header:'Unknown balances',key:'unknownCostBalanceCount',width:18},{header:'Negative balances',key:'negativeStockCount',width:18},{header:'Completeness %',key:'valuationCompleteness',width:18,style:{numFmt:'0.00'}},{header:'Source',key:'source',width:16}];ws.addRows(rows);styleSheet(ws);return xlsxReply(reply,wb,'inventory-valuation-history.xlsx')});
  app.get('/analytics/inventory-value/history',{preHandler:stockRead},async req=>{const rows=await prisma.inventoryValuationSnapshot.findMany({where:{companyId:req.user.companyId!},orderBy:{businessDate:'asc'},include:{lines:true}});return ok(rows.map(row=>({snapshotId:row.id,businessDate:row.businessDate,snapshotAt:row.snapshotAt,knownInventoryValue:num(row.knownInventoryValue),knownBalanceCount:row.knownBalanceCount,unknownCostBalanceCount:row.unknownCostBalanceCount,completeness:num(row.valuationCompleteness),warehouses:Object.values(row.lines.reduce<Record<string,{warehouseId:string;warehouseName:string;knownValue:number;unknownBalances:number}>>((acc,line)=>{const x=acc[line.warehouseId]??={warehouseId:line.warehouseId,warehouseName:line.warehouseName,knownValue:0,unknownBalances:0};if(line.estimatedValue==null)x.unknownBalances++;else x.knownValue+=num(line.estimatedValue);return acc},{})),types:Object.values(row.lines.reduce<Record<string,{type:string;knownValue:number;unknownBalances:number}>>((acc,line)=>{const x=acc[line.itemType]??={type:line.itemType,knownValue:0,unknownBalances:0};if(line.estimatedValue==null)x.unknownBalances++;else x.knownValue+=num(line.estimatedValue);return acc},{}))})))});
  app.get('/inventory/valuation/history/:id',{preHandler:stockRead},async(req,reply)=>{const{id}=req.params as{id:string};const q=z.object({warehouseId:z.string().optional(),type:z.string().optional(),categoryId:z.string().optional(),costStatus:z.string().optional()}).parse(req.query??{});const snapshot=await prisma.inventoryValuationSnapshot.findFirst({where:{id,companyId:req.user.companyId!},include:{lines:{where:{warehouseId:q.warehouseId,itemType:q.type,categoryId:q.categoryId,costStatus:q.costStatus},orderBy:[{warehouseName:'asc'},{itemName:'asc'}]}}});return snapshot?ok(snapshot):reply.status(404).send(fail('SNAPSHOT_NOT_FOUND','ไม่พบ Snapshot ในบริษัทปัจจุบัน'))});
  app.get('/inventory/valuation/history/:id/export.xlsx',{preHandler:stockRead},async(req,reply)=>{const{id}=req.params as{id:string};const snapshot=await prisma.inventoryValuationSnapshot.findFirst({where:{id,companyId:req.user.companyId!},include:{lines:true}});if(!snapshot)return reply.status(404).send(fail('SNAPSHOT_NOT_FOUND','ไม่พบ Snapshot'));const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Snapshot Detail');ws.columns=[{header:'Item',key:'itemName',width:28},{header:'Warehouse',key:'warehouseName',width:22},{header:'Lot',key:'lotNo',width:16},{header:'On hand',key:'onHand',width:14,style:{numFmt:'#,##0.0000'}},{header:'Base unit',key:'baseUnitCode',width:12},{header:'Unit cost',key:'recognizedUnitCost',width:16,style:{numFmt:'#,##0.000000'}},{header:'Value',key:'estimatedValue',width:18,style:{numFmt:'#,##0.00'}},{header:'Cost status',key:'costStatus',width:14},{header:'Cost source',key:'costSource',width:14},{header:'Expiry',key:'expiryDate',width:16,style:{numFmt:'yyyy-mm-dd'}},{header:'Expiry status',key:'expiryStatus',width:18}];ws.addRows(snapshot.lines);styleSheet(ws);return xlsxReply(reply,wb,`inventory-snapshot-${snapshot.businessDate.toISOString().slice(0,10)}.xlsx`)});
  app.get('/inventory/valuation/compare',{preHandler:stockRead},async(req,reply)=>{const q=z.object({fromId:z.string(),toId:z.string()}).parse(req.query);const rows=await prisma.inventoryValuationSnapshot.findMany({where:{id:{in:[q.fromId,q.toId]},companyId:req.user.companyId!},include:{lines:true}});if(rows.length!==2)return reply.status(404).send(fail('SNAPSHOT_NOT_FOUND','ไม่พบ Snapshot ที่เปรียบเทียบ'));const from=rows.find(x=>x.id===q.fromId)!,to=rows.find(x=>x.id===q.toId)!;const aggregate=(lines:typeof from.lines)=>{const map=new Map<string,{itemId:string;itemCode:string;itemName:string;qty:Prisma.Decimal;value:Prisma.Decimal;known:boolean;cost:Prisma.Decimal|null}>();for(const line of lines){const x=map.get(line.itemId)??{itemId:line.itemId,itemCode:line.itemCode,itemName:line.itemName,qty:D(0),value:D(0),known:true,cost:null};x.qty=x.qty.plus(line.onHand);if(line.estimatedValue==null)x.known=false;else x.value=x.value.plus(line.estimatedValue);map.set(line.itemId,x)}for(const x of map.values())x.cost=x.known&&!x.qty.eq(0)?x.value.div(x.qty):null;return map};const a=aggregate(from.lines),b=aggregate(to.lines),ids=new Set([...a.keys(),...b.keys()]);const items=[...ids].map(id=>{const p=a.get(id),c=b.get(id),pq=p?.qty??D(0),cq=c?.qty??D(0),pc=p?.cost??null,cc=c?.cost??null;const quantityEffect=pc?cq.minus(pq).mul(pc):null,costEffect=pc&&cc?cq.mul(cc.minus(pc)):null;return{itemId:id,itemCode:c?.itemCode??p?.itemCode,itemName:c?.itemName??p?.itemName,previousQty:num(pq),currentQty:num(cq),qtyChange:num(cq.minus(pq)),previousUnitCost:pc?num(pc):null,currentUnitCost:cc?num(cc):null,costChange:pc&&cc?num(cc.minus(pc)):null,previousValue:p?.known?num(p.value):null,currentValue:c?.known?num(c.value):null,valueChange:p?.known&&c?.known?num(c.value.minus(p.value)):null,quantityEffect:quantityEffect?num(quantityEffect):null,costEffect:costEffect?num(costEffect):null}});return ok({from,to,inventoryValueChange:num(to.knownInventoryValue.minus(from.knownInventoryValue)),items})});
  app.get('/items/:itemId/cost-history',{preHandler:requirePermission('COST_VIEW','INVENTORY_VIEW','STOCK_VIEW')},async(req,reply)=>{const{itemId}=req.params as{itemId:string};const item=await prisma.item.findFirst({where:{id:itemId,companyId:req.user.companyId!,deletedAt:null},include:{baseUnit:true,priceHistory:{orderBy:{createdAt:'asc'}}}});if(!item)return reply.status(404).send(fail('ITEM_NOT_FOUND','ไม่พบสินค้า'));const points=item.priceHistory.map(row=>({id:row.id,at:row.createdAt,unitCost:num(row.price),source:row.source==='PURCHASE'?'PURCHASE':row.source==='PRODUCTION'?'PRODUCTION':num(row.price)===0?'EXPLICIT_ZERO':'UNKNOWN',unit:item.baseUnit.code,reference:row.note}));const previous=points.at(-2),current=points.at(-1);return ok({item:{id:item.id,code:item.code,name:item.name,baseUnit:item.baseUnit.code},points,incomparable:[],change:previous&&current?{previous:previous.unitCost,current:current.unitCost,difference:current.unitCost-previous.unitCost,percent:previous.unitCost===0?null:(current.unitCost-previous.unitCost)/previous.unitCost*100}:null})});
  app.get('/items/:itemId/cost-history/export.xlsx',{preHandler:requirePermission('COST_VIEW','INVENTORY_VIEW','STOCK_VIEW')},async(req,reply)=>{const{itemId}=req.params as{itemId:string};const item=await prisma.item.findFirst({where:{id:itemId,companyId:req.user.companyId!,deletedAt:null},include:{baseUnit:true,priceHistory:{orderBy:{createdAt:'asc'}}}});if(!item)return reply.status(404).send(fail('ITEM_NOT_FOUND','ไม่พบสินค้า'));const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Item Cost History');ws.columns=[{header:'Event time',key:'at',width:22,style:{numFmt:'yyyy-mm-dd hh:mm:ss'}},{header:'Item code',key:'itemCode',width:16},{header:'Item',key:'itemName',width:28},{header:'Base-unit cost',key:'unitCost',width:18,style:{numFmt:'#,##0.000000'}},{header:'Unit',key:'unit',width:12},{header:'Source',key:'source',width:16},{header:'Reference',key:'reference',width:32}];ws.addRows(item.priceHistory.map(row=>({at:row.createdAt,itemCode:item.code,itemName:item.name,unitCost:num(row.price),unit:item.baseUnit.code,source:row.source==='PURCHASE'?'PURCHASE':row.source==='PRODUCTION'?'PRODUCTION':num(row.price)===0?'EXPLICIT_ZERO':'UNKNOWN',reference:row.note})));styleSheet(ws);return xlsxReply(reply,wb,`item-cost-history-${item.code}.xlsx`)});
}
