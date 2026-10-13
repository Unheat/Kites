# Phase 28: Current-Chapter ZIP Export

## 1. Metadata

- **Date:** 2026-10-13
- **Feature/Task:** Export completed translations from the current reader document as an ordered local ZIP.
- **Status:** Implemented; focused regression tests, scoped lint, and production build pass. Real-browser download verification remains manual.
- **Scope:** `src/content/chapterZip.ts`, its regression tests, ZIP integration in `src/content/index.tsx`, and `src/popup/components/PageExportControl.tsx` with its tests. This task does not modify the background queue protocol, glossary, settings, shared message types, or reading shortcuts.

## 2. Objective

Let readers save translated chapter pages together without downloading each image separately. Export must include completed pages that virtual readers have detached, preserve reading order independently of completion order, and avoid mixing earlier SPA chapters into the current document's archive.

## 3. Workflow and Implementation

1. **Capture request context before completion.** Manual and automatic overlay requests record the full document URL, including query and hash, first-request sequence, DOM child-index path, measured document Y, and available page elements before sending the translation request. Rejected requests and terminal failures clear pending context so retries capture the new chapter correctly.
2. **Cover native context-menu requests without changing background.** A capturing `contextmenu` listener remembers one unconfirmed candidate separately from actual overlay requests. This supports a right-click translation whose target detaches before completion, without letting an unrelated menu choice lock an old chapter onto a later overlay request.
3. **Archive completion before requiring live DOM.** The chapter registry owns one completed record per document URL and original image URL. Late results retain their queue-time document even after navigation. DOM replacement is skipped when the completed record belongs to another current URL. Unknown detached completions without captured context are not assigned speculatively to the new document.
4. **Share translated blobs between DOM and ZIP.** Completion creates one translated blob URL. The same record supplies DOM replacement and archive input; duplicate terminal events with the same job ID reuse the completed record. Replacing a translation revokes only the superseded version for that document/source pair. Earlier chapters retain their own blobs. Superseded job identities no longer retain revoked bytes or DOM elements.
5. **Expose safe current-document lookup.** `translatedRegistry.get(srcUrl)` returns the record for `window.location.href` only. `translatedRegistry.getRecords()` is the separate archive iterator; export filters it by exact current document URL. There are no synthetic source aliases that can overwrite a newer translation when returning to an earlier chapter.
6. **Snapshot and order before asynchronous export.** Export snapshots document URL, title, and eligible records before any fetch. Connected elements are remeasured only when their applied translated URL still matches the record, avoiding archived pages inheriting the position of recycled slots. Distinct slots follow DOM paths; repeated slots are interleaved by first-request occurrence and path, then Y and sequence as tie-breakers. Shadow-root sibling indices are preserved across host boundaries.
7. **Build a bounded local STORE archive.** JSZip receives already-compressed images sequentially as ArrayBuffers, with MIME-derived extensions and zero-padded, filesystem-safe names. Only local `blob:` or `data:image/` translations are fetched. A 30-second abort signal bounds each fetch. Declared size and streamed chunk totals are checked against the remaining 256 MiB archive budget, including conservative entry/end overhead; an overflow cancels the stream and aborts the whole archive. The final ZIP size is checked again. A classic ZIP entry-count guard prevents unsupported ZIP64-sized entry sets.
8. **Handle partial and empty outcomes explicitly.** Individual fetch, empty-image, or unsupported-MIME failures are reported and skipped. If some pages succeed, the download reports included and failed counts. If none succeed, no empty ZIP is downloaded. A size-cap failure does not download an arbitrary partial chapter.
9. **Keep popup state independent from popup lifetime.** Commands target content frame 0 only. Content owns export progress and downloads, so closing the popup does not own or cancel the archive. Polling discovers an existing busy export on reopening, uses a faster busy cadence, ignores out-of-order responses, and clears stale readiness when content is unreachable. The interval ref explicitly initializes to `undefined`, satisfying the current React typings.

## 4. Roadblocks and Decisions

### Audit corrections

The interrupted implementation retained pending metadata after queue rejection/failure, could replace a same-URL image after SPA chapter navigation, and stored earlier chapters under synthetic aliases that could later shadow a newer translation. The lifecycle was moved into a small testable registry in `chapterZip.ts`, and `index.tsx` now consumes it rather than duplicating blob registration during DOM replacement. Export title capture was moved before asynchronous work, and shadow-root sibling paths were corrected.

### Donor reference inspected

Read the actual Torii 2.22.6 donor at `scratches/reference/torii-extension-2.22.6/scripts/content.js`:

- `getDownloadableTargets()` around lines 23575–23664 establishes per-document slot-occurrence ordering, live-position refresh, and archived-page handling.
- `downloadAllImagesZip()` around lines 23895–23973 establishes sequential gathering, MIME-aware naming, partial-failure reporting, and refusal to save an empty archive.
- The streaming-writer rationale around lines 23976–24010 explains why JSZip input/output remains memory-backed and why `streamFiles` is not a bounded-heap guarantee.

Kites deliberately keeps the smaller JSZip implementation with a 256 MiB archive limit, rather than porting Torii's File System Access/ZIP64 writer. The limit bounds archive/input bytes, **not total renderer heap**: registry blobs, per-image conversion, JSZip inputs, and output can coexist. The archive is local; no DB write or upload is part of this feature.

### Known limits

- A single recycled canvas/image slot provides no observable page number. Within that slot, order is first request appearance, not guaranteed natural chapter numbering if the user jumps backward and forward.
- Native context-menu capture is best effort because the unchanged background protocol carries source URL and job ID, not a unique content request token. Multiple overlapping native requests or a full document reload cannot be perfectly correlated using this content-only scope.
- Frame 0 is the ZIP export target; translations exclusively inside child frames are not combined into a top-frame archive.
- Browser download initiation and real extension/SPA behavior still require manual browser QA. No browser shell automation was run.

## 5. Verification and Takeaways

- **Focused tests:** 45/45 pass across `chapterZip.test.ts` (20), `PageExportControl.test.tsx` (5), `contentUi.test.ts` (6), and `mediaTargets.test.ts` (14).
- **Regression coverage:** queue-time SPA context, detached completion, duplicate-job blob reuse, current-document lookup, retries after failure, cross-chapter same-source replacement without stale aliases, native context-menu capture, reused/alternating slots, recycled connected elements, shadow siblings, exact query/hash scoping, ZIP round-trip bytes and ordering, MIME extensions, partial/all-failed/empty results, cumulative unknown-length stream cancellation, title/list snapshots, concurrent export protection, popup frame targeting, stale readiness, and out-of-order status responses.
- **Scoped Oxlint:** 0 errors and 0 warnings in the ZIP helper, popup component, and their tests.
- **Whitespace:** `git diff --check` passes.
- **Production build:** `npm run build` passes, including `tsc -b` and Vite production bundling. Existing Vite chunk-size and websocket deprecation notices remain non-blocking.
- **Takeaway:** Queue context, archive context, and live DOM context are distinct lifetimes. Preserve queue identity for completed bytes; never infer archive membership solely from whichever page happens to be visible when completion arrives.
