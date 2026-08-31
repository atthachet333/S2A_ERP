-- PHASE 25 — enrich the existing physical-waste rows with immutable production snapshots.
-- Existing rows remain valid and are classified as OTHER because their old free-form
-- reason cannot be mapped reliably to a controlled category.
ALTER TABLE `production_wastes`
  ADD COLUMN `unitCode` VARCHAR(191) NULL,
  ADD COLUMN `note` VARCHAR(1000) NULL,
  ADD COLUMN `unitCost` DECIMAL(18,4) NULL,
  ADD COLUMN `totalCost` DECIMAL(18,4) NULL,
  ADD COLUMN `recordedById` VARCHAR(191) NULL,
  ADD COLUMN `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

UPDATE `production_wastes`
SET `note` = NULLIF(TRIM(`reason`), ''), `reason` = 'OTHER';

ALTER TABLE `production_wastes`
  MODIFY `reason` VARCHAR(191) NOT NULL;
