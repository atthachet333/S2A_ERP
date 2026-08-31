# Backend Authorization Matrix

Backend guards are authoritative. `SUPER_ADMIN` bypass is implemented centrally by the permission guard; other roles require current database grants. Company scope is derived from `req.user.companyId` after `requireCompany` and is never accepted from business request payloads.

| Module/routes | Methods | Required permission family | Company scope |
|---|---|---|---|
| Dashboard, notifications | GET/PATCH | DASHBOARD_VIEW, NOTIFICATION_VIEW | Authenticated company/user |
| Items, units, categories | GET/POST/PATCH/DELETE | INGREDIENT_*, PACKAGING_* | Item/category/company joins |
| Recipes, costing, pricing | GET/POST/PATCH/DELETE | RECIPE_*, COSTING_*, PRICING_* | Recipe/product company |
| Orders/customers | GET/POST/PATCH | ORDER_*, CUSTOMER_* | Direct companyId |
| Receiving and reversal | GET/POST/PATCH | RECEIVING_* | Direct companyId; posting transaction |
| Attachments/extraction | GET/POST/DELETE | RECEIVING_VIEW/CREATE/EDIT | Receipt plus attachment company |
| Issues | GET/POST/PATCH | STOCK_ISSUE_* | Direct companyId; posting transaction |
| Transfers | GET/POST/PATCH | STOCK_TRANSFER_* | Direct companyId; posting transaction |
| Adjustments | GET/POST | INVENTORY_VIEW/ADJUST | Warehouse/item company |
| Production | GET/POST/PATCH | PRODUCTION_* | Direct companyId; posting transaction |
| Purchase planning | GET/POST/PATCH | PURCHASE_PLAN_* | Direct companyId; no stock writes |
| Purchase orders | GET/POST/PATCH | PURCHASE_ORDER_* | Direct companyId; receipt linkage checked |
| Lots/valuation/snapshots | GET/POST/export | INVENTORY_VIEW or STOCK_VIEW | Warehouse/item/snapshot company |
| Supplier/production analytics | GET/export | RECEIVING_VIEW, PURCHASE_ORDER_VIEW, PRODUCTION_VIEW | Query companyId |
| Cost variance | GET/export | RECIPE_VIEW, COSTING_VIEW, PRODUCTION_VIEW | Query companyId |
| Profit simulator | POST calculate/export | RECIPE_VIEW + COSTING_VIEW + PRICING_VIEW | Recipe version company; no writes |
| Users/registrations | GET/POST/PATCH | USER_VIEW/USER_MANAGE | Membership scope; elevated policies |
| Role/permission administration | GET/PUT | ROLE_MANAGE/PERMISSION_MANAGE/USER_MANAGE | Admin company; SUPER_ADMIN role locked |
| Activity/security settings | GET/PATCH | SUPER_ADMIN/AUDIT_VIEW/SYSTEM_SETTINGS | Authenticated company |

Public exceptions are limited to health and defined authentication lifecycle endpoints. Integration tests cover pending-user sandboxing, disabled access, company isolation, and protected-route permission failures.
