-- Receiving lifecycle (ADDITIVE ONLY) — ไม่แก้/ไม่ลบข้อมูลเดิม
-- เพิ่มสถานะ REVERSED (ค่าเดิม DRAFT/CONFIRMED/CANCELLED คงอยู่ แถวเดิมไม่ถูกแตะ)
ALTER TABLE `goods_receipts`
  MODIFY `status` ENUM('DRAFT','CONFIRMED','CANCELLED','REVERSED') NOT NULL DEFAULT 'DRAFT';

-- เลขเอกสารผู้ขาย + เวลาเปลี่ยนสถานะ (nullable, ไม่ต้อง backfill)
ALTER TABLE `goods_receipts`
  ADD COLUMN `supplierDocNo` VARCHAR(191) NULL,
  ADD COLUMN `confirmedAt`   DATETIME(3) NULL,
  ADD COLUMN `reversedAt`    DATETIME(3) NULL;
