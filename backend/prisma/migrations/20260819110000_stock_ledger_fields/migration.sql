-- ใช้ ledger เดิม (stock_ledgers) เป็น source of truth เดียว — เพิ่มคอลัมน์แบบ additive/nullable
-- แถวเดิมไม่ถูกแก้ค่า และไม่ต้อง backfill
ALTER TABLE `stock_ledgers`
  ADD COLUMN `companyId` VARCHAR(191) NULL,
  ADD COLUMN `beforeQty` DECIMAL(18,4) NULL,
  ADD COLUMN `unit`      VARCHAR(191) NULL,
  ADD COLUMN `reason`    VARCHAR(191) NULL;

CREATE INDEX `stock_ledgers_companyId_createdAt_idx` ON `stock_ledgers`(`companyId`, `createdAt`);

-- เก็บกวาดตารางที่สร้างไว้ในรอบเดียวกันแต่ไม่ได้ใช้ (ยังว่าง 0 แถว, ไม่มีอะไรอ้างถึง)
-- เพื่อไม่ให้มี ledger สองชุดในระบบ
DROP TABLE IF EXISTS `inventory_movements`;
