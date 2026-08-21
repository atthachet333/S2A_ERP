import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ORDER_FLOW, ORDER_TRANSITIONS, PRICE_TIERS, PRICE_TIER_LABEL, belowCost, canTransition,
  lineTotal, nextStatus, orderStatusLabel, orderTotals, priceTierLabel,
} from '@/lib/order-vocab';
import { ordersOfCustomer, searchCustomers, type Order, type OrderCustomer } from '@/lib/order-api';

/** PHASE 8 — ORDERS + CUSTOMERS */

describe('PART 2 — คำศัพท์ออเดอร์', () => {
  it('1 แปลครบทุกค่าใน enum SalesOrderStatus จริง', () => {
    for (const s of ['DRAFT', 'CONFIRMED', 'SENT_TO_PREP', 'PICKING', 'ISSUED', 'READY', 'DELIVERED', 'CANCELLED']) {
      const label = orderStatusLabel(s);
      expect(label, s).not.toBe(s);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('2 สถานะที่ไม่รู้จักคืนค่าดิบ ไม่เดา', () => {
    expect(orderStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(orderStatusLabel(null)).toBe('—');
  });

  it('3 ตาราง transition ตรงกับ backend', () => {
    expect(ORDER_TRANSITIONS.DRAFT).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(ORDER_TRANSITIONS.CONFIRMED).toEqual(['SENT_TO_PREP', 'CANCELLED']);
    expect(ORDER_TRANSITIONS.ISSUED).toEqual(['READY']);
    expect(ORDER_TRANSITIONS.DELIVERED).toEqual([]);
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('4 ขั้นถัดไปตามสายงานหลัก ไม่ใช่การยกเลิก', () => {
    expect(nextStatus('DRAFT')).toBe('CONFIRMED');
    expect(nextStatus('PICKING')).toBe('ISSUED');
    expect(nextStatus('READY')).toBe('DELIVERED');
    expect(nextStatus('DELIVERED')).toBeNull();
    expect(nextStatus('CANCELLED')).toBeNull();
  });

  it('5 ไม่อนุญาตการข้ามขั้น', () => {
    expect(canTransition('DRAFT', 'DELIVERED')).toBe(false);
    expect(canTransition('DRAFT', 'CONFIRMED')).toBe(true);
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
  });

  it('6 ลำดับ flow ไม่รวม CANCELLED เพราะเป็นทางแยก', () => {
    expect(ORDER_FLOW).not.toContain('CANCELLED');
    expect(ORDER_FLOW[0]).toBe('DRAFT');
    expect(ORDER_FLOW[ORDER_FLOW.length - 1]).toBe('DELIVERED');
  });
});

describe('PART 13–16 — ยอดเงิน', () => {
  it('7 ยอดบรรทัด = จำนวน × ราคา', () => {
    expect(lineTotal(5, 28)).toBe(140);
    expect(lineTotal('5', '28')).toBe(140);
  });

  it('8 สูตรรวมตรงกับ backend: max(0, subtotal − discount + tax)', () => {
    const t = orderTotals([{ quantity: 5, unitPrice: 28 }, { quantity: 2, unitPrice: 50 }], 40, 0);
    expect(t.subtotal).toBe(240);
    expect(t.discount).toBe(40);
    expect(t.total).toBe(200);
    expect(t.lineCount).toBe(2);
    expect(t.totalQuantity).toBe(7);
  });

  it('9 ส่วนลดมากกว่ายอดรวม → ไม่ติดลบ (เหมือน Decimal.max(0, …))', () => {
    expect(orderTotals([{ quantity: 1, unitPrice: 100 }], 500).total).toBe(0);
  });

  it('10 ภาษีบวกเข้าไปหลังหักส่วนลด', () => {
    expect(orderTotals([{ quantity: 1, unitPrice: 100 }], 10, 7).total).toBe(97);
  });

  it('11 ไม่มีรายการ → ทุกยอดเป็นศูนย์ ไม่ NaN', () => {
    const t = orderTotals([], '', '');
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
    expect(Number.isFinite(t.total)).toBe(true);
  });

  it('12 ค่าที่ไม่ใช่ตัวเลขไม่ทำให้พัง', () => {
    expect(orderTotals([{ quantity: 'x', unitPrice: 'y' }]).subtotal).toBe(0);
  });
});

describe('PART 14–15 — ระดับราคาและการแก้ราคา', () => {
  it('13 ใช้ระดับราคาตาม priceType จริงของ schema เท่านั้น', () => {
    expect([...PRICE_TIERS]).toEqual(['RETAIL', 'WHOLESALE', 'AGENT']);
    expect(PRICE_TIER_LABEL.RETAIL).toBe('ราคาปลีก');
    expect(PRICE_TIER_LABEL.WHOLESALE).toBe('ราคาส่ง');
    expect(PRICE_TIER_LABEL.AGENT).toBe('ราคาคนรู้จัก');
  });

  it('14 ระดับที่ไม่รู้จักคืนค่าดิบ', () => {
    expect(priceTierLabel('WEIRD')).toBe('WEIRD');
    expect(priceTierLabel(null)).toBe('—');
    // SPECIAL มีในคอมเมนต์ schema จึงแปลได้ แต่ไม่ใช่ตัวเลือกในหน้าจอ
    expect(priceTierLabel('SPECIAL')).toBe('ราคาพิเศษ');
  });

  it('15 ราคาต่ำกว่าต้นทุน → บอกส่วนต่าง (เตือน ไม่บล็อก)', () => {
    expect(belowCost(20, 25)).toBe(5);
    expect(belowCost(30, 25)).toBeNull();
  });

  it('16 ไม่มีข้อมูลต้นทุน → ไม่เดา', () => {
    expect(belowCost(20, null)).toBeNull();
    expect(belowCost(20, undefined)).toBeNull();
    expect(belowCost(20, 0)).toBeNull();
  });
});

describe('PART 3 / 20 — ลูกค้า', () => {
  const rows = [
    { id: 'c1', code: 'CUS-00001', name: 'โรงเรียนบ้านหนองบัว', phone: '081-1', email: 'a@x.com', contactName: 'ครูสมชาย', isActive: true },
    { id: 'c2', code: 'CUS-00002', name: 'ร้านเจ๊หมวย', phone: null, email: null, contactName: null, isActive: true },
  ] as OrderCustomer[];

  it('17 ค้นได้จากชื่อ รหัส เบอร์ อีเมล และผู้ติดต่อ', () => {
    expect(searchCustomers(rows, 'หนองบัว')).toHaveLength(1);
    expect(searchCustomers(rows, 'CUS-00002')[0].id).toBe('c2');
    expect(searchCustomers(rows, '081')[0].id).toBe('c1');
    expect(searchCustomers(rows, 'a@x')[0].id).toBe('c1');
    expect(searchCustomers(rows, 'ครูสมชาย')[0].id).toBe('c1');
  });

  it('18 คำค้นว่างคืนทุกแถว · ไม่พบคืนศูนย์แถว', () => {
    expect(searchCustomers(rows, '')).toHaveLength(2);
    expect(searchCustomers(rows, 'ไม่มีจริง')).toHaveLength(0);
  });

  it('19 ค่า null ไม่ทำให้ค้นหาพัง', () => {
    expect(() => searchCustomers(rows, 'x')).not.toThrow();
  });

  it('20 ออเดอร์ของลูกค้าเรียงล่าสุดก่อน', () => {
    const orders = [
      { id: 'o1', customerId: 'c1', deliveryDate: '2026-01-01' },
      { id: 'o2', customerId: 'c1', deliveryDate: '2026-03-01' },
      { id: 'o3', customerId: 'c2', deliveryDate: '2026-02-01' },
    ] as Order[];
    const mine = ordersOfCustomer(orders, 'c1');
    expect(mine.map((o) => o.id)).toEqual(['o2', 'o1']);
  });
});

/* ---------- โครงหน้า ---------- */
const FE = path.resolve(__dirname, '..');
const BE = path.resolve(__dirname, '../../../backend');
const read = (base: string, p: string) => fs.readFileSync(path.join(base, p), 'utf8');

const workspace = read(FE, 'pages/orders/OrderWorkspacePage.tsx');
const listPage = read(FE, 'pages/orders/OrdersListPage.tsx');
const detail = read(FE, 'pages/orders/OrderDetailPage.tsx');
const customers = read(FE, 'pages/orders/CustomersPage.tsx');
const partners = read(FE, 'pages/catalog/PartnerMastersPage.tsx');
const dash = read(FE, 'pages/DashboardPage.tsx');
const dashHook = read(FE, 'hooks/useDashboardData.ts');
const css = read(FE, 'styles/orders.css');
const app = read(FE, 'App.tsx');
const schema = read(BE, 'prisma/schema.prisma');
const route = read(BE, 'src/modules/business/business.route.ts');

describe('PART 8–12 — โครงหน้าออเดอร์', () => {
  it('21 ทุกหน้าใช้ primitive กลาง', () => {
    for (const [name, src] of [['list', listPage], ['workspace', workspace], ['detail', detail], ['customers', customers]] as const) {
      expect(src, name).toContain('<PageContainer');
      expect(src, name).toContain('<PageHeader');
    }
    expect(listPage).toContain('<KPIGrid');
    expect(listPage).toContain('<FilterBar');
    expect(workspace).toContain('<StickySummary');
  });

  it('22 เลิกใช้ shell เดิมและไม่มี inline style', () => {
    for (const src of [listPage, workspace, detail, customers]) {
      expect(src).not.toContain('business-page');
      expect(src).not.toContain('business-row');
      expect(src.match(/style=\{\{/g)?.length ?? 0).toBe(0);
    }
  });

  it('23 KPI นับจาก dataset เต็ม ไม่ใช่จากผลที่กรองแล้ว', () => {
    expect(listPage).toContain('const kpi = useMemo(() => ({');
    expect(listPage).toContain('total: all.length');
    // ต้องนับจาก all ไม่ใช่ rows (rows คือผลหลังกรอง)
    expect(listPage).not.toMatch(/kpi[\s\S]{0,200}rows\.filter/);
  });

  it('24 เลิกให้ผู้ใช้พิมพ์รหัสเมนูเอง — ใช้ picker จริง', () => {
    expect(workspace).toContain('catalogApi.menus()');
    expect(workspace).toContain('ค้นหารหัสหรือชื่อเมนู');
    expect(workspace).not.toContain('name="menuId"');
    expect(workspace).not.toContain('name="menuName"');
  });

  it('25 รองรับหลายบรรทัดจริง (POST รับ array อยู่แล้ว)', () => {
    expect(workspace).toContain('const items: NewOrderLine[] = lines.map(');
    expect(workspace).toContain('setLines((cur) => [...cur,');
  });

  it('26 ตัวเลือกลูกค้าค้นหาได้ และมีปุ่มเพิ่มลูกค้าเฉพาะผู้มีสิทธิ์', () => {
    expect(workspace).toContain('searchCustomers(');
    expect(workspace).toContain('{canCreateCustomer && (');
    expect(workspace).toContain("user?.permissions.includes('CUSTOMER_CREATE')");
  });

  it('27 เลือกลูกค้าแล้วมีการ์ดสรุป พร้อมปุ่มเปลี่ยน/ดูข้อมูล', () => {
    expect(workspace).toContain('ord-customer-card');
    expect(workspace).toContain('เปลี่ยนลูกค้า');
    expect(workspace).toContain('ดูข้อมูลลูกค้า');
  });

  it('28 ระดับราคาเป็น radiogroup ใช้คีย์บอร์ดได้', () => {
    expect(workspace).toContain('role="radiogroup" aria-label="ระดับราคา"');
    expect(workspace).toContain('aria-checked={tier === t}');
  });

  it('29 แก้ราคาเองแล้วบอกราคาตามระดับเดิม', () => {
    expect(workspace).toContain('const overridden =');
    expect(workspace).toContain('ord-override');
  });

  it('30 เตือนเมื่อราคาต่ำกว่าต้นทุน แต่ไม่บล็อกการบันทึก', () => {
    expect(workspace).toContain('belowCost(l.unitPrice, l.cost)');
    expect(workspace).toContain('ราคานี้ต่ำกว่าต้นทุน');
    // blockers ต้องไม่มีเงื่อนไขเรื่องราคาต่ำกว่าต้นทุน
    const blockerBlock = workspace.slice(workspace.indexOf('const blockers'), workspace.indexOf('const submit'));
    expect(blockerBlock).not.toContain('belowCost');
  });
});

describe('PART 16–17 — สรุปและการยืนยัน', () => {
  it('31 แผงสรุปบอกครบตามสเปก', () => {
    for (const label of ['ลูกค้า', 'ระดับราคา', 'จำนวนรายการ', 'ยอดรวม', 'ยอดสุทธิ']) {
      expect(workspace, label).toContain(label);
    }
  });

  it('32 บอกตรง ๆ ว่าอะไรคือความจริงทางการเงิน', () => {
    // Phase 8B — ระดับราคาถูกบันทึกแล้ว แต่ยอดเงินยังยึดตามราคาต่อหน่วยเสมอ
    expect(workspace).not.toContain('ระดับราคาที่เลือกเป็นเพียงตัวช่วยเติมราคา');
    expect(workspace).toContain('ยอดเงินของออเดอร์ยึดตามราคาต่อหน่วยเสมอ');
    expect(workspace).toContain('priceTier: tier');
  });

  it('33 ใช้ ConfirmDialog ไม่ใช่ window.confirm', () => {
    for (const src of [workspace, detail, customers]) {
      expect(src).toContain('<ConfirmDialog');
      expect(src).not.toContain('window.confirm(');
    }
  });

  it('34 ยกเลิกออเดอร์ต้องกรอกเหตุผล (backend บังคับอยู่แล้ว)', () => {
    expect(detail).toContain('เหตุผลการยกเลิก *');
    expect(detail).toContain('onConfirm={reason.trim() ?');
    expect(route).toContain('CANCELLATION_REASON_REQUIRED');
  });

  it('35 ไม่แสดงปุ่มเปลี่ยนสถานะที่ backend จะปฏิเสธ', () => {
    expect(detail).toContain('const next = nextStatus(order.status)');
    expect(detail).toContain("canTransition(order.status, 'CANCELLED')");
  });

  it('36 ไม่มีสิทธิ์ = ไม่แสดงปุ่ม และบอกเหตุผล', () => {
    expect(detail).toContain('ต้องให้ผู้มีสิทธิ์ดำเนินการต่อ');
    expect(detail).toContain('{cancellable && canAct && (');
  });
});

describe('PART 19 — ไทม์ไลน์จากเวลาจริง', () => {
  it('37 ใช้เฉพาะคอลัมน์ timestamp ที่ schema มีจริง', () => {
    for (const f of ['confirmedAt', 'sentToOperationsAt', 'issuedAt', 'readyAt', 'deliveredAt', 'cancelledAt']) {
      expect(schema, f).toContain(`${f} `);
      expect(detail, f).toContain(f);
    }
  });

  it('38 PICKING ไม่มี timestamp ใน schema → ต้องบอกตรง ๆ ไม่ปลอมเวลา', () => {
    expect(schema).not.toContain('pickingAt');
    expect(detail).toContain('PICKING: null');
    expect(detail).toContain('ระบบไม่ได้บันทึกเวลาของขั้นนี้');
  });
});

describe('PART 21 — ราคาย้อนหลังต้องไม่ถูกเขียนทับ', () => {
  it('39 schema เก็บ snapshot ของราคาและชื่อไว้ที่บรรทัดออเดอร์', () => {
    const block = schema.slice(schema.indexOf('model SalesOrderItem'), schema.indexOf('model StockIssue'));
    for (const f of ['menuNameSnapshot', 'unitPrice', 'lineTotal', 'unit ']) {
      expect(block, f).toContain(f);
    }
  });

  it('40 backend อ่านออเดอร์โดยไม่ join ตารางราคาขายปัจจุบัน', () => {
    const line = route.split('\n').find((l) => l.includes("app.get('/orders'")) ?? '';
    expect(line).toContain('include: { customer: true, items: true }');
    expect(line).not.toContain('sellingPrice');
  });

  it('41 หน้ารายละเอียดแสดงค่าจาก snapshot ไม่ใช่ราคาปัจจุบัน', () => {
    expect(detail).toContain('{l.menuNameSnapshot}');
    expect(detail).toContain('money(l.unitPrice)');
    expect(detail).toContain('money(l.lineTotal)');
    // ต้องไม่ไปดึงราคาขายมาแสดงในหน้ารายละเอียด
    expect(detail).not.toContain('sellingPrices');
    expect(detail).not.toContain('catalogApi');
  });

  it('42 ราคาขายปัจจุบันเปลี่ยน ก็ไม่กระทบยอดของออเดอร์เก่า', () => {
    // จำลอง: ออเดอร์เก่าบันทึก unitPrice 28 ไว้ ต่อมาตั้งราคาใหม่เป็น 35
    const historical = { quantity: '5', unitPrice: '28.0000', lineTotal: '140.0000' };
    const currentSellingPrice = 35;
    expect(lineTotal(historical.quantity, historical.unitPrice)).toBe(140);
    expect(lineTotal(historical.quantity, historical.unitPrice)).not.toBe(5 * currentSellingPrice);
    expect(Number(historical.lineTotal)).toBe(140);
  });
});

describe('PART 20 — เดินทางระหว่างลูกค้ากับออเดอร์', () => {
  it('43 มี route ครบทั้งสี่หน้า', () => {
    expect(app).toContain('<Route path="/orders" element={<OrdersListPage />} />');
    expect(app).toContain('<Route path="/orders/new" element={<OrderWorkspacePage />} />');
    expect(app).toContain('<Route path="/orders/:id" element={<OrderDetailPage />} />');
    expect(app).toContain('<Route path="/customers/:id" element={<CustomerProfilePage />} />');
  });

  it('44 โปรไฟล์ลูกค้า → สร้างออเดอร์พร้อม preselect', () => {
    expect(customers).toContain('/orders/new?customer=');
    expect(workspace).toContain("params.get('customer')");
  });

  it('45 ออเดอร์ → กลับไปหาลูกค้าได้ทั้งจากรายการและรายละเอียด', () => {
    expect(listPage).toContain('to={`/customers/${o.customerId}`}');
    expect(detail).toContain('to={`/customers/${order.customerId}`}');
  });
});

describe('PART 26–27 — carryover และ dashboard', () => {
  it('46 ประเภทคลังใช้ค่าจาก enum ItemType จริงเท่านั้น', () => {
    const enumBlock = schema.slice(schema.indexOf('enum ItemType'), schema.indexOf('enum ItemType') + 200);
    for (const v of ['RAW_MATERIAL', 'PACKAGING', 'SEMI_FINISHED', 'FINISHED_GOOD', 'CONSUMABLE', 'WASTE']) {
      expect(enumBlock, v).toContain(v);
      expect(partners, v).toContain(v);
    }
    expect(partners).toContain('WAREHOUSE_TYPES');
  });

  it('47 ไม่คิดค่า enum ใหม่ที่ schema ไม่มี', () => {
    const block = partners.slice(partners.indexOf('const WAREHOUSE_TYPES'), partners.indexOf('const warehouseTypeLabel'));
    const values = [...block.matchAll(/value: '([A-Z_]*)'/g)].map((m) => m[1]).filter(Boolean);
    for (const v of values) expect(schema, v).toContain(v);
  });

  it('48 แก้ประเภทคลังส่งไปที่ PATCH ที่รองรับอยู่แล้ว', () => {
    expect(partners).toContain('type: draft.type || null');
    expect(route).toContain('type: z.nativeEnum(ItemType).nullable().optional()');
  });

  it('49 dashboard: totalAmount เป็น Decimal string ต้องแปลงก่อนจัดรูปแบบ', () => {
    expect(dashHook).toContain('totalAmount: string | number');
    expect(dash).toContain('formatMoney(Number(o.totalAmount ?? 0), 2)');
  });

  it('50 dashboard ใช้ mapping สถานะกลางชุดเดียว ไม่ map ซ้ำ', () => {
    expect(dash).toContain("statusLabel('order', o.status)");
    expect(dash).not.toContain('messages.status[');
  });
});

describe('PART 23–25 — responsive / a11y / dark', () => {
  it('51 CSS ใช้ token ไม่ hardcode สีธีม', () => {
    expect(css).toContain('var(--space-');
    expect(css).toContain('var(--control-h)');
    expect(css).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(css).not.toMatch(/color:\s*#[0-9a-f]{6}/i);
  });

  it('52 breakpoint ตรงมาตรฐานระบบ', () => {
    const bps = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(bps.length).toBeGreaterThan(0);
    expect(bps.every((b) => [1024, 760, 430].includes(b))).toBe(true);
  });

  it('53 ปุ่มไอคอนมี aria-label ระบุรายการ', () => {
    expect(workspace).toContain('aria-label={`ลบ ${l.name}`}');
    expect(listPage).toContain('aria-label={`ดาวน์โหลดใบสั่งซื้อ ${o.orderNo}`}');
    expect(customers).toContain('aria-label={`นำ ${c.name} ออกจากรายชื่อ`}');
  });

  it('54 ช่องกรอกในบรรทัดมี aria-label ของตัวเอง', () => {
    expect(workspace).toContain('aria-label={`จำนวน ${l.name}`}');
    expect(workspace).toContain('aria-label={`ราคาต่อหน่วย ${l.name}`}');
  });

  it('55 สถานะไม่สื่อด้วยสีอย่างเดียว', () => {
    expect(listPage).toContain('{orderStatusLabel(o.status)}');
    expect(detail).toContain('{orderStatusLabel(order.status)}');
  });

  it('56 ตารางมี data-label ครบเพื่อกลายเป็นการ์ดบนมือถือ', () => {
    for (const c of ['เลขออเดอร์', 'วันที่ส่ง', 'ลูกค้า', 'ยอดสุทธิ', 'สถานะ']) {
      expect(listPage, c).toContain(`data-label="${c}"`);
    }
    for (const c of ['รายการ', 'จำนวน', 'ราคาต่อหน่วย', 'ยอดรวม']) {
      expect(workspace, c).toContain(`data-label="${c}"`);
    }
  });
});

describe('PART 4 — สถานะว่าง/โหลด/ผิดพลาด', () => {
  it('57 ทุกหน้ามี EmptyState และ Skeleton', () => {
    for (const src of [listPage, customers]) {
      expect(src).toContain('EmptyState');
      expect(src).toContain('SkeletonRows');
    }
    expect(detail).toContain('CardSkeleton');
  });

  it('58 ค้นไม่พบกับยังไม่มีข้อมูล ใช้ข้อความต่างกัน', () => {
    expect(customers).toContain('ยังไม่มีข้อมูลลูกค้า');
    expect(customers).toContain('ไม่พบลูกค้าที่ตรงกับคำค้น');
    expect(listPage).toContain('ยังไม่มีออเดอร์');
    expect(listPage).toContain('ไม่พบออเดอร์ที่ตรงกับตัวกรอง');
  });

  it('59 โหลดพลาดแสดงปุ่มลองใหม่ ไม่พังทั้งหน้า', () => {
    expect(listPage).toContain('ลองใหม่');
    expect(listPage).toContain('void list.refetch()');
    expect(customers).toContain('void list.refetch()');
  });
});
