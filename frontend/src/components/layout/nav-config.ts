import {
  LayoutDashboard, Boxes, UtensilsCrossed, Calculator, CircleDollarSign,
  Truck, Factory, Warehouse, ArrowLeftRight, ClipboardCheck,
  BarChart3, UsersRound, History, Settings, Sprout, Package,
  Database, ChartColumnBig, ShieldCheck, UserRoundPlus, Scale, PackageSearch, type LucideIcon,
} from 'lucide-react';

export type ModuleStatus = 'ready' | 'in-progress' | 'planned';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** ถ้ากำหนด ต้องมี role นี้จึงจะเห็นเมนู (ตาม permission เดิม) */
  requiredRole?: string;
  requiredPermission?: string;
  /** เห็นเมนูได้ถ้ามีสิทธิ์ "ข้อใดข้อหนึ่ง" (SUPER_ADMIN ผ่านเสมอ) */
  requiredAnyPermission?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface ModuleMeta {
  label: string;
  description: string;
  icon: LucideIcon;
  status: ModuleStatus;
  /** ป้ายกลุ่มสำหรับ breadcrumb */
  group: string;
  /** สิ่งที่จะรองรับในอนาคต (ใช้ในหน้า Placeholder) */
  plannedFeatures?: string[];
}

/** สถานะการพัฒนาระบบ (ไม่ใช่ข้อมูลธุรกิจจริง) */
export const MODULES: Record<string, ModuleMeta> = {
  '/dashboard': { label: 'ภาพรวม', description: 'ภาพรวมต้นทุน เมนู และ KPI ของร้าน', icon: LayoutDashboard, status: 'ready', group: 'ภาพรวม' },
  '/ingredients': {
    label: 'วัตถุดิบ', description: 'ทะเบียนวัตถุดิบ ราคาซื้อ หน่วย และต้นทุนต่อหน่วยฐาน',
    icon: Sprout, status: 'ready', group: 'จัดการเมนูและต้นทุน',
  },
  '/packaging': {
    label: 'บรรจุภัณฑ์', description: 'กล่อง ถุง ช้อนส้อม ฝา และวัสดุสิ้นเปลืองที่ใช้ใส่อาหาร',
    icon: Package, status: 'ready', group: 'จัดการเมนูและต้นทุน',
  },
  '/catalog': {
    label: 'คลังข้อมูล', description: 'ค้นดูรายชื่อวัตถุดิบและเมนูที่ขายในที่เดียว',
    icon: Database, status: 'ready', group: 'ข้อมูลและยอดขาย',
  },
  '/sales': {
    label: 'สรุปการขาย', description: 'เมนูขายดี เมนูขายไม่ดี รายได้และกำไรต่อเมนู',
    icon: ChartColumnBig, status: 'ready', group: 'ข้อมูลและยอดขาย',
  },
  '/items': {
    label: 'วัตถุดิบและสินค้า', description: 'ทะเบียนวัตถุดิบ บรรจุภัณฑ์ และสินค้าสำเร็จรูป พร้อมหน่วยนับและหมวดหมู่',
    icon: Boxes, status: 'in-progress', group: 'การจัดการสินค้า',
    plannedFeatures: ['ทะเบียนวัตถุดิบและสินค้าพร้อมรหัส SKU', 'กำหนดหน่วยนับหลักและหน่วยซื้อ', 'จัดหมวดหมู่และสถานะการใช้งาน', 'ประวัติการเปลี่ยนแปลงราคาต่อรายการ'],
  },
  '/recipes': {
    label: 'สูตรเมนูอาหาร', description: 'สร้างสูตรเมนูจากวัตถุดิบและบรรจุภัณฑ์ พร้อมต้นทุนต่อจาน',
    icon: UtensilsCrossed, status: 'ready', group: 'จัดการเมนูและต้นทุน',
  },
  '/units/conversions': {
    label: 'สูตรแปลงหน่วย', description: 'ตั้งค่าว่า 1 หน่วยหนึ่งเท่ากับกี่หน่วยอีกแบบ เพื่อให้คิดต้นทุนได้ถูกต้อง',
    icon: Scale, status: 'ready', group: 'จัดการเมนูและต้นทุน',
  },
  '/costing': {
    label: 'คำนวณต้นทุน', description: 'คำนวณต้นทุนต่อเมนูจากสูตรและราคาวัตถุดิบล่าสุด',
    icon: Calculator, status: 'ready', group: 'จัดการเมนูและต้นทุน',
  },
  '/pricing': {
    label: 'ราคาขายและกำไร', description: 'ตั้งราคาขายและวิเคราะห์กำไรต่อเมนูจากต้นทุนจริง',
    icon: CircleDollarSign, status: 'ready', group: 'จัดการเมนูและต้นทุน',
  },
  '/receiving': {
    label: 'รับสินค้าเข้าคลัง', description: 'บันทึกการรับวัตถุดิบและสินค้าเข้าคลังพร้อมล็อตและวันหมดอายุ',
    icon: Truck, status: 'in-progress', group: 'คลังและการผลิต',
    plannedFeatures: ['สร้างใบรับสินค้าจากผู้ขาย', 'บันทึกล็อตและวันหมดอายุ', 'ตัดยอดเข้าสต๊อกอัตโนมัติ', 'แนบเอกสารและอ้างอิงใบสั่งซื้อ'],
  },
  '/production': {
    label: 'การผลิต', description: 'สร้างใบสั่งผลิต เบิกวัตถุดิบ และบันทึกผลผลิต',
    icon: Factory, status: 'ready', group: 'คลังและการผลิต',
    plannedFeatures: ['สร้างใบสั่งผลิตจากสูตร', 'เบิกวัตถุดิบตาม BOM', 'บันทึกผลผลิตและของเสีย', 'ติดตามสถานะการผลิต'],
  },
  '/purchase-planning': {
    label: 'วางแผนจัดซื้อ', description: 'คำนวณความต้องการวัตถุดิบและส่วนขาดจากแผนการผลิตโดยไม่จองสต็อก',
    icon: ClipboardCheck, status: 'ready', group: 'คลังและการผลิต',
  },
  '/purchase-orders': {
    label: 'ใบสั่งซื้อ', description: 'ข้อผูกพันการจัดซื้อ ติดตามการรับบางส่วนและผลต่างจากของที่มาถึงจริง',
    icon: ClipboardCheck, status: 'ready', group: 'คลังและการผลิต',
  },
  '/inventory': {
    label: 'คลังสินค้า', description: 'ดูยอดคงเหลือตามคลัง ล็อต และตำแหน่งจัดเก็บแบบเรียลไทม์',
    icon: Warehouse, status: 'planned', group: 'คลังและการผลิต',
    plannedFeatures: ['ยอดคงเหลือแยกตามคลังและล็อต', 'แจ้งเตือนสต๊อกต่ำและใกล้หมดอายุ', 'มูลค่าสต๊อกตามต้นทุน', 'ติดตามการเคลื่อนไหวผ่าน ledger'],
  },
  '/transfers': {
    label: 'โอนคลัง', description: 'โอนย้ายสินค้าระหว่างคลังพร้อมติดตามสถานะ',
    icon: ArrowLeftRight, status: 'planned', group: 'คลังและการผลิต',
    plannedFeatures: ['สร้างใบโอนระหว่างคลัง', 'ยืนยันรับปลายทาง', 'ตัด-เพิ่มสต๊อกทั้งสองฝั่ง', 'ประวัติการโอนย้าย'],
  },
  '/stock-count': {
    label: 'ตรวจนับและปรับสต๊อก', description: 'ตรวจนับสินค้าคงคลังและปรับยอดให้ตรงกับความเป็นจริง',
    icon: ClipboardCheck, status: 'planned', group: 'คลังและการผลิต',
    plannedFeatures: ['สร้างรอบตรวจนับ', 'บันทึกยอดนับจริงเทียบยอดระบบ', 'อนุมัติการปรับปรุงส่วนต่าง', 'บันทึกเหตุผลและผู้อนุมัติ'],
  },
  '/reports': {
    label: 'รายงาน', description: 'รายงานต้นทุน สต๊อก การผลิต และกำไรสำหรับผู้บริหาร',
    icon: BarChart3, status: 'planned', group: 'ระบบและรายงาน',
    plannedFeatures: ['รายงานต้นทุนและกำไรต่อสินค้า', 'รายงานความเคลื่อนไหวสต๊อก', 'รายงานการผลิตและของเสีย', 'ส่งออกเป็น Excel/PDF'],
  },
  '/users': { label: 'ผู้ใช้งาน', description: 'จัดการบัญชีผู้ใช้และบทบาทในระบบ', icon: UsersRound, status: 'ready', group: 'ระบบและรายงาน' },
  '/activity': { label: 'ประวัติการใช้งาน', description: 'ประวัติการเข้าใช้งานและการเปลี่ยนแปลงข้อมูล', icon: History, status: 'ready', group: 'ระบบและรายงาน' },
  '/settings': {
    label: 'ตั้งค่าระบบ', description: 'ตั้งค่าพารามิเตอร์ระบบ หน่วยนับ คลัง และค่าเริ่มต้น',
    icon: Settings, status: 'planned', group: 'ระบบและรายงาน',
    plannedFeatures: ['ตั้งค่าองค์กรและข้อมูลทั่วไป', 'จัดการหน่วยนับและการแปลงหน่วย', 'กำหนดคลังและตำแหน่งจัดเก็บ', 'ตั้งค่าเกณฑ์แจ้งเตือน'],
  },
};

/**
 * Information Architecture — PHASE 34
 *
 * เดิมกลุ่ม "คลังสินค้าและปฏิบัติการ" รวมไว้ 15 เมนูในกลุ่มเดียว ทำให้แถบข้างยาวจนหาเมนูไม่เจอ
 * เฟสนี้จัดกลุ่มใหม่ตามสายงานจริง (ต้นทุน / ขาย / คลัง / จัดซื้อ / ผลิต / รายงาน / ระบบ)
 * โดยยังใช้ path และเงื่อนไขสิทธิ์ชุดเดิมทุกรายการ ไม่มีเมนูใดถูกตัดออกหรือเพิ่มเข้ามา
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'ภาพรวม',
    items: [{ path: '/dashboard', label: 'ภาพรวม', icon: LayoutDashboard, requiredPermission: 'DASHBOARD_VIEW' }],
  },
  {
    label: 'ต้นทุนและสูตร',
    items: [
      { path: '/ingredients', label: 'วัตถุดิบ', icon: Sprout },
      { path: '/packaging', label: 'บรรจุภัณฑ์', icon: Package },
      { path: '/recipes', label: 'สูตรเมนูอาหาร', icon: UtensilsCrossed },
      // สิทธิ์เดียวกับการจัดการหน่วย/อัตราแปลงที่ backend ใช้ (MANAGE ใน unit.route.ts)
      { path: '/units/conversions', label: 'สูตรแปลงหน่วย', icon: Scale, requiredAnyPermission: ['INGREDIENT_CREATE', 'INGREDIENT_EDIT', 'PACKAGING_CREATE', 'PACKAGING_EDIT'] },
      { path: '/costing', label: 'คำนวณต้นทุน', icon: Calculator },
      { path: '/pricing', label: 'ราคาขายและกำไร', icon: CircleDollarSign },
      { path: '/analytics/profit-simulator', label: 'จำลองต้นทุนและกำไร', icon: ChartColumnBig, requiredAnyPermission: ['COSTING_VIEW', 'RECIPE_VIEW', 'PRICING_VIEW'] },
      { path: '/analytics/cost-variance', label: 'วิเคราะห์ความเปลี่ยนแปลงต้นทุน', icon: ChartColumnBig, requiredAnyPermission: ['COSTING_VIEW', 'RECIPE_VIEW', 'PRODUCTION_VIEW'] },
    ],
  },
  {
    label: 'การขายและลูกค้า',
    items: [
      { path: '/orders', label: 'ออเดอร์', icon: ClipboardCheck, requiredPermission: 'ORDER_VIEW' },
      { path: '/customers', label: 'ลูกค้า', icon: UsersRound, requiredPermission: 'CUSTOMER_VIEW' },
      { path: '/catalog', label: 'คลังข้อมูล', icon: Database },
      { path: '/sales', label: 'สรุปการขาย / KPI เมนู', icon: ChartColumnBig },
    ],
  },
  {
    label: 'สินค้าและคลัง',
    items: [
      { path: '/units', label: 'หน่วย', icon: Scale, requiredAnyPermission: ['INGREDIENT_CREATE', 'INGREDIENT_EDIT', 'PACKAGING_CREATE', 'PACKAGING_EDIT'] },
      // สิทธิ์ตรงกับที่ GET /business/operations/lookups ยอมให้เข้า เพื่อไม่ให้กดแล้วเจอ 403
      { path: '/warehouses', label: 'คลัง', icon: Warehouse, requiredAnyPermission: ['RECEIVING_CREATE', 'STOCK_ISSUE_CREATE', 'ORDER_VIEW'] },
      { path: '/inventory', label: 'สต็อกคงเหลือ', icon: Warehouse, requiredAnyPermission: ['INVENTORY_VIEW', 'STOCK_VIEW'] },
      { path: '/inventory/lots', label: 'Lot และวันหมดอายุ', icon: PackageSearch, requiredAnyPermission: ['INVENTORY_VIEW', 'STOCK_VIEW'] },
      { path: '/inventory/movements', label: 'ประวัติสต็อก', icon: History, requiredAnyPermission: ['INVENTORY_VIEW', 'STOCK_VIEW'] },
      { path: '/stock-issues', label: 'เบิกให้ครัวกลาง', icon: Boxes, requiredPermission: 'STOCK_ISSUE_VIEW' },
      { path: '/stock-transfers', label: 'โอนย้ายระหว่างคลัง', icon: ArrowLeftRight, requiredAnyPermission: ['STOCK_TRANSFER_VIEW', 'STOCK_VIEW'] },
      { path: '/inventory/adjustments', label: 'ปรับปรุงสต็อก', icon: ArrowLeftRight, requiredPermission: 'INVENTORY_ADJUST' },
    ],
  },
  {
    label: 'จัดซื้อ',
    items: [
      { path: '/purchase-planning', label: 'วางแผนจัดซื้อ', icon: ClipboardCheck, requiredAnyPermission: ['PURCHASE_PLAN_VIEW', 'PURCHASE_PLAN_CREATE', 'PURCHASE_PLAN_EDIT'] },
      { path: '/purchase-orders', label: 'ใบสั่งซื้อ', icon: ClipboardCheck, requiredAnyPermission: ['PURCHASE_ORDER_VIEW', 'PURCHASE_ORDER_CREATE', 'PURCHASE_ORDER_EDIT'] },
      { path: '/receiving', label: 'รับของเข้า', icon: Truck, requiredPermission: 'RECEIVING_VIEW' },
      { path: '/suppliers', label: 'ผู้จำหน่าย', icon: Truck, requiredAnyPermission: ['RECEIVING_CREATE', 'STOCK_ISSUE_CREATE', 'ORDER_VIEW'] },
      { path: '/supplier-analytics', label: 'วิเคราะห์ผู้จำหน่าย', icon: ChartColumnBig, requiredAnyPermission: ['RECEIVING_VIEW', 'PURCHASE_ORDER_VIEW'] },
    ],
  },
  {
    label: 'การผลิต',
    items: [
      { path: '/production', label: 'การผลิต', icon: Factory, requiredAnyPermission: ['PRODUCTION_VIEW', 'PRODUCTION_CREATE'] },
    ],
  },
  {
    label: 'รายงานและวิเคราะห์',
    items: [
      { path: '/inventory/valuation', label: 'มูลค่าสต็อก', icon: Scale, requiredAnyPermission: ['INVENTORY_VIEW', 'STOCK_VIEW'] },
      { path: '/inventory/valuation/history', label: 'ประวัติมูลค่าสต็อก', icon: History, requiredAnyPermission: ['INVENTORY_VIEW', 'STOCK_VIEW'] },
    ],
  },
  {
    // Phase 9 — แยกงานดูแลผู้ใช้ออกจากงานความปลอดภัย/ตรวจสอบ ให้หาเจอง่ายขึ้น
    // เฟส 34 คงการแยกสามกลุ่มนี้ไว้ตามเดิม เพราะเป็นการตัดสินใจเชิง IA ที่มีเหตุผลอยู่แล้ว
    label: 'การจัดการผู้ใช้',
    items: [
      // สิทธิ์ตรงกับที่ GET /users ยอมให้เข้า จึงไม่กดแล้วเจอ 403
      { path: '/users', label: 'ผู้ใช้งาน', icon: UsersRound, requiredAnyPermission: ['USER_VIEW', 'USER_MANAGE'] },
      { path: '/admin/registrations', label: 'คำขอลงทะเบียน', icon: UserRoundPlus, requiredPermission: 'USER_MANAGE' },
    ],
  },
  {
    label: 'สิทธิ์และความปลอดภัย',
    items: [
      // matrix ยอมให้ ROLE_MANAGE | PERMISSION_MANAGE | USER_MANAGE เข้าได้
      { path: '/admin/permissions', label: 'บทบาทและสิทธิ์', icon: ShieldCheck, requiredAnyPermission: ['ROLE_MANAGE', 'PERMISSION_MANAGE', 'USER_MANAGE'] },
    ],
  },
  {
    label: 'การตรวจสอบระบบ',
    items: [
      // /activity เป็น SUPER_ADMIN เท่านั้นตาม backend
      { path: '/activity', label: 'ประวัติการใช้งาน', icon: History, requiredRole: 'SUPER_ADMIN' },
      { path: '/settings', label: 'ตั้งค่าระบบ', icon: Settings, requiredRole: 'SUPER_ADMIN' },
    ],
  },
];

/* ============================================================
   PHASE 34 — หัวข้อกลุ่มที่ใช้ร่วมกันระหว่าง "แถบข้าง" กับ "breadcrumb บนหัวเว็บ"
   เดิมหัวเว็บ hardcode ให้ทุกหน้าที่อยู่ใน navigationKeyByPath แสดงกลุ่มว่า "ระบบ"
   ทำให้หน้าอย่างภาพรวม/วัตถุดิบ/ออเดอร์ ขึ้น breadcrumb ผิดกลุ่มไปหมด
   ตอนนี้ทั้งสองที่อ่านจาก NAV_GROUPS ชุดเดียวกัน จึงตรงกันเสมอ
   ============================================================ */

export const NAV_GROUP_I18N_KEY: Record<string, string> = {
  'ภาพรวม': 'overview',
  'จัดการเมนูและต้นทุน': 'menuCost',
  'ข้อมูลและยอดขาย': 'dataSales',
  'ออเดอร์และปฏิบัติการ': 'orderOperations',
  'ต้นทุนและสูตร': 'grpCost',
  'การขายและลูกค้า': 'grpSalesCustomer',
  'สินค้าและคลัง': 'grpStock',
  'จัดซื้อ': 'grpPurchasing',
  'การผลิต': 'production',
  'รายงานและวิเคราะห์': 'grpReports',
  'การจัดการผู้ใช้': 'grpUserAdmin',
  'สิทธิ์และความปลอดภัย': 'grpSecurity',
  'การตรวจสอบระบบ': 'grpAudit',
  'ระบบ': 'system',
};

/** แปลหัวข้อกลุ่มเป็นภาษาปัจจุบัน กลุ่มที่ยังไม่มีคำแปลให้ใช้ชื่อไทยเดิม */
export function navGroupHeading(label: string, nav: Record<string, string>): string {
  const key = NAV_GROUP_I18N_KEY[label];
  return (key && nav[key]) || label;
}

/**
 * หากลุ่มที่ path นี้สังกัดอยู่จริงใน NAV_GROUPS
 * ใช้ prefix ที่ยาวที่สุดที่ตรง เพื่อให้ /inventory/lots ไปเข้ากลุ่มของ /inventory/lots
 * ไม่ใช่ของ /inventory ที่สั้นกว่า
 */
export function navGroupLabelForPath(pathname: string): string | undefined {
  let best: string | undefined;
  let bestLength = -1;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const isMatch = pathname === item.path || pathname.startsWith(`${item.path}/`);
      if (isMatch && item.path.length > bestLength) {
        bestLength = item.path.length;
        best = group.label;
      }
    }
  }
  return best;
}

/** สถานะโมดูล (ป้ายภาษาไทย) สำหรับ badge */
export const STATUS_LABEL: Record<ModuleStatus, string> = {
  ready: 'พร้อมใช้งาน',
  'in-progress': 'กำลังพัฒนา',
  planned: 'วางแผนไว้',
};
export const STATUS_BADGE: Record<ModuleStatus, string> = {
  ready: 'success',
  'in-progress': 'warning',
  planned: 'muted',
};
