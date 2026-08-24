import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { checkStandardFactor } from '../src/lib/item-conversion.js';

/**
 * PHASE 21 §3 — แก้การตั้งค่าปัจจุบันของ CD-095 น้ำปลา
 *
 *   จาก : หน่วยซื้อ KG · หน่วยฐาน BAG · อัตรา 1 · lastCost 42.66/BAG
 *   เป็น : หน่วยซื้อ KG · หน่วยฐาน KG  · อัตรา 1 · lastCost 42.66/KG
 *
 * ทำไมปลอดภัย: อัตราเป็น 1 อยู่แล้ว KG กับ BAG จึงแทนกันได้สนิท
 * ต้นทุนในสูตรก่อนและหลังแก้เท่ากันเป๊ะ (0.3 × 42.66 = 12.798) แค่ป้ายหน่วยตรงความจริงขึ้น
 *
 * แก้เฉพาะ "การตั้งค่าปัจจุบัน" ของ Item เท่านั้น
 * ไม่แตะ StockLedger · ใบรับของ · snapshot ของ RecipeVersion · snapshot ของออเดอร์
 * (รายการนี้ไม่มียอดคงเหลือ ไม่เคยรับของ และไม่มี ledger จึงไม่มีประวัติให้กระทบอยู่แล้ว)
 *
 * วิธีใช้:
 *   npm run repair:cd095 -- --dry-run
 *   npm run repair:cd095
 */

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const EXPECTED_DATABASE = 's2a_erp';
const ITEM_CODE = 'CD-095';
const TARGET_BASE_UNIT_CODE = 'KG';

const dryRun = process.argv.includes('--dry-run');
const num = (v: unknown) => Number(v ?? 0);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('ไม่พบ DATABASE_URL');
  const configured = new URL(url).pathname.replace(/^\//, '');
  console.log(`เป้าหมาย: ${configured}`);
  if (configured !== EXPECTED_DATABASE) throw new Error(`สคริปต์นี้ทำงานกับฐาน ${EXPECTED_DATABASE} เท่านั้น พบ: ${configured}`);

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const rows = await db.$queryRawUnsafe<{ db: string | null }[]>('SELECT DATABASE() AS db');
    console.log(`เซิร์ฟเวอร์รายงานว่าเชื่อมต่ออยู่กับ: ${rows?.[0]?.db ?? null}`);
    if (rows?.[0]?.db !== EXPECTED_DATABASE) throw new Error('เซิร์ฟเวอร์ไม่ได้อยู่ที่ฐานผลิต');

    const item = await db.item.findFirst({
      where: { code: ITEM_CODE, deletedAt: null },
      include: { baseUnit: true, purchaseUnit: true },
    });
    if (!item) throw new Error(`ไม่พบวัตถุดิบรหัส ${ITEM_CODE}`);

    // ---- ด่านความปลอดภัย: ต้องไม่มีประวัติที่จะได้รับผลกระทบเลย ----
    const [balances, receiptLines, ledgerRows, issueLines] = await Promise.all([
      db.stockBalance.count({ where: { itemId: item.id } }),
      db.goodsReceiptItem.count({ where: { itemId: item.id } }),
      db.stockLedger.count({ where: { itemId: item.id } }),
      db.stockIssueItem.count({ where: { itemId: item.id } }),
    ]);
    console.log(`ยอดคงเหลือ ${balances} · บรรทัดรับของ ${receiptLines} · แถว ledger ${ledgerRows} · บรรทัดใบเบิก ${issueLines}`);
    if (balances > 0 || receiptLines > 0 || ledgerRows > 0 || issueLines > 0) {
      throw new Error('รายการนี้มีประวัติการเคลื่อนไหวแล้ว — ต้องทบทวนด้วยคนก่อน ไม่แก้อัตโนมัติ');
    }

    const targetUnit = await db.unit.findFirst({ where: { code: TARGET_BASE_UNIT_CODE, deletedAt: null } });
    if (!targetUnit) throw new Error(`ไม่พบหน่วย ${TARGET_BASE_UNIT_CODE}`);

    if (item.baseUnitId === targetUnit.id) {
      console.log('หน่วยฐานถูกต้องอยู่แล้ว ไม่ต้องแก้อะไร');
      return;
    }

    // ---- ตรวจอัตราแปลงด้วยด่านกลางเดียวกับ API ----
    const conflict = await checkStandardFactor(
      targetUnit.id, item.purchaseUnitId, num(item.purchaseToBaseFactor),
      async () => (await db.unitConversion.findMany({ select: { fromUnitId: true, toUnitId: true, factor: true } }))
        .map((e) => ({ fromUnitId: e.fromUnitId, toUnitId: e.toUnitId, factor: num(e.factor) })),
    );
    if (conflict) throw new Error(`อัตราแปลงจะขัดกับมาตรฐานหลังแก้ (ต้องเป็น ${conflict.expected} แต่เป็น ${conflict.received})`);

    // ---- ยืนยันว่าต้นทุนในสูตรที่ใช้งานอยู่ไม่เปลี่ยน ----
    const lines = await db.recipeIngredient.findMany({
      where: { itemId: item.id, recipeVersion: { isActive: true } },
      include: { unit: true, recipeVersion: { include: { recipe: { include: { product: { select: { name: true } } } } } } },
    });
    const factor = num(item.purchaseToBaseFactor) > 0 ? num(item.purchaseToBaseFactor) : 1;
    console.log('\nผลต่อสูตรที่ใช้งานอยู่:');
    for (const line of lines) {
      const qty = num(line.quantity);
      const beforeBase = line.unitId === item.baseUnitId ? qty : line.unitId === item.purchaseUnitId ? qty * factor : null;
      const afterBase = line.unitId === targetUnit.id ? qty : line.unitId === item.purchaseUnitId ? qty * factor : null;
      const before = beforeBase == null ? null : beforeBase * num(item.lastCost);
      const after = afterBase == null ? null : afterBase * num(item.lastCost);
      console.log(`  ${line.recipeVersion?.recipe?.product?.name ?? '—'}: ${qty} ${line.unit?.code ?? '?'}` +
        ` · ก่อน ${before?.toFixed(4) ?? '—'} → หลัง ${after?.toFixed(4) ?? '—'}`);
      if (before == null || after == null || Math.abs(before - after) > 1e-9) {
        throw new Error('ต้นทุนในสูตรจะเปลี่ยนหลังแก้ — หยุดไว้ก่อน ต้องให้คนตัดสินใจ');
      }
    }
    console.log('  → ต้นทุนไม่เปลี่ยนทุกสูตร');

    if (dryRun) {
      console.log('\n[ดูอย่างเดียว] ยังไม่ได้เขียนอะไร');
      console.log(`จะเปลี่ยนหน่วยฐาน: ${item.baseUnit?.code} → ${TARGET_BASE_UNIT_CODE} (อัตราคงเดิม ${factor} · lastCost คงเดิม ${num(item.lastCost)})`);
      return;
    }

    await db.$transaction(async (tx) => {
      await tx.item.update({ where: { id: item.id }, data: { baseUnitId: targetUnit.id } });
      // บันทึกประวัติแบบเดียวกับที่เส้นทางแก้ไขสินค้าปกติทำ
      await tx.auditLog.create({
        data: {
          companyId: item.companyId,
          action: 'UPDATE', entity: 'Item', entityId: item.id,
          before: { code: item.code, baseUnit: item.baseUnit?.code ?? null, purchaseToBaseFactor: factor, lastCost: num(item.lastCost) },
          after: { code: item.code, baseUnit: TARGET_BASE_UNIT_CODE, purchaseToBaseFactor: factor, lastCost: num(item.lastCost), reason: 'PHASE 21 — แก้หน่วยฐานให้ตรงกับหน่วยที่ซื้อและที่สูตรใช้จริง' },
        },
      });
    });

    const after = await db.item.findFirstOrThrow({ where: { id: item.id }, include: { baseUnit: true, purchaseUnit: true } });
    console.log(`\nแก้เรียบร้อย: ซื้อ ${after.purchaseUnit?.code} · ฐาน ${after.baseUnit?.code} · อัตรา ${num(after.purchaseToBaseFactor)} · lastCost ${num(after.lastCost)}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`ล้มเหลว: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
