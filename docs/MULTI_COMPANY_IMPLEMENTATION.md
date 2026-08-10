# Multi-company implementation

## Database safety and backfill

Migration `20260810120000_multi_company_rbac_orders` is additive. It creates the company, membership, order, customer, stock issue, and notification tables and adds company keys to existing business tables. Before a new company key becomes required, all existing rows are assigned to the primary company `S2A-PRIMARY` (`s2a_primary_company`). No existing table, column, or row is removed.

Existing users receive a membership in that company using their existing role. The idempotent seed extends the same Role and Permission architecture with MANAGER, OPERATIONS, ORDER_COORDINATOR, CHEF, and COSTING_STAFF. Seed updates no existing passwords.

## Security model

The active company is a backend-validated JWT claim. `requireCompany` checks the membership again, while `requirePermission` enforces the membership role. Customer, order, demand, KPI, receiving, stock issue, and notification queries use this server-side context.

## Transaction boundaries

- Receiving: receipt + stock balance + ledger + price history + item last cost + audit.
- Stock issue: stock checks + issue + immediate deduction + ledger + order update + audit. An idempotency key prevents duplicate deductions.
- Order transition: state validation + audit + operations notifications.

## External configuration

LINE and email are disabled when configuration is absent. Variables are documented in `backend/.env.example`; credentials must never be committed. Binary PDF generation and provider transports are not enabled in this checkpoint.
