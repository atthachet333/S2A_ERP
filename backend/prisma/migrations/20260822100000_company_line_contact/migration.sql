-- PHASE 14 — ช่องทางติดต่อ LINE ของบริษัท
-- เพิ่มแบบ additive nullable เท่านั้น ไม่แตะคอลัมน์เดิมและไม่มีการลบข้อมูล
ALTER TABLE `companies` ADD COLUMN `lineId` VARCHAR(191) NULL;
