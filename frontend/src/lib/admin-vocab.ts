import type { Locale } from '@/i18n/i18n';

/**
 * PHASE 9 — คำศัพท์กลางฝั่งผู้ดูแลระบบ
 *
 * แหล่งความจริงทั้งหมดอยู่ที่ backend:
 *   - กลุ่ม permission มาจาก groupOf() ใน admin.route.ts (ส่งมากับ matrix)
 *   - RoleName มาจาก enum ใน schema.prisma
 *   - action ของ audit มาจากค่าที่เขียนลง AuditLog จริง
 *
 * ไฟล์นี้ทำหน้าที่ "แปลให้คนอ่านรู้เรื่อง" เท่านั้น
 * ไม่ตัดสินสิทธิ์ ไม่เพิ่ม/ลด permission และค่าที่ไม่รู้จักคืนค่าดิบเสมอ
 */

/* ============================================================
   ROLE
   ============================================================ */
/** ค่าจริงจาก enum RoleName — ห้ามเพิ่มค่าที่ schema ไม่มี */
export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด',
  ADMIN: 'ผู้ดูแลระบบ',
  MANAGER: 'ผู้จัดการ',
  EXECUTIVE: 'ผู้บริหาร',
  OPERATIONS: 'ปฏิบัติการ',
  ORDER_COORDINATOR: 'ผู้ประสานงานออเดอร์',
  CHEF: 'เชฟ',
  COSTING_STAFF: 'เจ้าหน้าที่ต้นทุน',
  PURCHASING: 'จัดซื้อ',
  WAREHOUSE: 'คลังสินค้า',
  PRODUCTION: 'ฝ่ายผลิต',
  SALES: 'ฝ่ายขาย',
};
export const roleLabel = (name: string | null | undefined): string => {
  if (!name) return '—';
  return ROLE_LABEL[name] ?? name;
};

/* ============================================================
   PERMISSION GROUP
   ============================================================ */
/**
 * ลำดับการแสดงกลุ่ม — เรียงตามลำดับงานจริงในระบบ
 * กลุ่มที่ไม่อยู่ในลิสต์จะไปต่อท้ายตามตัวอักษร
 */
const GROUP_ORDER = [
  'Dashboard', 'Ingredients', 'Packaging', 'Recipes', 'Costing', 'Pricing',
  'Customers', 'Orders', 'Receiving', 'Stock', 'StockIssue', 'StockTransfer', 'Companies', 'Documents',
  'Reports', 'Notifications', 'Users', 'Permissions', 'Audit', 'Settings', 'Other',
];
export function sortGroups(groups: string[]): string[] {
  return groups.slice().sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/* ============================================================
   PERMISSION LABEL (i18n) — ย้ายมาจาก AdminPermissionsPage
   เพื่อให้มีที่เดียว ไม่เกิด mapping ซ้ำ
   ============================================================ */
export const GROUP_LABELS: Record<string, Record<Locale, string>> = {
  Ingredients: { th: 'วัตถุดิบ', en: 'Ingredients', 'zh-CN': '原料' },
  Packaging: { th: 'บรรจุภัณฑ์', en: 'Packaging', 'zh-CN': '包装' },
  Recipes: { th: 'สูตรอาหาร', en: 'Recipes', 'zh-CN': '配方' },
  Costing: { th: 'ต้นทุน', en: 'Costing', 'zh-CN': '成本' },
  Pricing: { th: 'ราคาขาย/กำไร', en: 'Pricing', 'zh-CN': '售价' },
  Customers: { th: 'ลูกค้า', en: 'Customers', 'zh-CN': '客户' },
  Orders: { th: 'ออเดอร์', en: 'Orders', 'zh-CN': '订单' },
  Receiving: { th: 'รับของ', en: 'Receiving', 'zh-CN': '入库' },
  Stock: { th: 'สต๊อก', en: 'Stock', 'zh-CN': '库存' },
  // PHASE 19 — แยกกลุ่มงานเบิกและงานโอนย้ายออกจากสต๊อกรวม ป้ายจะได้ไม่ซ้ำกันจนติ๊กผิดช่อง
  StockIssue: { th: 'ใบเบิก', en: 'Stock issue', 'zh-CN': '领料单' },
  StockTransfer: { th: 'ใบโอนย้าย', en: 'Stock transfer', 'zh-CN': '调拨单' },
  Companies: { th: 'บริษัท', en: 'Companies', 'zh-CN': '公司' },
  Dashboard: { th: 'แดชบอร์ด', en: 'Dashboard', 'zh-CN': '仪表板' },
  Reports: { th: 'รายงาน', en: 'Reports', 'zh-CN': '报表' },
  Notifications: { th: 'การแจ้งเตือน', en: 'Notifications', 'zh-CN': '通知' },
  Documents: { th: 'เอกสาร', en: 'Documents', 'zh-CN': '文档' },
  Users: { th: 'ผู้ใช้งาน', en: 'Users', 'zh-CN': '用户' },
  Permissions: { th: 'สิทธิ์และบทบาท', en: 'Permissions', 'zh-CN': '权限' },
  Audit: { th: 'บันทึกการใช้งาน', en: 'Audit', 'zh-CN': '审计' },
  Settings: { th: 'ตั้งค่าระบบ', en: 'Settings', 'zh-CN': '设置' },
  Other: { th: 'อื่น ๆ', en: 'Other', 'zh-CN': '其他' },
};
const ACTION_LABELS: Record<string, Record<Locale, string>> = {
  VIEW: { th: 'ดู', en: 'View', 'zh-CN': '查看' },
  CREATE: { th: 'เพิ่ม', en: 'Add', 'zh-CN': '新增' },
  EDIT: { th: 'แก้ไข', en: 'Edit', 'zh-CN': '编辑' },
  MANAGE: { th: 'จัดการ', en: 'Manage', 'zh-CN': '管理' },
  CALCULATE: { th: 'คำนวณ', en: 'Calculate', 'zh-CN': '计算' },
  CONFIRM: { th: 'ยืนยัน', en: 'Confirm', 'zh-CN': '确认' },
  SEND: { th: 'ส่ง', en: 'Send', 'zh-CN': '发送' },
  CANCEL: { th: 'ยกเลิก', en: 'Cancel', 'zh-CN': '取消' },
  COMPLETE: { th: 'ปิดงาน', en: 'Complete', 'zh-CN': '完成' },
  REVERSE: { th: 'กลับรายการ', en: 'Reverse', 'zh-CN': '冲销' },
  ADJUST: { th: 'ปรับปรุง', en: 'Adjust', 'zh-CN': '调整' },
  SWITCH: { th: 'สลับ', en: 'Switch', 'zh-CN': '切换' },
  DOWNLOAD: { th: 'ดาวน์โหลด', en: 'Download', 'zh-CN': '下载' },
  EMAIL: { th: 'ส่งอีเมล', en: 'Email', 'zh-CN': '发邮件' },
  SETTINGS: { th: 'ตั้งค่า', en: 'Settings', 'zh-CN': '设置' },
};
export function labelFor(code: string, group: string, locale: Locale): string {
  const g = GROUP_LABELS[group]?.[locale] ?? group;
  const suffix = code.split('_').slice(-1)[0];
  const action = ACTION_LABELS[suffix]?.[locale];
  if (code === 'PERMISSION_MANAGE') return locale === 'th' ? 'จัดการสิทธิ์' : locale === 'en' ? 'Manage permissions' : '管理权限';
  if (code === 'ROLE_MANAGE') return locale === 'th' ? 'จัดการบทบาท' : locale === 'en' ? 'Manage roles' : '管理角色';
  if (!action) return g;
  return locale === 'th' ? `${action}${g}` : `${action} ${g}`;
}

/* ============================================================
   AUDIT ACTION
   ============================================================ */
/**
 * แปลง action ของ AuditLog เป็นภาษาคน
 * ค่าเหล่านี้ยืนยันจากที่โค้ดเขียนลง AuditLog จริง
 * (business.route.ts / admin.route.ts / auth.service.ts)
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  CREATE: 'สร้างข้อมูล',
  UPDATE: 'แก้ไขข้อมูล',
  DELETE: 'ลบข้อมูล',
  STATUS_CHANGE: 'เปลี่ยนสถานะ',
  LOGIN_SUCCESS: 'เข้าสู่ระบบสำเร็จ',
  LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ',
  CHANGE_PASSWORD: 'เปลี่ยนรหัสผ่าน',
  ROLE_PERMISSIONS_UPDATED: 'แก้ไขสิทธิ์ของบทบาท',
  CUSTOMER_CREATED: 'เพิ่มลูกค้า',
  CUSTOMER_UPDATED: 'แก้ไขลูกค้า',
  CUSTOMER_ARCHIVED: 'นำลูกค้าออกจากรายชื่อ',
  SUPPLIER_CREATED: 'เพิ่มผู้จำหน่าย',
  SUPPLIER_UPDATED: 'แก้ไขผู้จำหน่าย',
  WAREHOUSE_CREATED: 'เพิ่มคลัง',
  WAREHOUSE_UPDATED: 'แก้ไขคลัง',
  SET_PRICE: 'ตั้งราคาขาย',
  REGISTRATION_APPROVED: 'อนุมัติคำขอสมัคร',
  REGISTRATION_REJECTED: 'ปฏิเสธคำขอสมัคร',

  /* PHASE 12 — action ที่พบจริงใน audit_logs แต่ยังไม่เคยมีคำแปล
     ทุกคำยืนยันจากจุดที่ backend เขียน log ไม่ได้เดาความหมาย:
       SWITCH_COMPANY  auth.route.ts       สลับบริษัทที่ทำงานอยู่
       PRICE_UPDATE    item.route.ts       อัปเดตราคาซื้อ/ต้นทุนของสินค้า
       RECIPE_CREATED / RECIPE_UPDATED     recipe.route.ts (บันทึกเวอร์ชันใหม่)
       ITEM_CREATED    business.route.ts   สร้างสินค้าระหว่างรับของ
       ACTIVATE / DEACTIVATE  item.route.ts
       UPSERT          unit.route.ts       บันทึกอัตราแปลงหน่วย
       CONFIRM         business.route.ts   ยืนยันเอกสาร
       DOWNLOAD        business.route.ts   ดาวน์โหลดเอกสาร PDF
       USER_SELF_REGISTERED / PASSWORD_RESET_REQUESTED  auth.route.ts */
  SWITCH_COMPANY: 'สลับบริษัท',
  PRICE_UPDATE: 'อัปเดตราคาซื้อ',
  RECIPE_CREATED: 'สร้างสูตร',
  RECIPE_UPDATED: 'บันทึกเวอร์ชันสูตร',
  ITEM_CREATED: 'เพิ่มรายการสินค้า',
  ACTIVATE: 'เปิดใช้งาน',
  DEACTIVATE: 'ปิดใช้งาน',
  UPSERT: 'บันทึกอัตราแปลงหน่วย',
  CONFIRM: 'ยืนยันเอกสาร',
  DOWNLOAD: 'ดาวน์โหลดเอกสาร',
  USER_CREATED: 'เพิ่มผู้ใช้งาน',
  USER_SELF_REGISTERED: 'สมัครใช้งานด้วยตนเอง',
  PASSWORD_RESET_REQUESTED: 'ขอรีเซ็ตรหัสผ่าน',
};
/** action ที่ไม่รู้จักคืนค่าดิบ — ห้ามเดาความหมายของเหตุการณ์ด้านความปลอดภัย */
export const auditActionLabel = (action: string | null | undefined): string => {
  if (!action) return '—';
  return AUDIT_ACTION_LABEL[action] ?? action;
};

/** ชนิด entity ที่พบใน AuditLog → ชื่อไทย */
export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  SalesOrder: 'ออเดอร์',
  Customer: 'ลูกค้า',
  Supplier: 'ผู้จำหน่าย',
  Warehouse: 'คลัง',
  Role: 'บทบาท',
  User: 'ผู้ใช้งาน',
  Auth: 'การเข้าสู่ระบบ',
  SellingPrice: 'ราคาขาย',
  Item: 'สินค้า',
  /* PHASE 12 — entity ที่พบจริงใน audit_logs */
  Company: 'บริษัท',
  Recipe: 'สูตรอาหาร',
  Unit: 'หน่วยนับ',
  UnitConversion: 'อัตราแปลงหน่วย',
  CompanySettings: 'ตั้งค่าบริษัท',
  Category: 'หมวดหมู่',
  GoodsReceipt: 'ใบรับของ',
  GOODS_RECEIPT_SLIP: 'ใบรับของ (เอกสารพิมพ์)',
};
export const auditEntityLabel = (entity: string | null | undefined): string => {
  if (!entity) return '—';
  return AUDIT_ENTITY_LABEL[entity] ?? entity;
};

/* ============================================================
   USER STATUS
   ============================================================ */
export type UserStatusTone = 'success' | 'muted' | 'warning' | 'danger';
export interface UserStatusInfo { label: string; tone: UserStatusTone }

/**
 * สถานะผู้ใช้ประกอบจาก field จริง — schema ไม่มี enum status เดียว
 *   isActive           → ใช้งาน / ปิดใช้งาน
 *   registrationStatus → PENDING | APPROVED | REJECTED (String?)
 */
export function userStatus(user: { isActive: boolean; registrationStatus?: string | null }): UserStatusInfo {
  if (user.registrationStatus === 'PENDING') return { label: 'รออนุมัติ', tone: 'warning' };
  if (user.registrationStatus === 'REJECTED') return { label: 'ถูกปฏิเสธ', tone: 'danger' };
  return user.isActive
    ? { label: 'ใช้งานอยู่', tone: 'success' }
    : { label: 'ปิดใช้งาน', tone: 'muted' };
}

/** สถานะคำขอลงทะเบียน — ค่าที่ไม่รู้จักคืนค่าดิบ */
export const REGISTRATION_STATUS_LABEL: Record<string, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ปฏิเสธแล้ว',
};
export const registrationStatusLabel = (s: string | null | undefined): string => {
  if (!s) return '—';
  return REGISTRATION_STATUS_LABEL[s] ?? s;
};
export const registrationBadge = (s: string | null | undefined): string => {
  if (s === 'PENDING') return 'warning';
  if (s === 'APPROVED') return 'success';
  if (s === 'REJECTED') return 'danger';
  return 'muted';
};

/* ============================================================
   ส่วนต่างของสิทธิ์ (ใช้ในกล่องยืนยันก่อนบันทึก)
   ============================================================ */
export interface PermissionDiff { added: string[]; removed: string[]; unchanged: number }

export function permissionDiff(before: string[], after: string[]): PermissionDiff {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((c) => !b.has(c)).sort(),
    removed: before.filter((c) => !a.has(c)).sort(),
    unchanged: after.filter((c) => b.has(c)).length,
  };
}
export const hasPermissionChanges = (d: PermissionDiff): boolean => d.added.length > 0 || d.removed.length > 0;

/** ชื่อกลุ่มตามภาษาที่เลือก — ใช้เป็นหัวการ์ดของแต่ละโมดูล */
export const groupLabel = (group: string, locale: Locale): string =>
  GROUP_LABELS[group]?.[locale] ?? group;
