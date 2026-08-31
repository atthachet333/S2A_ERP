import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { num } from '../../lib/http.js';

export const purchaseOrderInclude = {
  supplier: true,
  warehouse: true,
  purchasePlan: { select: { id: true, planNo: true, status: true } },
  items: {
    include: {
      item: { include: { baseUnit: true, purchaseUnit: true } },
      purchasePlanRequirement: { select: { id: true, shortageQty: true, purchaseQty: true, purchaseUnitCode: true } },
      goodsReceiptItems: {
        where: { goodsReceipt: { status: 'CONFIRMED' } },
        include: { goodsReceipt: { select: { id: true, receiptNo: true, receiptDate: true, status: true } } },
      },
    },
  },
  goodsReceipts: {
    where: { status: { in: ['CONFIRMED', 'REVERSED'] } },
    select: { id: true, receiptNo: true, receiptDate: true, status: true, confirmedAt: true, reversedAt: true },
    orderBy: { receiptDate: 'asc' },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderWithRelations = Prisma.PurchaseOrderGetPayload<{ include: typeof purchaseOrderInclude }>;

export function serializePurchaseOrder(order: PurchaseOrderWithRelations) {
  const items = order.items.map((line) => {
    const confirmed = line.goodsReceiptItems.filter((entry) => entry.goodsReceipt.status === 'CONFIRMED');
    const receivedQty = confirmed.reduce((sum, entry) => sum + num(entry.quantity), 0);
    const orderedQty = num(line.orderedQty);
    const latest = confirmed.slice().sort((a, b) => b.goodsReceipt.receiptDate.getTime() - a.goodsReceipt.receiptDate.getTime())[0];
    const latestPrice = latest ? num(latest.unitPrice) : null;
    const poPrice = num(line.unitPrice);
    const priceVariance = latestPrice == null ? null : latestPrice - poPrice;
    return {
      ...line,
      receivedQty,
      remainingQty: Math.max(orderedQty - receivedQty, 0),
      quantityVariance: receivedQty - orderedQty,
      latestReceivedPrice: latestPrice,
      priceVariance,
      priceVariancePercent: latestPrice == null || poPrice === 0 ? null : (priceVariance! / poPrice) * 100,
    };
  });
  return {
    ...order,
    items,
    summary: {
      itemCount: items.length,
      subtotal: num(order.subtotal),
      discount: num(order.discount),
      tax: num(order.tax),
      grandTotal: num(order.grandTotal),
      receivedLines: items.filter((line) => line.receivedQty > 0).length,
      completedLines: items.filter((line) => line.receivedQty >= num(line.orderedQty)).length,
    },
  };
}

export async function lockPurchaseOrder(tx: Prisma.TransactionClient, purchaseOrderId: string) {
  await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${purchaseOrderId} FOR UPDATE`;
}

export async function recomputePurchaseOrderStatus(tx: Prisma.TransactionClient, purchaseOrderId: string) {
  await lockPurchaseOrder(tx, purchaseOrderId);
  const order = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { items: { include: { goodsReceiptItems: { where: { goodsReceipt: { status: 'CONFIRMED' } } } } } },
  });
  if (!order || order.status === PurchaseOrderStatus.CANCELLED || order.status === PurchaseOrderStatus.DRAFT) return order?.status ?? null;
  const received = order.items.map((line) => ({ ordered: num(line.orderedQty), received: line.goodsReceiptItems.reduce((sum, entry) => sum + num(entry.quantity), 0) }));
  const next = received.every((line) => line.received >= line.ordered)
    ? PurchaseOrderStatus.RECEIVED
    : received.some((line) => line.received > 0)
      ? PurchaseOrderStatus.PARTIALLY_RECEIVED
      : PurchaseOrderStatus.CONFIRMED;
  if (next !== order.status) await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: next, version: { increment: 1 } } });
  return next;
}

export async function validateReceiptOverage(tx: Prisma.TransactionClient, receiptId: string, acknowledged: boolean) {
  const receipt = await tx.goodsReceipt.findUnique({ where: { id: receiptId }, include: { items: true } });
  if (!receipt?.purchaseOrderId) return [];
  await lockPurchaseOrder(tx, receipt.purchaseOrderId);
  const order = await tx.purchaseOrder.findUnique({ where: { id: receipt.purchaseOrderId }, include: { items: true } });
  if (!order || (order.status !== PurchaseOrderStatus.CONFIRMED && order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED)) throw new Error('PURCHASE_ORDER_NOT_RECEIVABLE');
  const previous = await tx.goodsReceiptItem.groupBy({
    by: ['purchaseOrderItemId'],
    where: { purchaseOrderItemId: { in: order.items.map((line) => line.id) }, goodsReceipt: { status: 'CONFIRMED', id: { not: receipt.id } } },
    _sum: { quantity: true },
  });
  const previousOf = new Map(previous.map((row) => [row.purchaseOrderItemId, num(row._sum.quantity)]));
  const currentOf = new Map<string, number>();
  for (const line of receipt.items) if (line.purchaseOrderItemId) currentOf.set(line.purchaseOrderItemId, (currentOf.get(line.purchaseOrderItemId) ?? 0) + num(line.quantity));
  const overages = order.items.flatMap((line) => {
    const total = (previousOf.get(line.id) ?? 0) + (currentOf.get(line.id) ?? 0);
    const over = total - num(line.orderedQty);
    return over > 0 ? [{ purchaseOrderItemId: line.id, itemName: line.itemName, overQty: over, unit: line.purchaseUnitCode }] : [];
  });
  if (overages.length && !acknowledged) throw new Error(`OVER_RECEIVE_ACK_REQUIRED:${JSON.stringify(overages)}`);
  return overages;
}
