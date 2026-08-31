# S2A ERP v1 System Status

Release scope is frozen at Phases 1–32.5. Core modules are complete: identity/company scope, permission governance, catalog/units, recipes/costing/pricing, customer orders, receiving and attachments/extraction, stock issue/adjustment/transfer, production, purchase planning/orders, lot/expiry/FEFO, supplier and production analytics, inventory valuation/snapshots, cost variance, and the profit simulator.

Complete with optional backlog: OCR for scanned PDFs, richer multi-lot selection, automated snapshot scheduling, and broader pagination. Legacy `/items` and some older frontend scaffolds remain compatibility surfaces; they are not backend release blockers.

System invariants:

- Operational stock is posted only through atomic ledger operations.
- Production integration tests must use `s2a_erp_test`; production is `s2a_erp_main`.
- Unknown financial values are not equivalent to confirmed zero.
- Company scope comes from the authenticated server context, never request-company input.
- Numbered documents use `DocumentCounter`, not row counts.
- Historical recipe versions, production snapshots, receipt lines, PO lines, and valuation snapshots retain captured values.

Release audit command: `npm run audit:inventory`. A nonzero exit means a reconciliation mismatch and must be investigated, never auto-repaired.

Current release decision criteria: all gates green, two consecutive integration runs, production audit green, verified backup/restore drill, and healthy PM2 listeners.
