import { Prisma } from '@prisma/client';
import type { Tx } from './inventory-ledger.js';

export const EXPIRY_SOON_DAYS = 7;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const EPSILON = 1e-9;

export type ExpiryStatus = 'GOOD' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY';
export interface LotAllocationInput { lotId: string; quantity: number }

export const businessDateKey = (value = new Date()) => new Date(value.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
const dateKey = (value: Date | null | undefined) => value ? value.toISOString().slice(0, 10) : null;

export function expiryStatus(expiryDate: Date | null, now = new Date(), thresholdDays = EXPIRY_SOON_DAYS): ExpiryStatus {
  if (!expiryDate) return 'NO_EXPIRY';
  const today = businessDateKey(now);
  const expiry = dateKey(expiryDate)!;
  if (expiry < today) return 'EXPIRED';
  const limit = new Date(`${today}T00:00:00.000Z`);
  limit.setUTCDate(limit.getUTCDate() + thresholdDays);
  return expiry <= limit.toISOString().slice(0, 10) ? 'EXPIRING_SOON' : 'GOOD';
}

export class LotPolicyError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) { super(message); this.name = 'LotPolicyError'; }
}

export function assertLotPolicy(item: { isLotTracked: boolean; isExpiryTracked: boolean }, lotNo?: string | null, manufactureDate?: Date | null, expiryDate?: Date | null) {
  const normalizedLot = lotNo?.trim() ?? '';
  if (item.isLotTracked && !normalizedLot) throw new LotPolicyError('LOT_REQUIRED', 'สินค้านี้ต้องระบุเลข Lot');
  if (item.isExpiryTracked && !expiryDate) throw new LotPolicyError('EXPIRY_REQUIRED', 'สินค้านี้ต้องระบุวันหมดอายุ');
  if (expiryDate && manufactureDate && dateKey(expiryDate)! < dateKey(manufactureDate)!) throw new LotPolicyError('INVALID_EXPIRY_DATE', 'วันหมดอายุต้องไม่ก่อนวันผลิต');
  return normalizedLot || null;
}

export async function ensureInventoryLot(tx: Tx, input: {
  companyId: string; itemId: string; warehouseId?: string | null; lotNo: string;
  manufactureDate?: Date | null; expiryDate?: Date | null; receivedDate?: Date;
  sourceType: 'GOODS_RECEIPT' | 'PRODUCTION' | 'ADJUSTMENT'; sourceReceiptId?: string | null;
  sourceProductionId?: string | null; createdById?: string | null;
}) {
  const lotNo = input.lotNo.trim();
  const existing = await tx.inventoryLot.findUnique({ where: { companyId_itemId_lotNo: { companyId: input.companyId, itemId: input.itemId, lotNo } } });
  if (existing) {
    const compatible = dateKey(existing.manufactureDate) === dateKey(input.manufactureDate)
      && dateKey(existing.expiryDate) === dateKey(input.expiryDate);
    if (!compatible) throw new LotPolicyError('LOT_METADATA_CONFLICT', 'เลข Lot นี้มีวันผลิตหรือวันหมดอายุไม่ตรงกับข้อมูลเดิม', { lotId: existing.id, lotNo });
    return existing;
  }
  return tx.inventoryLot.create({ data: {
    companyId: input.companyId, itemId: input.itemId, warehouseId: input.warehouseId ?? null, lotNo,
    manufactureDate: input.manufactureDate ?? null, expiryDate: input.expiryDate ?? null,
    receivedDate: input.receivedDate ?? new Date(), sourceType: input.sourceType,
    sourceReceiptId: input.sourceReceiptId ?? null, sourceProductionId: input.sourceProductionId ?? null,
    createdById: input.createdById ?? null,
  } });
}

export async function availableLots(tx: Tx, companyId: string, warehouseId: string, itemId: string, includeExpired = true) {
  const rows = await tx.stockBalance.findMany({
    where: { warehouseId, itemId, lotId: { not: null }, item: { companyId }, lot: { companyId } },
    include: { lot: true },
  });
  return rows.map((row) => {
    const onHand = Number(row.onHand); const reserved = Number(row.reserved); const available = onHand - reserved;
    const status = expiryStatus(row.lot!.expiryDate);
    return { balanceId: row.id, lotId: row.lotId!, lotNo: row.lot!.lotNo, manufactureDate: row.lot!.manufactureDate, receivedDate: row.lot!.receivedDate, expiryDate: row.lot!.expiryDate, onHand, reserved, available, status };
  }).filter((row) => row.available > EPSILON && (includeExpired || row.status !== 'EXPIRED')).sort((a, b) => {
    const aExpiry = a.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bExpiry = b.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aExpiry - bExpiry || a.receivedDate.getTime() - b.receivedDate.getTime() || a.lotId.localeCompare(b.lotId);
  });
}

export async function suggestFefo(tx: Tx, companyId: string, warehouseId: string, itemId: string, requestedQty: number) {
  let remaining = requestedQty;
  const allocations: LotAllocationInput[] = [];
  for (const lot of await availableLots(tx, companyId, warehouseId, itemId, false)) {
    if (remaining <= EPSILON) break;
    const quantity = Math.min(lot.available, remaining);
    allocations.push({ lotId: lot.lotId, quantity });
    remaining -= quantity;
  }
  return { allocations, requestedQty, allocatedQty: requestedQty - Math.max(0, remaining), shortageQty: Math.max(0, remaining) };
}

export async function validateLotAllocations(tx: Tx, input: { companyId: string; warehouseId: string; itemId: string; requiredQty: number; allocations: LotAllocationInput[]; allowExpired?: boolean }) {
  const merged = new Map<string, number>();
  for (const allocation of input.allocations) {
    if (!(allocation.quantity > 0)) throw new LotPolicyError('INVALID_LOT_ALLOCATION', 'จำนวนจัดสรร Lot ต้องมากกว่า 0');
    merged.set(allocation.lotId, (merged.get(allocation.lotId) ?? 0) + allocation.quantity);
  }
  const normalized = [...merged].map(([lotId, quantity]) => ({ lotId, quantity }));
  const total = normalized.reduce((sum, row) => sum + row.quantity, 0);
  if (Math.abs(total - input.requiredQty) > 0.00005) throw new LotPolicyError('LOT_ALLOCATION_MISMATCH', 'ผลรวมการจัดสรร Lot ต้องเท่ากับจำนวนหน่วยฐาน', { requiredQty: input.requiredQty, allocatedQty: total });
  const available = new Map((await availableLots(tx, input.companyId, input.warehouseId, input.itemId, true)).map((row) => [row.lotId, row]));
  for (const allocation of normalized) {
    const lot = available.get(allocation.lotId);
    if (!lot) throw new LotPolicyError('LOT_NOT_AVAILABLE', 'Lot ไม่อยู่ในคลัง บริษัท หรือสินค้าที่เลือก');
    if (lot.status === 'EXPIRED' && !input.allowExpired) throw new LotPolicyError('EXPIRED_LOT_FORBIDDEN', 'ไม่สามารถใช้ Lot ที่หมดอายุโดยไม่ระบุการอนุมัติพิเศษ');
    if (lot.available + EPSILON < allocation.quantity) throw new LotPolicyError('INSUFFICIENT_LOT_STOCK', 'สต็อกใน Lot ไม่เพียงพอ', { lotId: lot.lotId, available: lot.available, requested: allocation.quantity });
  }
  return normalized;
}

export const decimal = (value: number) => new Prisma.Decimal(value);
