---
name: Legacy file-storage removal
description: The old data/*.json + file:* kv backup machinery is fully removed; how persistence works now.
---
Persistence is per-workspace kv keys only (`<base>:t<tid>` singletons, `<prefix>t<tid>:<id>` collections). The legacy flat-file path is gone:
- Removed from db.js: migrateJsonFilesIfNeeded, readJsonFileOrDb, writeJsonFileOrDb (and their exports). db.js exports only hasDb/getPool/ensureSchema/kvGet/kvSet now.
- Removed from services/tenants/kv_scope.js: migrateFileKeyToTenant, cleanupLegacyFileKey.
- Removed from server.js: the one-time `_legacyFileBackups` cleanup IIFE and the migrateJsonFilesIfNeeded boot call. The separate diag-captures boot migration (data/diag-captures/ -> per-tenant keys) is still active — do not remove it.

**Why:** these were dead code kept only until the prod boot cleanup ran once. file:* rows are gone; data confirmed in :t2 (default tenant) keys.
**How to apply:** never reintroduce a `file:<name>` global read — it's a cross-workspace data leak. If you need new shared-ish data, use a per-tenant kv key via kv_scope helpers. The on-disk data/*.json files are now orphaned backups (nothing reads them); safe to delete.
