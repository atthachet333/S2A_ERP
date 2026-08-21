import { useEffect } from 'react';

/**
 * PHASE 7B — ให้หน้าที่โหลด operations/lookups เองรีเฟรชเมื่อ master data เปลี่ยน
 *
 * หน้ารับของ/เบิกดึง lookups ผ่าน apiClient ตรง ๆ ไม่ผ่าน react-query
 * จึงไม่ได้ผลจาก invalidateQueries เมื่อมีการแก้ไข/ปิดใช้งานผู้จำหน่ายหรือคลัง
 * หน้า master จะยิง event นี้หลังบันทึกสำเร็จ
 */
export const MASTER_UPDATED_EVENT = 's2a:master-updated';

export function useMasterDataRefresh(reload: () => void | Promise<void>) {
  useEffect(() => {
    const handler = () => { void reload(); };
    window.addEventListener(MASTER_UPDATED_EVENT, handler);
    return () => window.removeEventListener(MASTER_UPDATED_EVENT, handler);
  }, [reload]);
}
