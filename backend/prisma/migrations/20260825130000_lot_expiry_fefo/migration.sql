-- PHASE 29 — prospective lot/expiry tracking. Historical lotless rows remain untouched.
-- Mandatory external preflight: scripts/phase29-preflight.mjs must report no duplicateLogicalBalances.

ALTER TABLE `inventory_lots`
  ADD COLUMN IF NOT EXISTS `companyId` VARCHAR(191) NOT NULL,
  MODIFY `warehouseId` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `receivedDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS `sourceType` VARCHAR(191) NOT NULL,
  ADD COLUMN IF NOT EXISTS `sourceReceiptId` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `sourceProductionId` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `note` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `createdById` VARCHAR(191) NULL,
  DROP INDEX IF EXISTS `inventory_lots_expiryDate_idx`,
  ADD UNIQUE INDEX IF NOT EXISTS `inventory_lots_companyId_itemId_lotNo_key` (`companyId`, `itemId`, `lotNo`),
  ADD INDEX IF NOT EXISTS `inventory_lots_companyId_expiryDate_idx` (`companyId`, `expiryDate`),
  ADD INDEX IF NOT EXISTS `inventory_lots_sourceReceiptId_idx` (`sourceReceiptId`),
  ADD INDEX IF NOT EXISTS `inventory_lots_sourceProductionId_idx` (`sourceProductionId`);

-- MariaDB allows duplicate UNIQUE tuples whenever any indexed member is NULL.
-- Trigger-maintained keys normalize NULL to an empty value without changing locationId/lotId truth.
-- Creating this UNIQUE index is also the database-level duplicate assertion: it fails before
-- any quantity can be changed if the preflight was skipped and duplicate logical rows exist.
ALTER TABLE `stock_balances`
  DROP INDEX `stock_balances_itemId_warehouseId_locationId_lotId_key`,
  ADD COLUMN `locationKey` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `lotKey` VARCHAR(191) NOT NULL DEFAULT '';

UPDATE `stock_balances`
   SET `locationKey` = COALESCE(`locationId`, ''), `lotKey` = COALESCE(`lotId`, '');

ALTER TABLE `stock_balances`
  ADD UNIQUE INDEX `stock_balances_logical_key` (`itemId`, `warehouseId`, `locationKey`, `lotKey`);

CREATE TRIGGER `stock_balances_normalize_insert`
BEFORE INSERT ON `stock_balances` FOR EACH ROW
SET NEW.`locationKey` = COALESCE(NEW.`locationId`, ''), NEW.`lotKey` = COALESCE(NEW.`lotId`, '');

CREATE TRIGGER `stock_balances_normalize_update`
BEFORE UPDATE ON `stock_balances` FOR EACH ROW
SET NEW.`locationKey` = COALESCE(NEW.`locationId`, ''), NEW.`lotKey` = COALESCE(NEW.`lotId`, '');

ALTER TABLE `goods_receipt_items`
  ADD COLUMN `inventoryLotId` VARCHAR(191) NULL,
  ADD INDEX `goods_receipt_items_inventoryLotId_idx` (`inventoryLotId`);

ALTER TABLE `production_orders`
  ADD COLUMN `manufactureDate` DATETIME(3) NULL;

ALTER TABLE `production_outputs`
  ADD COLUMN `inventoryLotId` VARCHAR(191) NULL,
  ADD COLUMN `manufactureDate` DATETIME(3) NULL,
  ADD INDEX `production_outputs_inventoryLotId_idx` (`inventoryLotId`);

ALTER TABLE `stock_transfer_items`
  ADD COLUMN `lotId` VARCHAR(191) NULL,
  ADD INDEX `stock_transfer_items_lotId_idx` (`lotId`);

ALTER TABLE `stock_adjustment_items`
  ADD COLUMN `lotId` VARCHAR(191) NULL,
  ADD INDEX `stock_adjustment_items_lotId_idx` (`lotId`);

CREATE TABLE `stock_issue_lot_allocations` (
  `id` VARCHAR(191) NOT NULL,
  `stockIssueItemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,4) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `issue_lot_alloc_unique` (`stockIssueItemId`, `lotId`),
  INDEX `stock_issue_lot_allocations_lotId_idx` (`lotId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `production_material_lot_allocations` (
  `id` VARCHAR(191) NOT NULL,
  `productionMaterialId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,4) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `prod_mat_lot_alloc_unique` (`productionMaterialId`, `lotId`),
  INDEX `production_material_lot_allocations_lotId_idx` (`lotId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `inventory_lots`
  ADD CONSTRAINT `inventory_lots_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_lots_sourceReceiptId_fkey` FOREIGN KEY (`sourceReceiptId`) REFERENCES `goods_receipts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_lots_sourceProductionId_fkey` FOREIGN KEY (`sourceProductionId`) REFERENCES `production_orders` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `stock_ledgers`
  ADD CONSTRAINT `stock_ledgers_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `inventory_lots` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `goods_receipt_items`
  ADD CONSTRAINT `goods_receipt_items_inventoryLotId_fkey` FOREIGN KEY (`inventoryLotId`) REFERENCES `inventory_lots` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `production_outputs`
  ADD CONSTRAINT `production_outputs_inventoryLotId_fkey` FOREIGN KEY (`inventoryLotId`) REFERENCES `inventory_lots` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `stock_transfer_items`
  ADD CONSTRAINT `stock_transfer_items_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `inventory_lots` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `stock_adjustment_items`
  ADD CONSTRAINT `stock_adjustment_items_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `inventory_lots` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `stock_issue_lot_allocations`
  ADD CONSTRAINT `stock_issue_lot_allocations_stockIssueItemId_fkey` FOREIGN KEY (`stockIssueItemId`) REFERENCES `stock_issue_items` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `stock_issue_lot_allocations_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `inventory_lots` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `production_material_lot_allocations`
  ADD CONSTRAINT `prod_mat_lot_alloc_material_fkey` FOREIGN KEY (`productionMaterialId`) REFERENCES `production_materials` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `prod_mat_lot_alloc_lot_fkey` FOREIGN KEY (`lotId`) REFERENCES `inventory_lots` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
