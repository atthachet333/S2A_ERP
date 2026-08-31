import PasswordExperience from '@/components/auth/PasswordExperience';

/**
 * PHASE 38 — หน้าเปลี่ยนรหัสผ่าน (ใช้ทั้ง /change-password และ /account/change-password)
 *
 * ไฟล์นี้เป็นเพียงจุดต่อของ route เข้ากับ PasswordExperience
 * ซึ่งเป็นการใช้งานจริงเพียงชุดเดียว
 *
 * เดิมยัง export `LegacyChangePasswordPage` ซึ่งเป็นฟอร์มเปลี่ยนรหัสผ่านอีกชุดหนึ่ง
 * (ข้อความไทย hardcode ไม่ผ่าน i18n และไม่แสดงเงื่อนไขรหัสผ่าน) แต่ไม่มีที่ไหนเรียกใช้
 * ถูกลบพร้อมกับ LegacyLoginPage ในเฟสเดียวกัน
 */
export default function ChangePasswordPage() {
  return <PasswordExperience />;
}
