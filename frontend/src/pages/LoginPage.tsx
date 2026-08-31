import LoginExperience from '@/components/auth/LoginExperience';

/**
 * PHASE 38 — หน้าเข้าสู่ระบบ
 *
 * ไฟล์นี้เป็นเพียงจุดต่อของ route `/login` เข้ากับ LoginExperience
 * ซึ่งเป็นการใช้งานจริงเพียงชุดเดียวของหน้าเข้าสู่ระบบ
 *
 * เดิมไฟล์นี้ยัง export `LegacyLoginPage` ซึ่งเป็นฟอร์มเข้าสู่ระบบอีกชุดหนึ่ง
 * ที่เขียนซ้ำทั้งหมด (พร้อมข้อความไทยแบบ hardcode) แต่ไม่มีที่ไหนเรียกใช้เลย
 * ถูกลบออกในเฟสนี้ เพื่อไม่ให้เหลือหน้าเข้าสู่ระบบสองชุดในโค้ดเบส
 */
export default function LoginPage() {
  return <LoginExperience />;
}
