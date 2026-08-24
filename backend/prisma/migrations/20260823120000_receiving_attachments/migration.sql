-- Receiving attachments (ADDITIVE ONLY) — ไม่แก้ ไม่ลบ และไม่ย้ายข้อมูลเดิม
-- เพิ่มตารางใหม่หนึ่งตารางสำหรับเก็บ metadata ของไฟล์เอกสารต้นฉบับจากผู้ขาย
-- ตัวไฟล์อยู่บนดิสก์ ไม่เก็บ binary ลงฐานข้อมูล
-- ใบรับของเดิมทุกใบยังทำงานได้เหมือนเดิมทุกประการเมื่อไม่มีไฟล์แนบ

CREATE TABLE `goods_receipt_attachments` (
  `id`             VARCHAR(191) NOT NULL,
  `companyId`      VARCHAR(191) NOT NULL,
  `goodsReceiptId` VARCHAR(191) NOT NULL,
  `originalName`   VARCHAR(191) NOT NULL,
  `storedName`     VARCHAR(191) NOT NULL,
  `mimeType`       VARCHAR(191) NOT NULL,
  `sizeBytes`      INT NOT NULL,
  `uploadedAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `uploadedById`   VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `goods_receipt_attachments_storedName_key` (`storedName`),
  INDEX `goods_receipt_attachments_goodsReceiptId_idx` (`goodsReceiptId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `goods_receipt_attachments`
  ADD CONSTRAINT `goods_receipt_attachments_goodsReceiptId_fkey`
  FOREIGN KEY (`goodsReceiptId`) REFERENCES `goods_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
