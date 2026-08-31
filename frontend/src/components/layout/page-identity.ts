import { MODULES, navGroupHeading, navGroupLabelForPath } from './nav-config';
import { navigationKeyByPath } from '@/i18n/i18n';

/**
 * PHASE 34 — ตัวตนของหน้า (กลุ่ม + ชื่อหน้า) ที่ "หัวเว็บ" เป็นเจ้าของ
 *
 * มติของเฟสนี้: App Header คือที่เดียวที่แสดง breadcrumb/โมดูล และชื่อหน้าปัจจุบัน
 * ส่วน PageHeader ให้เหลือเฉพาะคำอธิบายและปุ่มของหน้านั้น ๆ
 * ทั้งสองที่จึงต้องคิดชื่อหน้าจากฟังก์ชันเดียวกัน ไม่งั้นเช็คว่า "ซ้ำกันไหม" ไม่ตรง
 */

/** หน้าที่ไม่ได้อยู่ในเมนูหลัก แต่ยังต้องมีชื่อบนหัวเว็บ */
export const PAGE_TITLES: Record<string, { title: string; group: string }> = {
  '/profile': { title: 'โปรไฟล์ของฉัน', group: 'บัญชีผู้ใช้' },
  '/unauthorized': { title: 'ไม่มีสิทธิ์เข้าถึง', group: 'ระบบ' },
};

export interface PageIdentity {
  title: string;
  group: string;
}

export function resolvePageIdentity(pathname: string, nav: Record<string, string>): PageIdentity {
  const moduleMeta = MODULES[pathname];
  const fallback = PAGE_TITLES[pathname];
  const navigationKey = navigationKeyByPath[pathname as keyof typeof navigationKeyByPath];

  const title = navigationKey
    ? nav[navigationKey]
    : moduleMeta?.label ?? fallback?.title ?? 'S2 Accounting Consultant';

  const groupLabel = navGroupLabelForPath(pathname);
  const group = groupLabel
    ? navGroupHeading(groupLabel, nav)
    : moduleMeta?.group ?? fallback?.group ?? nav.overview;

  return { title, group };
}
