-- PHASE 23 — additive intermediate extraction results; existing receipts remain untouched.
CREATE TABLE `goods_receipt_extractions` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `goodsReceiptId` VARCHAR(191) NOT NULL,
  `attachmentId` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `quality` VARCHAR(191) NULL,
  `supplierName` VARCHAR(191) NULL,
  `supplierTaxId` VARCHAR(191) NULL,
  `supplierDocumentNo` VARCHAR(191) NULL,
  `documentDate` DATETIME(3) NULL,
  `currency` VARCHAR(191) NULL,
  `matchedSupplierId` VARCHAR(191) NULL,
  `subtotal` DECIMAL(18,4) NULL,
  `discount` DECIMAL(18,4) NULL,
  `vat` DECIMAL(18,4) NULL,
  `grandTotal` DECIMAL(18,4) NULL,
  `warnings` JSON NULL,
  `rawText` LONGTEXT NULL,
  `failureCode` VARCHAR(191) NULL,
  `failureMessage` VARCHAR(191) NULL,
  `sourceReceiptUpdatedAt` DATETIME(3) NOT NULL,
  `extractedAt` DATETIME(3) NULL,
  `appliedAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `goods_receipt_extractions_attachmentId_version_key`(`attachmentId`, `version`),
  INDEX `goods_receipt_extractions_goodsReceiptId_createdAt_idx`(`goodsReceiptId`, `createdAt`),
  INDEX `goods_receipt_extractions_companyId_status_idx`(`companyId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `goods_receipt_extraction_lines` (
  `id` VARCHAR(191) NOT NULL,
  `extractionId` VARCHAR(191) NOT NULL,
  `position` INTEGER NOT NULL,
  `rawDescription` VARCHAR(191) NOT NULL,
  `extractedItemCode` VARCHAR(191) NULL,
  `quantity` DECIMAL(18,4) NULL,
  `unitText` VARCHAR(191) NULL,
  `unitPrice` DECIMAL(18,4) NULL,
  `lineTotal` DECIMAL(18,4) NULL,
  `matchedItemId` VARCHAR(191) NULL,
  `matchedUnitId` VARCHAR(191) NULL,
  `matchStatus` VARCHAR(191) NOT NULL DEFAULT 'UNMATCHED',
  `warnings` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `goods_receipt_extraction_lines_extractionId_position_key`(`extractionId`, `position`),
  INDEX `goods_receipt_extraction_lines_matchedItemId_idx`(`matchedItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `goods_receipt_extractions` ADD CONSTRAINT `goods_receipt_extractions_goodsReceiptId_fkey` FOREIGN KEY (`goodsReceiptId`) REFERENCES `goods_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `goods_receipt_extractions` ADD CONSTRAINT `goods_receipt_extractions_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `goods_receipt_attachments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `goods_receipt_extractions` ADD CONSTRAINT `goods_receipt_extractions_matchedSupplierId_fkey` FOREIGN KEY (`matchedSupplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `goods_receipt_extraction_lines` ADD CONSTRAINT `goods_receipt_extraction_lines_extractionId_fkey` FOREIGN KEY (`extractionId`) REFERENCES `goods_receipt_extractions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `goods_receipt_extraction_lines` ADD CONSTRAINT `goods_receipt_extraction_lines_matchedItemId_fkey` FOREIGN KEY (`matchedItemId`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `goods_receipt_extraction_lines` ADD CONSTRAINT `goods_receipt_extraction_lines_matchedUnitId_fkey` FOREIGN KEY (`matchedUnitId`) REFERENCES `units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
