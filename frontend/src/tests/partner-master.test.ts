import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { warehouseStockBlockMessage } from '@/lib/partner-api';
import { masterConflictMessage } from '@/lib/master-validation';

/** PHASE 7B — SUPPLIER + WAREHOUSE CONTRACT COMPLETION */

const err = (code: string, message = '', details?: unknown) =>
  Object.assign(new Error(message), { code, details });

describe('PART 15 — ข้อความ error', () => {
  it('1 คลังมีของ → ใช้ยอดจริงที่ backend ส่งมา', () => {
    const msg = warehouseStockBlockMessage(err('WAREHOUSE_HAS_STOCK', '', { onHand: 65.7, reserved: 0, itemCount: 3 }));
    expect(msg).toContain('65.7');
    expect(msg).toContain('3 รายการ');
    expect(msg).toContain('ยังไม่สามารถปิดใช้งานได้');
  });

  it('2 มีของจองด้วย → บอกทั้งสองยอด', () => {
    const msg = warehouseStockBlockMessage(err('WAREHOUSE_HAS_STOCK', '', { onHand: 10, reserved: 4, itemCount: 1 }));
    expect(msg).toContain('คงเหลือ 10');
    expect(msg).toContain('จองแล้ว 4');
  });

  it('3 backend ไม่ส่งตัวเลขมา → ห้ามแต่งเลขเอง', () => {
    const msg = warehouseStockBlockMessage(err('WAREHOUSE_HAS_STOCK'));
    expect(msg).toBe('คลังนี้ยังมีสินค้าอยู่ จึงยังไม่สามารถปิดใช้งานได้');
    expect(msg).not.toMatch(/\d/);
  });

  it('4 error อื่นไม่ถูกจับมาเป็นข้อความคลังมีของ', () => {
    expect(warehouseStockBlockMessage(err('DUPLICATE_WAREHOUSE'))).toBeNull();
    expect(warehouseStockBlockMessage(new Error('เครือข่ายขัดข้อง'))).toBeNull();
    expect(warehouseStockBlockMessage(null)).toBeNull();
  });

  it('5 duplicate ของ supplier/warehouse แปลเป็นภาษาคน', () => {
    expect(masterConflictMessage(err('DUPLICATE_SUPPLIER'), 'supplier', 'SUP-001')).toContain('มีผู้จำหน่าย SUP-001 อยู่ในระบบแล้ว');
    expect(masterConflictMessage(err('DUPLICATE_WAREHOUSE'), 'warehouse', 'WH-01')).toContain('มีคลัง WH-01 อยู่ในระบบแล้ว');
  });

  it('6 NOT_FOUND / FORBIDDEN ไม่ถูกกลบเป็นข้อความซ้ำ', () => {
    expect(masterConflictMessage(err('NOT_FOUND', 'ไม่พบคลังในบริษัทปัจจุบัน'), 'warehouse')).toBe('ไม่พบคลังในบริษัทปัจจุบัน');
    expect(masterConflictMessage(err('FORBIDDEN', ''), 'warehouse')).toBe('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
  });
});

/* ---------- โครงหน้า / contract ---------- */
const FE = path.resolve(__dirname, '..');
const BE = path.resolve(__dirname, '../../../backend/src');
const read = (base: string, p: string) => fs.readFileSync(path.join(base, p), 'utf8');

const api = read(FE, 'lib/partner-api.ts');
const page = read(FE, 'pages/catalog/PartnerMastersPage.tsx');
const ops = read(FE, 'pages/OperationsPages.tsx');
const route = read(BE, 'modules/business/business.route.ts');
const svc = read(BE, 'lib/partner-master.ts');

describe('PART 2–8 — backend contract', () => {
  it('7 มีครบทั้งหกเส้นทาง', () => {
    for (const r of [
      "app.get('/suppliers'", "app.get('/suppliers/:id'", "app.patch('/suppliers/:id'",
      "app.get('/warehouses'", "app.get('/warehouses/:id'", "app.patch('/warehouses/:id'",
    ]) expect(route, r).toContain(r);
  });

  it('8 ทุกเส้นทาง company-scoped', () => {
    const block = route.slice(route.indexOf('PHASE 7B'), route.indexOf('Inline master-data creation'));
    expect(block.match(/companyId/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(block).toContain('deletedAt: null');
  });

  it('9 อ่าน/เขียนใช้สิทธิ์เดิม ไม่เพิ่ม permission ใหม่', () => {
    expect(route).toContain("const PARTNER_READ = requirePermission(");
    expect(route).toContain("const PARTNER_WRITE = requirePermission('RECEIVING_CREATE')");
    expect(route).not.toContain("'SUPPLIER_VIEW'");
    expect(route).not.toContain("'WAREHOUSE_EDIT'");
  });

  it('10 อ่านยอดสต็อกครั้งเดียวแล้วรวมในหน่วยความจำ — ไม่มี N+1', () => {
    expect(route).toContain('const warehouseStockMap = async');
    expect(route).toContain('aggregateStock(balances)');
    // ต้องไม่มีการวน query ต่อคลัง
    expect(route).not.toMatch(/for\s*\(const w of rows\)[\s\S]{0,200}await prisma\./);
  });

  it('11 นับใบรับของด้วย _count ใน query เดียว', () => {
    expect(route).toContain('_count: { select: { goodsReceipts: true } }');
  });

  it('12 PATCH รับเฉพาะ field ของ master — body schema ไม่มีช่องแตะสต็อก', () => {
    // ตรวจที่ zod schema ของ body โดยตรง เพราะนั่นคือสิ่งเดียวที่กำหนดว่าอะไรเข้ามาได้
    const at = route.indexOf("app.patch('/warehouses/:id'");
    const schema = route.slice(route.indexOf('const body = z.object({', at), route.indexOf('}).parse(req.body);', at));
    expect(schema).toContain('name:');
    expect(schema).toContain('code:');
    expect(schema).toContain('isActive:');
    for (const forbidden of ['onHand', 'reserved', 'stockValue', 'itemCount']) {
      expect(schema, forbidden).not.toContain(forbidden);
    }
    const sAt = route.indexOf("app.patch('/suppliers/:id'");
    const sSchema = route.slice(route.indexOf('const body = z.object({', sAt), route.indexOf('}).parse(req.body);', sAt));
    for (const forbidden of ['onHand', 'reserved', 'companyId']) {
      expect(sSchema, forbidden).not.toContain(forbidden);
    }
  });

  it('13 ปิดใช้งานคลังที่มีของ → 409 พร้อมยอดจริงใน details', () => {
    expect(route).toContain('warehouseDeactivateBlock(stock.get(id))');
    expect(route).toContain('{ onHand: block.onHand, reserved: block.reserved, itemCount: block.itemCount }');
  });

  it('14 ไม่ hard delete และไม่ล้างสต็อกอัตโนมัติ', () => {
    const block = route.slice(route.indexOf('PHASE 7B'), route.indexOf('Inline master-data creation'));
    expect(block).not.toContain('.delete(');
    expect(block).not.toContain('deleteMany');
    expect(block).not.toContain('stockBalance.update');
  });

  it('15 บันทึก audit log ทั้งสองชนิด', () => {
    expect(route).toContain("action: 'SUPPLIER_UPDATED'");
    expect(route).toContain("action: 'WAREHOUSE_UPDATED'");
  });

  it('16 duplicate ตรวจทั้งชื่อ (ในบริษัท) และรหัส (ทั้งระบบ ตาม @unique จริง)', () => {
    expect(route).toContain('where: { companyId, deletedAt: null, name, id: { not: id } }');
    expect(route).toContain('where: { code, id: { not: id } }');
  });

  it('17 stockValue ใช้สูตรเดียวกับ /business/inventory', () => {
    expect(svc).toContain('onHand * toNum(r.item?.lastCost)');
  });
});

describe('PART 11–12 — frontend wiring', () => {
  it('18 หน้าเลิกอ่าน operations/lookups แล้ว', () => {
    expect(page).not.toContain('/business/operations/lookups');
    expect(page).toContain('partnerApi.suppliers(');
    expect(page).toContain('partnerApi.warehouses(');
  });

  it('19 ผู้จำหน่ายแสดง field ที่ schema มีจริง', () => {
    expect(page).toContain('r.receivingCount');
    expect(page).toContain('<Contact phone={r.phone} email={r.email} />');
    expect(page).toContain('เลขภาษี');
    // schema ไม่มีคอลัมน์เหล่านี้ จึงต้องไม่อยู่ใน type ที่ประกาศ (คอมเมนต์อธิบายไม่นับ)
    const iface = api.slice(api.indexOf('export interface Supplier {'), api.indexOf('export interface Warehouse {'));
    expect(iface).not.toContain('contactName');
    expect(iface).not.toContain('note');
  });

  it('20 คลังแสดง aggregate ที่มี source จริง', () => {
    expect(page).toContain('r.itemCount');
    expect(page).toContain('money(r.stockValue)');
    const iface = api.slice(api.indexOf('export interface Warehouse {'), api.indexOf('const listQuery'));
    expect(iface).not.toContain('description');
    expect(iface).not.toContain('location');
  });

  it('21 มีปุ่มแก้ไข / เปิดปิดใช้งาน / ดูสต็อกในคลัง', () => {
    expect(page).toContain('aria-label={`แก้ไข ${row.name}`}');
    expect(page).toContain("aria-label={`${row.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${row.name}`}");
    expect(page).toContain('/inventory?warehouse=');
  });

  it('22 route กรองคลังยังทำงาน', () => {
    const inv = read(FE, 'pages/InventoryPages.tsx');
    expect(inv).toContain("new URLSearchParams(locationSearch).get('warehouse')");
  });

  it('23 ใช้ modal/ConfirmDialog ของ Phase 7 ไม่สร้าง pattern ใหม่', () => {
    expect(page).toContain('<MasterModal');
    expect(page).toContain('<ConfirmDialog');
    expect(page.match(/style=\{\{/g)?.length ?? 0).toBe(0);
  });

  it('24 กรองสถานะได้ทั้ง active / inactive / ทุกสถานะ', () => {
    expect(page).toContain('<option value="inactive">ปิดใช้งาน</option>');
    expect(page).toContain('<option value="all">ทุกสถานะ</option>');
  });

  it('25 ไม่มีสิทธิ์ = ไม่แสดงปุ่มแก้ไข', () => {
    expect(page).toContain("if (!canEdit) return <span className=\"md-conv same\">ดูอย่างเดียว</span>;");
    expect(page).toContain("user?.permissions.includes('RECEIVING_CREATE')");
  });
});

describe('PART 13 — quick-create / cache', () => {
  it('26 บันทึกแล้วล้าง cache ทั้ง master list และ lookups', () => {
    expect(page).toContain("qc.invalidateQueries({ queryKey: ['partners'] })");
    expect(page).toContain("qc.invalidateQueries({ queryKey: ['operations-lookups'] })");
    expect(page).toContain("new CustomEvent('s2a:master-updated'");
  });

  it('27 หน้ารับของ/เบิกฟัง event นี้เพื่อโหลด lookups ใหม่', () => {
    expect(ops.match(/useMasterDataRefresh\(load\)/g)?.length).toBe(2);
    const hook = read(FE, 'hooks/useMasterDataRefresh.ts');
    expect(hook).toContain("MASTER_UPDATED_EVENT = 's2a:master-updated'");
  });

  it('28 quick-create เดิมยังโหลด lookups ใหม่และ auto-select', () => {
    expect(ops).toContain('const onCreated = async');
    expect(ops).toContain('await load();');
    expect(ops).toContain("if (kind === 'warehouse') setWarehouseId(created.id)");
  });

  it('29 picker ยังอ่านจาก lookups ซึ่งคืนเฉพาะ active — inactive จึงหายไปเอง', () => {
    expect(route).toContain("prisma.warehouse.findMany({ where: { companyId, isActive: true, deletedAt: null }");
    expect(route).toContain("prisma.supplier.findMany({ where: { companyId, isActive: true, deletedAt: null }");
  });
});

describe('PART 14 — ประวัติต้องไม่หาย', () => {
  it('30 ใบรับของดึง supplier/warehouse โดยไม่กรอง isActive', () => {
    const line = route.split('\n').find((l) => l.includes("app.get('/receiving/:id'") || l.includes('prisma.goodsReceipt.findFirst')) ?? '';
    const detail = route.slice(route.indexOf("app.get('/receiving/:id'"), route.indexOf("app.get('/receiving/:id'") + 700);
    expect(detail).toContain('include: { supplier: true, warehouse: true');
    expect(detail).not.toContain('isActive: true');
    expect(line.length).toBeGreaterThan(0);
  });

  it('31 ใบเบิกดึงคลังด้วย findUnique ตาม id ไม่กรองสถานะ', () => {
    const detail = route.slice(route.indexOf("app.get('/stock-issues/:id'"), route.indexOf("app.get('/stock-issues/:id'") + 900);
    expect(detail).toContain('prisma.warehouse.findUnique({ where: { id: issue.warehouseId }');
    expect(detail).not.toContain('isActive');
  });

  it('32 ปิดใช้งานเป็น soft เท่านั้น — ไม่แตะเอกสารเก่า', () => {
    const patchS = route.slice(route.indexOf("app.patch('/suppliers/:id'"), route.indexOf("app.patch('/suppliers/:id'") + 2600);
    expect(patchS).not.toContain('goodsReceipt.update');
    expect(patchS).not.toContain('goodsReceipt.delete');
  });

  it('33 UI บอกผู้ใช้ว่าเอกสารเดิมยังเห็นชื่อได้', () => {
    expect(page).toContain('แต่เอกสารเดิมทั้งหมดยังแสดงชื่อ');
    expect(page).toContain('ใบรับของเดิมยังแสดงชื่อผู้จำหน่ายได้ตามปกติ');
  });
});
