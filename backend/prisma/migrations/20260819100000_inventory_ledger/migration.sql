-- Inventory ledger + document numbering (ADDITIVE ONLY)
-- ไม่แก้/ไม่ลบข้อมูลเดิม: เพิ่มตารางใหม่ 2 ตาราง และเพิ่มค่า REVERSED ใน enum สถานะใบเบิก

-- 1) เพิ่มสถานะ REVERSED (ค่าเดิม DRAFT/ISSUED/CANCELLED คงอยู่ แถวเดิมไม่ถูกแตะ)
ALTER TABLE `stock_issues`
  MODIFY `status` ENUM('DRAFT','ISSUED','CANCELLED','REVERSED') NOT NULL DEFAULT 'DRAFT';

-- 2) บัญชีการเคลื่อนไหวสต็อก
CREATE TABLE `inventory_movements` (
  `id`           VARCHAR(191) NOT NULL,
  `companyId`    VARCHAR(191) NOT NULL,
  `warehouseId`  VARCHAR(191) NOT NULL,
  `itemId`       VARCHAR(191) NOT NULL,
  `movementType` ENUM('RECEIVING','ISSUE','ADJUSTMENT','REVERSAL') NOT NULL,
  `beforeQty`    DECIMAL(18,4) NOT NULL,
  `changeQty`    DECIMAL(18,4) NOT NULL,
  `afterQty`     DECIMAL(18,4) NOT NULL,
  `unit`         VARCHAR(191) NOT NULL,
  `sourceType`   VARCHAR(191) NOT NULL,
  `sourceId`     VARCHAR(191) NOT NULL,
  `referenceNo`  VARCHAR(191) NOT NULL,
  `reason`       VARCHAR(191) NULL,
  `note`         VARCHAR(191) NULL,
  `createdById`  VARCHAR(191) NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `inventory_movements_companyId_warehouseId_itemId_idx` (`companyId`,`warehouseId`,`itemId`),
  INDEX `inventory_movements_sourceType_sourceId_idx` (`sourceType`,`sourceId`),
  INDEX `inventory_movements_companyId_createdAt_idx` (`companyId`,`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `inventory_movements`
  ADD CONSTRAINT `inventory_movements_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_movements_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_movements_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) ตัวนับเลขเอกสาร (backend ออกเลขเท่านั้น)
CREATE TABLE `document_counters` (
  `id`        VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `docType`   VARCHAR(191) NOT NULL,
  `periodKey` VARCHAR(191) NOT NULL,
  `lastSeq`   INT NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `document_counters_companyId_docType_periodKey_key` (`companyId`,`docType`,`periodKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
