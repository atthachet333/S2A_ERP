import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNotEditable, orderErrorMessage } from '@/lib/order-api';
import { priceTierLabel } from '@/lib/order-vocab';

/** PHASE 8B — ORDERS + CUSTOMERS CONTRACT COMPLETION */

const err = (code: string, message = '') => Object.assign(new Error(message), { code });

describe('PART 16 — error contract', () => {
  it('1 แปล error code เป็นภาษาไทยตามสเปก', () => {
    expect(orderErrorMessage(err('ORDER_NOT_EDITABLE'))).toBe('ออเดอร์นี้ยืนยันแล้ว จึงแก้ไขไม่ได้');
    expect(orderErrorMessage(err('CUSTOMER_NOT_FOUND'))).toBe('ไม่พบข้อมูลลูกค้า');
    expect(orderErrorMessage(err('INVALID_PRICE_TIER'))).toBe('ระดับราคานี้ไม่ถูกต้อง');
    expect(orderErrorMessage(err('ORDER_NOT_FOUND'))).toBe('ไม่พบออเดอร์นี้ในบริษัทปัจจุบัน');
    expect(orderErrorMessage(err('DUPLICATE_CUSTOMER'))).toBe('มีรหัสลูกค้านี้อยู่แล้วในบริษัท');
    expect(orderErrorMessage(err('FORBIDDEN'))).toBe('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
  });

  it('2 ห้าม error ดิบของ Prisma หลุดถึงผู้ใช้', () => {
    const raw = new Error('Invalid `prisma.salesOrder.update()` invocation: Argument `where` is missing');
    expect(orderErrorMessage(raw)).toBe('ทำรายการไม่สำเร็จ');
    expect(orderErrorMessage(new Error('P2002 unique constraint failed'))).toBe('ทำรายการไม่สำเร็จ');
  });

  it('3 ข้อความปกติจาก backend ยังแสดงตามเดิม', () => {
    expect(orderErrorMessage(new Error('เครือข่ายขัดข้อง'))).toBe('เครือข่ายขัดข้อง');
  });

  it('4 จับกรณีแก้ไม่ได้แยกออกมาได้', () => {
    expect(isNotEditable(err('ORDER_NOT_EDITABLE'))).toBe(true);
    expect(isNotEditable(err('ORDER_NOT_FOUND'))).toBe(false);
    expect(isNotEditable(null)).toBe(false);
  });
});

describe('PART 4 — client API', () => {
  it('4b เปิดครบทั้งสี่เมธอดใหม่ และคงของเดิมไว้', () => {
    for (const m of ['order: (id: string)', 'updateOrder: (id: string', 'customer: (id: string)', 'updateCustomer: (id: string']) {
      expect(api, m).toContain(m);
    }
    // ของเดิมต้องยังอยู่ เพื่อไม่ให้ Dashboard/List พัง
    expect(api).toContain("orders: () => apiClient.get<Order[]>('/business/orders')");
    expect(api).toContain('archiveCustomer:');
  });
});

describe('PART 12 — ระดับราคาที่บันทึก', () => {
  it('5 แปลระดับราคาเป็นภาษาไทย', () => {
    expect(priceTierLabel('RETAIL')).toBe('ราคาปลีก');
    expect(priceTierLabel('WHOLESALE')).toBe('ราคาส่ง');
    expect(priceTierLabel('AGENT')).toBe('ราคาคนรู้จัก');
  });

  it('6 ออเดอร์เก่าที่ไม่มี tier → ไม่เดา', () => {
    expect(priceTierLabel(null)).toBe('—');
    expect(priceTierLabel(undefined)).toBe('—');
  });

  it('7 ค่าที่ไม่รู้จักคืนค่าดิบ', () => {
    expect(priceTierLabel('VIP')).toBe('VIP');
  });
});

/* ---------- contract / โครงหน้า ---------- */
const FE = path.resolve(__dirname, '..');
const BE = path.resolve(__dirname, '../../../backend');
const read = (base: string, p: string) => fs.readFileSync(path.join(base, p), 'utf8');

const api = read(FE, 'lib/order-api.ts');
const detail = read(FE, 'pages/orders/OrderDetailPage.tsx');
const workspace = read(FE, 'pages/orders/OrderWorkspacePage.tsx');
const customers = read(FE, 'pages/orders/CustomersPage.tsx');
const app = read(FE, 'App.tsx');
const route = read(BE, 'src/modules/business/business.route.ts');
const schema = read(BE, 'prisma/schema.prisma');
const svc = read(BE, 'src/lib/order-edit.ts');

describe('PART 1 / 7 / 15 — schema และ migration', () => {
  it('8 SalesOrder มีคอลัมน์ priceTier แบบ nullable', () => {
    const block = schema.slice(schema.indexOf('model SalesOrder {'), schema.indexOf('model SalesOrderItem'));
    expect(block).toMatch(/priceTier\s+String\?/);
  });

  it('9 ไม่สร้าง enum ใหม่ซ้อนกับวิธีเก็บของ SellingPrice', () => {
    expect(schema).not.toContain('enum PriceType');
    expect(schema).not.toContain('enum PriceTier');
    // SellingPrice ยังเก็บเป็น String เหมือนเดิม
    expect(schema).toMatch(/priceType\s+String/);
  });

  it('10 migration เป็น additive อย่างเดียว ไม่ reset ไม่ backfill', () => {
    const dir = path.join(BE, 'prisma/migrations/20260822090000_sales_order_price_tier');
    const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8');
    expect(sql).toContain('ADD COLUMN `priceTier`');
    expect(sql).toContain('NULL');
    for (const bad of ['DROP TABLE', 'DROP COLUMN', 'TRUNCATE', 'UPDATE ', 'DELETE FROM']) {
      expect(sql, bad).not.toContain(bad);
    }
  });
});

describe('PART 2–5 — endpoint ใหม่', () => {
  it('11 มีครบทั้งสี่เส้นทาง', () => {
    for (const r of [
      "app.get('/customers/:id'", "app.patch('/customers/:id'",
      "app.get('/orders/:id'", "app.patch('/orders/:id'",
    ]) expect(route, r).toContain(r);
  });

  it('12 ทุกเส้นทาง company-scoped และมี permission', () => {
    const block = route.slice(route.indexOf('PHASE 8B'), route.indexOf("app.post('/orders/:id/transition'"));
    expect(block.match(/companyId/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(block).toContain("requirePermission('CUSTOMER_VIEW')");
    expect(block).toContain("requirePermission('CUSTOMER_EDIT')");
    expect(block).toContain("requirePermission('ORDER_VIEW')");
    expect(block).toContain("requirePermission('ORDER_CREATE', 'ORDER_EDIT')");
  });

  it('13 ไม่สร้าง permission ใหม่', () => {
    const block = route.slice(route.indexOf('PHASE 8B'), route.indexOf("app.post('/orders/:id/transition'"));
    for (const bad of ['CUSTOMER_DETAIL', 'ORDER_UPDATE', 'ORDER_PATCH', 'PRICE_TIER']) {
      expect(block, bad).not.toContain(`'${bad}'`);
    }
  });

  it('14 customer detail ไม่ดึงออเดอร์ทั้งบริษัท', () => {
    const block = route.slice(route.indexOf("app.get('/customers/:id'"), route.indexOf("app.patch('/customers/:id'"));
    expect(block).toContain('take: 10');
    expect(block).toContain('prisma.salesOrder.count');
    expect(block).toContain('prisma.salesOrder.aggregate');
    // ต้องไม่ findMany ออเดอร์ทั้งบริษัทแล้วมากรอง
    expect(block).not.toContain('prisma.salesOrder.findMany');
  });

  it('15 order detail คืน items + customer ในคำขอเดียว', () => {
    const block = route.slice(route.indexOf("app.get('/orders/:id'"), route.indexOf("app.patch('/orders/:id'"));
    expect(block).toContain('include: { customer: true, items: true');
    expect(block).toContain('ORDER_NOT_FOUND');
  });
});

describe('PART 5–6 — แก้ร่างอย่างปลอดภัย', () => {
  const patchBlock = route.slice(route.indexOf("app.patch('/orders/:id'"), route.indexOf("app.patch('/orders/:id'") + 4200);

  it('16 สถานะที่ไม่ใช่ร่าง → 409 ORDER_NOT_EDITABLE', () => {
    expect(patchBlock).toContain("current.status !== 'DRAFT'");
    expect(patchBlock).toContain('ORDER_NOT_EDITABLE');
    expect(patchBlock).toContain('status(409)');
  });

  it('17 ใช้ใบเดิม ไม่ออกเลขใหม่ ไม่สร้างใบใหม่', () => {
    // อัปเดตในทรานแซกชัน จึงเป็น tx.salesOrder.update
    expect(patchBlock).toContain('tx.salesOrder.update');
    expect(patchBlock).not.toContain('salesOrder.create');
    // ไม่มีการแตะเลขที่เอกสารหรือวันที่สร้างเลย
    expect(patchBlock).not.toContain('orderNo:');
    expect(patchBlock).not.toContain('createdAt:');
    expect(patchBlock).not.toContain('createdByUserId:');
  });

  it('18 ยอดคำนวณฝั่ง server ไม่เชื่อ lineTotal จาก client', () => {
    expect(patchBlock).toContain('new Prisma.Decimal(item.quantity).mul(item.unitPrice)');
    expect(patchBlock).toContain('Prisma.Decimal.max(0, subtotal.minus(discount).plus(tax))');
    // schema ของ body ไม่รับ lineTotal เลย
    const orderSchemaBlock = route.slice(route.indexOf('const orderSchema'), route.indexOf('const transitions'));
    expect(orderSchemaBlock).not.toContain('lineTotal');
  });

  it('19 แทนที่รายการทั้งชุดภายใน transaction เดียว ไม่บันทึกครึ่ง ๆ', () => {
    expect(patchBlock).toContain('prisma.$transaction');
    expect(patchBlock).toContain('tx.salesOrderItem.deleteMany');
    expect(patchBlock).toContain('tx.salesOrderItem.createMany');
  });

  it('20 เขียน snapshot ใหม่ครบทุก field ตอนแทนที่รายการ', () => {
    for (const f of ['menuNameSnapshot', 'unitPrice', 'lineTotal', 'unit:']) {
      expect(patchBlock, f).toContain(f);
    }
  });

  it('21 helper ฝั่ง server มีกติกาเดียวกับที่ route ใช้', () => {
    expect(svc).toContain("EDITABLE_STATUSES = ['DRAFT']");
    expect(svc).toContain('ORDER_NOT_EDITABLE');
    expect(svc).toContain('Math.max(0, subtotal - d + t)');
  });
});

describe('PART 7–8 — priceTier และความปลอดภัยของราคาเก่า', () => {
  it('22 บันทึก priceTier ทั้งตอนสร้างและตอนแก้ร่าง', () => {
    expect(route).toContain('priceTier: body.priceTier ?? null');
    expect(route).toContain("...(body.priceTier !== undefined ? { priceTier: body.priceTier } : {})");
  });

  it('23 ยอมรับเฉพาะระดับที่ SellingPrice ใช้จริง', () => {
    expect(route).toContain("const PRICE_TIER = z.enum(['RETAIL', 'WHOLESALE', 'AGENT', 'SPECIAL'])");
  });

  it('24 ไม่มีการคำนวณราคาย้อนหลังจากตารางราคาปัจจุบัน', () => {
    const block = route.slice(route.indexOf('PHASE 8B'), route.indexOf("app.post('/orders/:id/transition'"));
    expect(block).not.toContain('sellingPrice');
    expect(block).not.toContain('SellingPrice');
  });

  it('25 หน้ารายละเอียดแสดง tier ที่บันทึกไว้ และไม่เดาเมื่อเป็น null', () => {
    expect(detail).toContain('order.priceTier ? priceTierLabel(order.priceTier)');
    expect(detail).toContain('ไม่ได้ระบุระดับราคา');
  });

  it('26 หน้ารายละเอียดยังอ่านราคาจาก snapshot เท่านั้น', () => {
    expect(detail).toContain('{l.menuNameSnapshot}');
    expect(detail).toContain('money(l.unitPrice)');
    expect(detail).toContain('money(l.lineTotal)');
    expect(detail).not.toContain('catalogApi');
    expect(detail).not.toContain('sellingPrices');
  });

  it('27 โหมดแก้ไขโหลดราคาที่ใช้จริงของใบนั้น ไม่ใช่ราคาปัจจุบัน', () => {
    expect(workspace).toContain('unitPrice: Number(l.unitPrice) || 0');
    // ห้ามให้ effect ของ tier เขียนทับราคาที่เพิ่ง preload
    expect(workspace).toContain('if (isEdit && !preloaded) return;');
  });
});

describe('PART 4 / 13 — ประสิทธิภาพ', () => {
  it('28 order detail ใช้ endpoint ใบเดียว ไม่โหลดทั้งชุด', () => {
    expect(detail).toContain('orderApi.order(id as string)');
    expect(detail).toContain("queryKey: ['order', id]");
    expect(detail).not.toContain('orderApi.orders()');
  });

  it('29 customer profile ใช้ endpoint ใบเดียว', () => {
    expect(customers).toContain('orderApi.customer(id as string)');
    expect(customers).toContain("queryKey: ['customer', id]");
    expect(customers).not.toContain('ordersOfCustomer');
  });

  it('30 ตัวเลขสรุปของโปรไฟล์มาจาก backend ไม่ใช่นับจาก 10 ใบที่แสดง', () => {
    expect(customers).toContain('customer.orderCount ?? myOrders.length');
    expect(customers).toContain('Number(customer.deliveredSales ?? 0)');
  });
});

describe('PART 10–11 — แก้ไขร่างฝั่งหน้าจอ', () => {
  it('31 มี route แก้ไข', () => {
    expect(app).toContain('<Route path="/orders/:id/edit" element={<OrderWorkspacePage />} />');
  });

  it('32 ใช้หน้าเดียวกับตอนสร้าง ไม่ทำ UI ใหม่', () => {
    expect(workspace).toContain('const isEdit = Boolean(editId)');
    expect(workspace).toContain('orderApi.updateOrder(editId as string, payload)');
    expect(workspace).toContain('orderApi.createOrder({ ...payload, idempotencyKey');
  });

  it('33 หัวหน้าแสดงเลขออเดอร์เดิมตอนแก้ไข', () => {
    expect(workspace).toContain('`แก้ไขออเดอร์ ${existing.data?.orderNo ?? \'\'}`');
    expect(workspace).toContain('เลขที่ออเดอร์และวันที่สร้างยังเป็นใบเดิม');
  });

  it('34 preload ครบทั้งลูกค้า รายการ ระดับราคา ส่วนลด หมายเหตุ', () => {
    for (const f of ['setCustomerId(doc.customerId)', 'setDeliveryDate(', 'setDiscount(', 'setNote(', 'setTier(', 'setLines(']) {
      expect(workspace, f).toContain(f);
    }
  });

  it('35 ออเดอร์ที่ไม่ใช่ร่าง → หน้าอ่านอย่างเดียว ไม่ขึ้นฟอร์มหลอกให้กรอก', () => {
    expect(workspace).toContain("existing.data.status !== 'DRAFT'");
    expect(workspace).toContain('ออเดอร์นี้ยืนยันแล้ว จึงไม่สามารถแก้ไขรายการได้');
  });

  it('36 ปุ่มแก้ไขในหน้ารายละเอียดโผล่เฉพาะร่างและเฉพาะผู้มีสิทธิ์', () => {
    expect(detail).toContain("{order.status === 'DRAFT' && canEdit && (");
    expect(detail).toContain("['ORDER_CREATE', 'ORDER_EDIT'].some((p) => user?.permissions.includes(p))");
  });
});

describe('PART 9 / 14 — ลูกค้าและ cache', () => {
  it('37 โปรไฟล์มีปุ่มแก้ไขเฉพาะผู้มีสิทธิ์ และใช้ MasterModal เดิม', () => {
    expect(customers).toContain('<MasterModal');
    expect(customers).toContain('{canEdit && <button type="button" className="btn" onClick={openEdit}>');
    expect(customers).toContain("user?.permissions.includes('CUSTOMER_EDIT')");
  });

  it('38 บันทึกแล้วล้าง cache ทุกที่ที่ชื่อลูกค้าปรากฏ', () => {
    for (const k of ["['customer', id]", "['customers']", "['order-customers']", "['orders']"]) {
      expect(customers, k).toContain(`queryKey: ${k}`);
    }
  });

  it('39 แก้ไขลูกค้าไม่แตะออเดอร์เดิม', () => {
    const block = route.slice(route.indexOf("app.patch('/customers/:id'"), route.indexOf("app.get('/orders/:id'"));
    expect(block).not.toContain('salesOrder.update');
    expect(block).not.toContain('salesOrderItem');
  });

  it('40 GET /orders เดิมยังทำงานเหมือนเดิม (Dashboard/List ไม่พัง)', () => {
    const line = route.split('\n').find((l) => l.includes("app.get('/orders'")) ?? '';
    expect(line).toContain('include: { customer: true, items: true }');
    expect(line).toContain("requirePermission('ORDER_VIEW')");
  });
});
