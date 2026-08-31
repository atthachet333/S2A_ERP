CREATE TABLE `purchase_plans` (
  `id` VARCHAR(191) NOT NULL, `companyId` VARCHAR(191) NOT NULL, `planNo` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT', `planDate` DATETIME(3) NOT NULL, `warehouseId` VARCHAR(191) NOT NULL,
  `note` VARCHAR(1000) NULL, `version` INTEGER NOT NULL DEFAULT 1, `readyAt` DATETIME(3) NULL, `cancelledAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NULL, `updatedById` VARCHAR(191) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `purchase_plans_planNo_key`(`planNo`), INDEX `purchase_plans_companyId_status_planDate_idx`(`companyId`,`status`,`planDate`), INDEX `purchase_plans_warehouseId_idx`(`warehouseId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_plan_targets` (
  `id` VARCHAR(191) NOT NULL, `purchasePlanId` VARCHAR(191) NOT NULL, `recipeId` VARCHAR(191) NOT NULL, `recipeVersionId` VARCHAR(191) NOT NULL, `productId` VARCHAR(191) NOT NULL,
  `recipeCode` VARCHAR(191) NOT NULL, `recipeName` VARCHAR(191) NOT NULL, `recipeVersionNo` INTEGER NOT NULL, `productCode` VARCHAR(191) NOT NULL, `productName` VARCHAR(191) NOT NULL,
  `plannedQty` DECIMAL(18,4) NOT NULL, `yieldMode` VARCHAR(191) NOT NULL, `outputUnitCode` VARCHAR(191) NOT NULL,
  INDEX `purchase_plan_targets_purchasePlanId_idx`(`purchasePlanId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_plan_requirements` (
  `id` VARCHAR(191) NOT NULL, `purchasePlanId` VARCHAR(191) NOT NULL, `itemId` VARCHAR(191) NOT NULL, `itemCode` VARCHAR(191) NOT NULL, `itemName` VARCHAR(191) NOT NULL,
  `categoryId` VARCHAR(191) NULL, `categoryName` VARCHAR(191) NULL, `requiredQty` DECIMAL(18,4) NOT NULL, `onHandQty` DECIMAL(18,4) NOT NULL, `reservedQty` DECIMAL(18,4) NOT NULL,
  `availableQty` DECIMAL(18,4) NOT NULL, `shortageQty` DECIMAL(18,4) NOT NULL, `baseUnitCode` VARCHAR(191) NOT NULL, `purchaseUnitCode` VARCHAR(191) NULL,
  `purchaseToBaseFactor` DECIMAL(18,6) NULL, `purchaseQty` DECIMAL(18,4) NULL, `lastBaseUnitPrice` DECIMAL(18,4) NULL, `lastPurchasePrice` DECIMAL(18,4) NULL,
  `estimatedCost` DECIMAL(18,4) NULL, `latestSupplierId` VARCHAR(191) NULL, `latestSupplierName` VARCHAR(191) NULL, `selectedSupplierId` VARCHAR(191) NULL, `selectedSupplierName` VARCHAR(191) NULL, `sources` JSON NOT NULL,
  UNIQUE INDEX `purchase_plan_requirements_purchasePlanId_itemId_key`(`purchasePlanId`,`itemId`), INDEX `purchase_plan_requirements_purchasePlanId_shortageQty_idx`(`purchasePlanId`,`shortageQty`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `purchase_plans` ADD CONSTRAINT `purchase_plans_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchase_plan_targets` ADD CONSTRAINT `purchase_plan_targets_purchasePlanId_fkey` FOREIGN KEY (`purchasePlanId`) REFERENCES `purchase_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `purchase_plan_requirements` ADD CONSTRAINT `purchase_plan_requirements_purchasePlanId_fkey` FOREIGN KEY (`purchasePlanId`) REFERENCES `purchase_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
