CREATE TABLE `inventory_valuation_snapshots` (
  `id` VARCHAR(191) NOT NULL, `companyId` VARCHAR(191) NOT NULL, `snapshotAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `businessDate` DATE NOT NULL, `source` VARCHAR(191) NOT NULL, `knownInventoryValue` DECIMAL(20,4) NOT NULL,
  `knownBalanceCount` INTEGER NOT NULL, `unknownCostBalanceCount` INTEGER NOT NULL, `negativeStockCount` INTEGER NOT NULL,
  `valuationCompleteness` DECIMAL(9,4) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `createdById` VARCHAR(191) NULL,
  UNIQUE INDEX `valuation_snapshot_company_date`(`companyId`,`businessDate`), INDEX `inventory_valuation_snapshots_companyId_snapshotAt_idx`(`companyId`,`snapshotAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_valuation_snapshot_lines` (
  `id` VARCHAR(191) NOT NULL, `snapshotId` VARCHAR(191) NOT NULL, `itemId` VARCHAR(191) NOT NULL, `itemCode` VARCHAR(191) NOT NULL, `itemName` VARCHAR(191) NOT NULL,
  `warehouseId` VARCHAR(191) NOT NULL, `warehouseCode` VARCHAR(191) NOT NULL, `warehouseName` VARCHAR(191) NOT NULL, `lotId` VARCHAR(191) NULL, `lotNo` VARCHAR(191) NULL,
  `locationId` VARCHAR(191) NULL, `onHand` DECIMAL(18,4) NOT NULL, `reserved` DECIMAL(18,4) NOT NULL, `baseUnitId` VARCHAR(191) NOT NULL, `baseUnitCode` VARCHAR(191) NOT NULL,
  `recognizedUnitCost` DECIMAL(18,6) NULL, `costStatus` VARCHAR(191) NOT NULL, `estimatedValue` DECIMAL(20,4) NULL, `costSource` VARCHAR(191) NOT NULL,
  `itemType` VARCHAR(191) NOT NULL, `categoryId` VARCHAR(191) NULL, `categoryName` VARCHAR(191) NULL, `expiryDate` DATETIME(3) NULL, `expiryStatus` VARCHAR(191) NULL,
  `daysRemaining` INTEGER NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `valuation_snapshot_lines_snapshot_warehouse`(`snapshotId`,`warehouseId`), INDEX `valuation_snapshot_lines_snapshot_type`(`snapshotId`,`itemType`),
  INDEX `valuation_snapshot_lines_snapshot_item`(`snapshotId`,`itemId`), PRIMARY KEY (`id`),
  CONSTRAINT `valuation_snapshot_lines_snapshot_fk` FOREIGN KEY (`snapshotId`) REFERENCES `inventory_valuation_snapshots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
