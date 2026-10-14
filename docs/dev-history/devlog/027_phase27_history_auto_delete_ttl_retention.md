# Devlog 027 — History Auto-Delete TTL & Retention Settings

* **Date:** 2026-10-13
* **Feature/Task:** Configurable history auto-deletion with user-selectable retention window
* **Branch:** `feat/history-auto-delete-ttl`
* **Status:** Completed

---

## Objective

Add a user-facing retention setting (1 day / 1 week / 1 month / Never) for automatic cleanup of old translation jobs, images, and text records from IndexedDB. The prior codebase hard-coded a seven-day TTL with no UI control. This phase introduces configurable retention controls while enforcing strict safety invariants: active jobs must never be deleted, and storage read failures must never cause destructive fallback behavior.

---

## Workflow & Implementation Steps

1. **Type layer (`src/shared/types.ts`):** Added `HistoryRetentionPeriod` union type (`'1day' | '1week' | '1month' | 'never'`). Extended `PopupState` interface with `historyRetention` field. Set default to `'1week'` in `DEFAULT_POPUP_STATE` to preserve existing seven-day behavior.

2. **Database engine (`src/db.ts`):**
   - Exported `RETENTION_PERIOD_DAYS` as `Readonly<Record<HistoryRetentionPeriod, number | null>>` mapping presets to day counts (`null` for `'never'`).
   - Rewrote `cleanupOldJobs()` with fail-closed storage reads: if `chrome.storage.local.get()` throws or storage is unavailable, cleanup is skipped entirely rather than falling back to a destructive seven-day default.
   - Added active-job protection: the Dexie `where().below(cutoff)` query now filters with `.filter()` to exclude `'queued'`, `'downloading'`, and `'processing'` statuses. Selection and cascade deletion run inside a single `db.transaction('rw', ...)` to prevent a job from changing status between the eligibility check and deletion.
   - Numeric retention rejects non-positive, `NaN`, and `Infinity` values with an early return.
   - Removed `as any` cast on storage read result; the state variable is typed as `Record<string, unknown>` and narrowed with runtime checks.

3. **Background normalizer (`src/background/index.ts`):**
   - `normalizePopupState()` validates `historyRetention` against the four valid union members, falling back to `DEFAULT_POPUP_STATE.historyRetention` (not a hard-coded `'1week'` string) so changes to the default propagate from a single source of truth.
   - Updated the function's JSDoc to mention retention normalization.

4. **Settings UI (`src/popup/components/SettingsView.tsx`):**
   - Added `<select>` dropdown with `id="history-retention"` and `aria-describedby` for accessibility.
   - Replaced `|| '1week'` fallback with `?? DEFAULT_POPUP_STATE.historyRetention` for null-safe default sourcing.
   - Description text is reactive: when `'never'` is selected, it reads "Auto-delete is disabled. History is kept until you delete it manually." Otherwise it explains that only inactive (completed/error) jobs are affected.

5. **Tests:**
   - `src/db.test.ts` — 13 tests covering:
     - Seven-day default cleanup and cascade deletion (existing).
     - All four retention presets (`1day`, `1week`, `1month`, `never`).
     - Active-job immunity: `queued`, `downloading`, `processing` jobs survive even at 365 days old.
     - Completed and error jobs are eligible; processing is not.
     - Numeric rejection for `0`, `-1`, `NaN`, `Infinity`, `-Infinity`.
     - Fail-closed behavior on storage read failure.
     - Storage-sourced retention when no argument is provided.
     - Seven-day fallback on empty storage.
   - `src/background/normalizePopupState.test.ts` — 17 tests:
     - Parameterized invalid/missing `historyRetention` values (`undefined`, `null`, `'invalid'`, `''`, `0`, `7`, `'toString'`) all normalize to `'1week'`.
     - All four valid presets preserved without flagging `changed`.
     - Legacy state migration (missing `historyRetention` key) triggers `changed: true`.

---

## Roadblocks & Decisions

* **Fail-closed vs. fail-open on storage errors:** The original draft silently swallowed `catch {}` and fell through to the seven-day default. This is dangerous: if a user has set `'never'` and storage reads fail (locked DB, quota exceeded), the cleanup would destroy data the user explicitly chose to keep. Decision: any storage read failure or unavailability skips cleanup entirely and logs an error.

* **Active-job protection atomicity:** The original `where('timestamp').below(cutoff).primaryKeys()` query ran outside a transaction, creating a TOCTOU window where a job could transition from `'completed'` to `'processing'` between the eligibility check and `deleteJobs()`. Decision: wrap both selection (with `.filter()`) and cascade deletion in a single Dexie `'rw'` transaction covering `translationJobs`, `images`, and `textBlocks`.

* **Numeric day validation:** Passing `cleanupOldJobs(0)` would set cutoff to `Date.now()`, deleting every job regardless of age. `NaN` and `Infinity` produce nonsensical cutoffs. Decision: reject any non-positive or non-finite number with an early return.

* **Default source of truth:** The normalizer and UI both need the default retention value. Hard-coding `'1week'` in three places invites drift. Decision: both reference `DEFAULT_POPUP_STATE.historyRetention`.

---

## Key Takeaways

* Auto-delete of user data demands fail-closed design. When the system cannot determine the user's preference, it must preserve data, not destroy it.
* Dexie's `.filter()` on a `WhereClause` runs in-memory after the index scan. For the small number of old jobs this is acceptable; if the job table grows large, a compound index on `[status+timestamp]` would push the filter into the index.
* The `RETENTION_PERIOD_DAYS` map is marked `Readonly` to prevent accidental mutation at runtime.
