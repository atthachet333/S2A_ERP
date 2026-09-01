-- PHASE 35 — ประเภทการรับเข้า + หมายเหตุระดับบรรทัด
-- เพิ่มคอลัมน์อย่างเดียว (additive) ทั้งสองคอลัมน์เป็น NULL ได้
-- ไม่มีการลบ ไม่มีการเปลี่ยนชนิดข้อมูล ไม่มีการเขียนทับแถวเดิม
-- ใบรับของเดิมจะมีค่า NULL และถูกตีความเป็น "รับเข้าจากการซื้อ" ตอนแสดงผลเท่านั้น

ALTER TABLE `goods_receipts`
  ADD COLUMN `receiveReason` VARCHAR(191) NULL;

ALTER TABLE `goods_receipt_items`
  ADD COLUMN `note` TEXT NULL;
