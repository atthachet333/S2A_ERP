/**
 * PHASE 15B — รายชื่อตารางสำหรับล้างข้อมูลในฐานทดสอบ
 *
 * แยกไฟล์นี้ออกมาโดยเฉพาะเพราะ globalSetup ของ vitest รันนอก worker
 * ถ้าไฟล์ที่ globalSetup import ไปแตะ `vitest` เข้า จะพัง
 * ("Vitest failed to access its internal state") ไฟล์นี้จึงต้องไม่ import อะไรจาก vitest
 *
 * ลำดับ: ลูกก่อน พ่อแม่ทีหลัง — ตารางที่ยังไม่มีใน schema จะถูกข้ามอย่างเงียบ ๆ
 */
export const TEST_CLEANUP_TABLES = [
  'inventory_valuation_snapshot_lines', 'inventory_valuation_snapshots',
  'stock_ledgers',
  'stock_balances',
  'inventory_lots',
  'goods_receipt_extraction_lines', 'goods_receipt_extractions',
  'goods_receipt_items', 'goods_receipts',
  'purchase_order_items', 'purchase_orders',
  'purchase_plan_requirements', 'purchase_plan_targets', 'purchase_plans',
  'stock_issue_items', 'stock_issues',
  'stock_adjustment_items', 'stock_adjustments',
  'stock_transfer_items', 'stock_transfers',
  'sales_order_items', 'sales_orders',
  'production_materials', 'production_outputs', 'production_wastes', 'production_orders',
  'recipe_costs', 'recipe_ingredients', 'recipe_versions', 'recipes',
  'selling_prices', 'item_price_history',
  'items', 'categories',
  'unit_conversions', 'units',
  'warehouse_locations', 'warehouses',
  'suppliers', 'customers',
  'notifications', 'notification_preferences',
  'audit_logs', 'login_logs',
  'refresh_tokens', 'password_reset_tokens',
  'user_roles', 'role_permissions', 'permissions', 'roles',
  'company_memberships', 'users', 'companies',
  'document_counters', 'system_settings',
] as const;

/** ตารางที่ห้ามแตะแม้อยู่ในฐานข้อมูลทดสอบ */
export const NEVER_TOUCH = new Set(['_prisma_migrations']);
