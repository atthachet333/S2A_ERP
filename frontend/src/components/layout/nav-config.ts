import {
  LayoutDashboard, Boxes, UtensilsCrossed, Calculator, CircleDollarSign,
  Truck, Factory, Warehouse, ArrowLeftRight, ClipboardCheck,
  BarChart3, UsersRound, History, Settings, type LucideIcon,
} from 'lucide-react';

export type ModuleStatus = 'ready' | 'in-progress' | 'planned';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** ถ้ากำหนด ต้องมี role นี้จึงจะเห็นเมนู (ตาม permission เดิม) */
  requiredRole?: string;
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
  '/dashboard': { label: 'ภาพรวม', description: 'ภาพรวมระบบและทางลัดการทำงาน', icon: LayoutDashboard, status: 'ready', group: 'ภาพรวม' },
  '/items': {
    label: 'วัตถุดิบและสินค้า', description: 'ทะเบียนวัตถุดิบ บรรจุภัณฑ์ และสินค้าสำเร็จรูป พร้อมหน่วยนับและหมวดหมู่',
    icon: Boxes, status: 'in-progress', group: 'การจัดการสินค้า',
    plannedFeatures: ['ทะเบียนวัตถุดิบและสินค้าพร้อมรหัส SKU', 'กำหนดหน่วยนับหลักและหน่วยซื้อ', 'จัดหมวดหมู่และสถานะการใช้งาน', 'ประวัติการเปลี่ยนแปลงราคาต่อรายการ'],
  },
  '/recipes': {
    label: 'สูตรและเมนู', description: 'จัดการสูตรการผลิต ส่วนผสม และเวอร์ชันของแต่ละเมนู',
    icon: UtensilsCrossed, status: 'planned', group: 'การจัดการสินค้า',
    plannedFeatures: ['สร้างสูตรพร้อมส่วนผสมและปริมาณ', 'เก็บหลายเวอร์ชันของสูตร', 'คำนวณ yield และของเสีย', 'ผูกสูตรกับสินค้าสำเร็จรูป'],
  },
  '/costing': {
    label: 'คำนวณต้นทุน', description: 'คำนวณต้นทุนต่อหน่วยจากสูตรและราคาวัตถุดิบล่าสุด',
    icon: Calculator, status: 'planned', group: 'การจัดการสินค้า',
    plannedFeatures: ['คำนวณต้นทุนจากสูตรอัตโนมัติ', 'รวมต้นทุนวัตถุดิบ แรงงาน และโสหุ้ย', 'เปรียบเทียบต้นทุนแต่ละเวอร์ชัน', 'บันทึกประวัติต้นทุนตามช่วงเวลา'],
  },
  '/pricing': {
    label: 'ราคาขายและกำไร', description: 'ตั้งราคาขายและวิเคราะห์กำไรต่อหน่วยจากต้นทุนจริง',
    icon: CircleDollarSign, status: 'planned', group: 'การจัดการสินค้า',
    plannedFeatures: ['ตั้งราคาขายต่อสินค้า', 'คำนวณอัตรากำไรอัตโนมัติ', 'จำลองราคาตามเป้ากำไร', 'ประวัติการปรับราคาขาย'],
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

export const NAV_GROUPS: NavGroup[] = [
  { label: 'ภาพรวม', items: [{ path: '/dashboard', label: 'ภาพรวม', icon: LayoutDashboard }] },
  {
    label: 'การจัดการสินค้า',
    items: [
      { path: '/items', label: 'วัตถุดิบและสินค้า', icon: Boxes },
      { path: '/recipes', label: 'สูตรและเมนู', icon: UtensilsCrossed },
      { path: '/costing', label: 'คำนวณต้นทุน', icon: Calculator },
      { path: '/pricing', label: 'ราคาขายและกำไร', icon: CircleDollarSign },
    ],
  },
  {
    label: 'คลังและการผลิต',
    items: [
      { path: '/receiving', label: 'รับสินค้าเข้าคลัง', icon: Truck },
      { path: '/production', label: 'การผลิต', icon: Factory },
      { path: '/inventory', label: 'คลังสินค้า', icon: Warehouse },
      { path: '/transfers', label: 'โอนคลัง', icon: ArrowLeftRight },
      { path: '/stock-count', label: 'ตรวจนับและปรับสต๊อก', icon: ClipboardCheck },
    ],
  },
  {
    label: 'ระบบและรายงาน',
    items: [
      { path: '/reports', label: 'รายงาน', icon: BarChart3 },
      { path: '/users', label: 'ผู้ใช้งาน', icon: UsersRound, requiredRole: 'SUPER_ADMIN' },
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
