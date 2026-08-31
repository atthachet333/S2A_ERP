# Recommended Permission Matrix

This is guidance only. Production `role_permissions` remain admin-controlled and are never overwritten by seed or release scripts.

| Role | Recommended scope |
|---|---|
| SUPER_ADMIN | Code-level bypass; all permissions; security and role governance |
| ADMIN | All operational permissions; exclude user-management policy where required |
| MANAGER | All business modules and reports; exclude role/permission/security mutation |
| OPERATIONS | Receiving, issues, transfers, adjustments, inventory, production execution, document download |
| PRODUCTION | Recipe/cost read, inventory read, production create/confirm/reverse, production analytics |
| PURCHASING | Items, suppliers, purchase planning, PO lifecycle, receiving, supplier analytics |
| WAREHOUSE | Inventory/lots, receiving read, issue/transfer/adjustment execution; no costing or pricing mutation |
| SALES | Customers, orders, pricing read/edit as policy allows, recipe/cost read, reports |
| EXECUTIVE | Dashboard, reports, supplier/production/valuation/cost-variance/profit-simulator read only |
| VIEWER | Company/profile plus explicitly selected view permissions only |
| CHEF | Recipe and ingredient read/edit as policy allows, production view, no financial or permission administration |

New analytics reuse authoritative permissions: snapshots/lots require inventory or stock view; cost variance requires costing/recipe/production view as applicable; profit simulation requires recipe, costing, and pricing view together.
