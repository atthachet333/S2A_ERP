# Known Backlog

## Required before v1

- None identified by the initial production integrity audit. Final release remains conditional on full gates, two integration runs, and a validated restore drill.

## Optional after v1

- OCR for image-only supplier documents
- Richer lot selectors for adjustment and transfer
- Later-expiry FEFO warnings and compact multi-lot PDFs
- Scheduled daily inventory snapshots
- Cursor pagination for remaining bounded lists before very large data volumes

## UI/UX polish

- Authenticated browser review across all protected screens
- Remaining legacy English presentation labels
- Dedicated visual redesign after backend scope freeze

## Infrastructure maintenance

- Reconcile PM2 live/startup definitions without overwriting unrelated apps
- PM2 CLI/daemon upgrade in a maintenance window if versions diverge
- Periodic dependency review without force upgrades
