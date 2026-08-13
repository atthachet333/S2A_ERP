import {
  LayoutDashboard, Boxes, UtensilsCrossed, Calculator, CircleDollarSign,
  Truck, Factory, Warehouse, ArrowLeftRight, ClipboardCheck,
  BarChart3, UsersRound, History, Settings, Sprout, Package,
  Database, ChartColumnBig, ShieldCheck, UserRoundPlus, type LucideIcon,
} from 'lucide-react';

export type ModuleStatus = 'ready' | 'in-progress' | 'planned';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** ถ้ากำหนด ต้องมี role นี้จึงจะเห็นเมนู (ตาม permission เดิม) */
  requiredRole?: string;
  requiredPermission?: string;
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
    icon: Factory, status: 'planned', group: 'คลังและการผลิต',
    plannedFeatures: ['สร้างใบสั่งผลิตจากสูตร', 'เบิกวัตถุดิบตาม BOM', 'บันทึกผลผลิตและของเสีย', 'ติดตามสถานะการผลิต'],
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
 * Information Architecture (PART C) — โฟกัสแกนหลัก: food costing + menu + pricing + sales
 * โซน "คลังและการผลิต" แบบโรงงานถูกถอดออกจาก main nav แล้ว (โค้ด/route เดิมยังคงอยู่เพื่อ backward-compat)
 */
export const NAV_GROUPS: NavGroup[] = [
  { label: 'ภาพรวม', items: [{ path: '/dashboard', label: 'ภาพรวม', icon: LayoutDashboard, requiredPermission: 'DASHBOARD_VIEW' }] },
  {
    label: 'จัดการเมนูและต้นทุน',
    items: [
      { path: '/ingredients', label: 'วัตถุดิบ', icon: Sprout },
      { path: '/packaging', label: 'บรรจุภัณฑ์', icon: Package },
      { path: '/recipes', label: 'สูตรเมนูอาหาร', icon: UtensilsCrossed },
      { path: '/costing', label: 'คำนวณต้นทุน', icon: Calculator },
      { path: '/pricing', label: 'ราคาขายและกำไร', icon: CircleDollarSign },
    ],
  },
  {
    label: 'ข้อมูลและยอดขาย',
    items: [
      { path: '/catalog', label: 'คลังข้อมูล', icon: Database },
      { path: '/sales', label: 'สรุปการขาย / KPI เมนู', icon: ChartColumnBig },
    ],
  },
  {
    label: 'ออเดอร์และปฏิบัติการ',
    items: [
      { path: '/orders', label: 'ออเดอร์', icon: ClipboardCheck, requiredPermission: 'ORDER_VIEW' },
      { path: '/customers', label: 'ลูกค้า', icon: UsersRound, requiredPermission: 'CUSTOMER_VIEW' },
      { path: '/receiving', label: 'รับของเข้า', icon: Truck, requiredPermission: 'RECEIVING_VIEW' },
      { path: '/stock-issues', label: 'เบิกให้ครัวกลาง', icon: Boxes, requiredPermission: 'STOCK_ISSUE_VIEW' },
    ],
  },
  {
    label: 'ระบบ',
    items: [
      { path: '/users', label: 'ผู้ใช้งาน', icon: UsersRound, requiredRole: 'SUPER_ADMIN' },
      { path: '/admin/registrations', label: 'คำขอสมัครใช้งาน', icon: UserRoundPlus, requiredPermission: 'USER_MANAGE' },
      { path: '/admin/permissions', label: 'จัดการสิทธิ์และบทบาท', icon: ShieldCheck, requiredRole: 'SUPER_ADMIN' },
      { path: '/activity', label: 'ประวัติการใช้งาน', icon: History, requiredRole: 'SUPER_ADMIN' },
      { path: '/settings', label: 'ตั้งค่าระบบ', icon: Settings, requiredRole: 'SUPER_ADMIN' },
    ],
  },
];

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
