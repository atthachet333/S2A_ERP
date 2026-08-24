-- Stock transfer lifecycle (ADDITIVE ONLY) — ไม่แก้ ไม่ลบ และไม่ย้ายข้อมูลเดิม
-- เพิ่มค่า REVERSED เข้า enum สถานะ ค่าเดิมทั้งหมดคงอยู่ แถวที่มีอยู่ไม่ถูกแตะ
-- (รูปแบบเดียวกับ 20260819100000_inventory_ledger และ 20260819120000_receiving_lifecycle)

-- 1) ใบโอนย้ายระหว่างคลัง — ต้องกลับรายการได้เหมือนเอกสารสต็อกใบอื่น
ALTER TABLE `stock_transfers`
  MODIFY `status` ENUM('DRAFT','CONFIRMED','CANCELLED','REVERSED') NOT NULL DEFAULT 'DRAFT';

-- 2) ใบปรับปรุงสต็อก — โค้ดเขียน REVERSED มาตั้งแต่ต้นแต่ enum ไม่เคยมีค่านี้
--    ทำให้การกลับรายการล้มด้วย MySQL 1265 (Data truncated for column 'status')
ALTER TABLE `stock_adjustments`
  MODIFY `status` ENUM('DRAFT','CONFIRMED','CANCELLED','REVERSED') NOT NULL DEFAULT 'DRAFT';
