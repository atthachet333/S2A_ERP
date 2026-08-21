-- Recipe Builder — Yield Mode (additive, nullable, no data rewrite)
-- ACTUAL = รู้ผลผลิตจริง (ต้องมี yieldUnitId) · BATCH = ยังไม่ทราบผลผลิต คิดเป็น 1 Batch
-- NULL = สูตรเดิมที่ยังไม่เลือกโหมด (ระบบจะถามผู้ใช้ ไม่เดาให้)
ALTER TABLE `recipe_versions` ADD COLUMN `yieldMode` VARCHAR(191) NULL;
