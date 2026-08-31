-- Phase 24: additive historical snapshots and lifecycle metadata for production runs.
ALTER TABLE `production_orders`
  ADD COLUMN `standardCost` DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN `actualUnitCost` DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN `note` TEXT NULL,
  ADD COLUMN `confirmedAt` DATETIME(3) NULL,
  ADD COLUMN `confirmedById` VARCHAR(191) NULL,
  ADD COLUMN `reversedAt` DATETIME(3) NULL,
  ADD COLUMN `reversedById` VARCHAR(191) NULL,
  ADD COLUMN `reversalReason` TEXT NULL;

ALTER TABLE `production_materials`
  ADD COLUMN `unitCode` VARCHAR(191) NULL,
  ADD COLUMN `plannedUnitCost` DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN `plannedTotalCost` DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE `production_outputs`
  ADD COLUMN `unitCode` VARCHAR(191) NULL;

CREATE INDEX `production_orders_companyId_status_idx`
  ON `production_orders`(`companyId`, `status`);

CREATE INDEX `production_orders_recipeVersionId_idx`
  ON `production_orders`(`recipeVersionId`);
