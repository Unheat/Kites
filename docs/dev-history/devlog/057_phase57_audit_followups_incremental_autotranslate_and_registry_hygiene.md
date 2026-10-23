# Devlog 057 — Audit Follow-ups: Incremental Auto-Translate Scans, Registry Hygiene, and Background Hardening

**Date:** 2026-10-23
**Branch:** `fix/audit-followups` (off `perf/content-hover-performance-lag`)
**Scope:** Full-codebase audit follow-up fixing 5 of 7 findings (2 real-impact bugs, 3 cheap hardening items; 2 minor findings deliberately skipped).

## Context

After Phase 56 shipped fast-path hover detection, a broader audit sweep of content, background, offscreen, popup, and studio surfaces produced 7 findings. Verification against the UI layer downgraded the initially-flagged "first-run model download vs 60s job timeout" to defensive-only: the popup's engine and OCR dropdowns gate selection on `isDownloaded` (`EngineSelectionPanel.tsx:431`, `:700`), so jobs only ever load cached weights — the inline download path in `OcrCacheManager.getModelBuffer` is reachable only after a Chrome Cache API eviction. It was skipped along with the popup last-write-on-close edge.

## Changes

### 1. Incremental auto-translate mutation scans (`src/content/index.tsx`)

**Problem:** Auto-translate's MutationObserver watched `['src','srcset','style','href']` on `body` with `subtree: true`, and *every* mutation batch scheduled a debounced `observeImages()` that walked the entire document (`collectQueryRoots` TreeWalker + `querySelectorAll` sweep). On SPA feeds (X.com) this meant repeated O(document) scans during style storms, and because the debounce *reset* on every event, continuous animation starved the scan entirely — newly mounted images were never queued.

**Fix:**
- Mutation batches now collect pending work into two bounded sets: `pendingAddedRoots` (inserted elements, from `childList` mutations and non-style attribute targets) and `pendingStyleTargets` (style-mutated elements).
- The flush scans only what changed: `discoverAddedMediaTargets(root)` per inserted subtree (new exported helper in `mediaTargets.ts` — checks the node itself plus descendants, since `querySelectorAll` never matches the query root, so a bare `<img>` insert would otherwise be missed), and `createStyleRevealedTarget(element)` for style mutations (self-only check, never a subtree walk; explicitly rejects `<canvas>` so a style storm cannot trigger `toDataURL` GPU stalls).
- `MAX_MUTATION_BATCH_ROOTS = 48` caps each flush; excess entries are dropped for the next flush rather than falling back to a full scan.
- Scheduling is **non-resetting** (`if (flushTimeoutId !== null) return`), bounding worst-case latency to one debounce interval — storms can no longer postpone scans forever. The persistent-mode effect got the same non-resetting change for its full rescans (its state array design requires enumeration; only the starvation pattern was fixed).
- Shadow roots nested inside inserted subtrees are registered via `collectQueryRoots(root)` — light-DOM coverage comes from the body observer's `subtree: true`.
- Full `observeImages()` rescans now happen only on mount and window resize.

### 2. `mediaTargetRegistry` detached-entry pruning (`src/content/index.tsx`)

**Problem:** The URL→target `Map` grew on every hover/auto-queue/persistent registration with no deletion path, pinning every scrolled-past post's DOM subtree for the tab's lifetime.

**Fix:** Opportunistic sweep — when `registerMediaTarget` sees `size >= MAX_MEDIA_TARGET_REGISTRY_SIZE` (96), `pruneDetachedMediaTargets()` deletes every entry whose `sourceElement.isConnected` is false before inserting. No timers, no idle cost on non-reader sites; detached entries are dead weight anyway because `resolveTargetMedia` falls back to live document scans.

### 3. Chapter-scan effect dependency stabilization (`src/content/index.tsx`)

**Problem:** The recurring chapter-scan effect listed `chapterPages.length` in its dependency array, tearing down and recreating the 6s interval plus scroll listener every time a new page was detected (50-page chapter → 50 listener rebuilds).

**Fix:** `chapterPagesCountRef` (assigned during render, matching the existing `activeImgRef` house pattern) feeds the interval closure; the dep array drops the length.

### 4. Native blob→dataURL encoding for `GET_JOB_IMAGE` (`src/background/index.ts`, `src/shared/utils/blobDataUrl.ts`)

**Problem:** The handler built base64 via `binary += String.fromCharCode(bytes[i])` over megabyte blobs on the service-worker thread, and chapter-reader startup fires one request per history page in parallel.

**Fix:** New shared helper `blobToDataUrl(blob, fallbackMimeType)` using native `FileReader.readAsDataURL`, with the `image/png` fallback preserved for untyped blobs. Covered by 4 unit tests (typed encoding, default fallback, custom fallback, 512-byte round-trip).

### 5. DNR session-rule pre-clear in `fetchImageWithReferer` (`src/background/index.ts`)

**Problem:** `corsRuleCounter` restarts at 20000 on every service-worker respawn. A rule whose `finally` cleanup missed (SW died between add and remove) survives the restart, so the next same-ID `addRules` throws a duplicate-ID error — breaking every subsequent referer-fetch through CDNs until browser restart.

**Fix:** The `updateSessionRules` call now atomically removes the ID before adding (`{ removeRuleIds: [ruleId], addRules: [rule] }`), making registration idempotent across SW lifetimes.

## Verification

- `npm test`: **85 suites / 884 tests passed** (new: `blobDataUrl.test.ts` ×4, incremental-helper cases in `mediaTargets.test.ts` ×6).
- `npm run build`: production build succeeded (pre-existing chunk-size warning only).
- jsdom pseudo-element `getComputedStyle` notices during mediaTargets tests are a known environment quirk, unchanged.

## Deliberately Skipped

- **60s job timeout vs slow model init** — UI download gating makes the inline-download path reachable only after cache eviction; revisit only with user reports.
- **Popup last write on rapid close** — cosmetic; flush-on-`pagehide` if ever reported.

## Impact Analysis

- `discoverMediaTargets` signature/behavior unchanged (still used for mount/resize full scans); the new `discoverAddedMediaTargets`/`createStyleRevealedTarget` are additive exports.
- Auto-translate coverage preserved: inserted images (with or without wrappers), custom-selector overrides inside inserted subtrees, style-revealed backgrounds, shadow-DOM images, and `translatedSources` suppression of already-translated src swaps all retain dedicated paths, now verified by tests.
- `blobToDataUrl` output format is byte-compatible with the old manual encoding (`data:<mime>;base64,<payload>`), so `GET_JOB_IMAGE` consumers need no changes.
