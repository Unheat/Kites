# Reader, Studio, and AI Runtime Improvement Plan

Date: 2026-10-16
Status: Proposed implementation plan; not a completion report.

## 1. Outcome and scope

Make reader actions predictable, fix Studio gestures and AI initialization feedback, and reduce redundant work without changing translation, OCR, inpainting, or typesetting quality.

The user-approved boundary is important: **keep exact source-page URL scoping for SPA navigation.** Improve how users choose and understand images; do not remove the underlying protection against mixing results from different pages.

This plan covers:

1. Studio click, double-click, drag, resize, and undo correctness.
2. Initialization feedback whenever a real model initialization occurs, including after changing tiers.
3. Seven optimization tracks: tensor cleanup, image transport overhead, frame-coalesced Studio work, canvas reuse, image decode reuse, targeted DOM scanning, and image-resource memory management.
4. Selection-first Reader/ZIP UX centered on the existing Stack panel.
5. Related defects that would otherwise invalidate that UX: stale selections, selected readers overwritten by scans, History image format ambiguity, popup-owned image URLs, and reader export ignoring its displayed collection.
6. Tests, measurement, documentation, and staged delivery.

No production deployment, model changes, translation phrase cache, or speculative GPU tuning is included.

## 2. Corrections to the earlier discussion

These corrections supersede earlier audit statements and implementation suggestions.

### 2.1 Chrome message transport

Chrome extension runtime/tab messaging uses JSON serialization, not the structured-clone behavior of window messaging or some other browsers. Sending an `ArrayBuffer` through the existing message route is **not** a drop-in binary optimization. Switching from messages to runtime ports does not change this constraint.

Keep the compatible data-URL transport until a separately tested replacement proves equivalent. Preserve content-created, same-origin Blob URLs and the existing SPA image-replacement protections.

### 2.2 Tensor cleanup is not a measured GPU leak

Neural bubble inference lacks per-call tensor disposal. The installed OCR dependency also leaves inference output tensors undisposed. Inpainting already has explicit input/output cleanup; WebLLM already unloads its runtime when destroyed.

However, ONNX WebGPU execution does not mean every tensor is GPU-resident. Current default outputs are CPU-resident unless configured otherwise. Missing disposal is a cleanup defect, not proof of a particular amount of leaked VRAM or the cause of all device-loss crashes.

Do not repeat the earlier claims of 15–30 MB leaked per page or that OCR/WebLLM have been proven entirely leak-free. Neither was established by profiling.

### 2.3 Performance figures were estimates, not benchmarks

The earlier frame-rate, millisecond, and RAM savings were not measured. This plan establishes baselines and compares before/after behavior. It does not promise a specific speedup.

### 2.4 Page scope is not viewport scope

The existing registry can retain completed translated pages after their DOM elements disappear. URL filtering selects records belonging to the current document URL, not only images currently visible on screen.

The reader scanner finds eligible images in the document. It is not semantic chapter recognition and cannot guarantee that a site's entire lazy-loaded chapter has been discovered.

### 2.5 Chapter/image count is not a RAM cap

Five chapters or 150 images could be tiny or enormous. Neither guarantees a fixed memory ceiling. Encoded image bytes, decoded pixels, canvases, model allocations, and ZIP assembly are separate contributors.

Blob URL revocation removes a resource reference; it does not guarantee an immediate equivalent drop in browser RAM.

### 2.6 Studio audit false positives

Calling a React state setter does not synchronously change the local state variable in the current event handler. Therefore, calling `setActiveHandle(null)` before inspecting `activeHandle` does not by itself prove undo labels are always incorrect.

Native `dblclick` timing is browser/platform-dependent and occurs after click completion, not at a guaranteed interval during a held second pointer-down. The verified conflict is the earlier manual second-pointer-down edit activation plus competing native double-click handling.

## 3. Starting state and unfinished changes

Earlier in this conversation, application code was changed prematurely while the user was still asking questions. Those edits are not an approved or completed implementation of this plan.

At planning inspection, the working tree contains unstaged edits in:

- `src/studio/canvas/StudioCanvas.tsx`
- `src/studio/canvas/CanvasFurniture.ts`

The partial changes add gesture refs, a movement threshold, handle-radius changes, canvas reuse, and RAF store updates. They remain incomplete:

- Typesetting still runs before RAF, so expensive computation is not actually coalesced.
- A scheduled update can land after pointer-up has recorded undo.
- New refs are not consistently reset at gesture termination.
- Deferred click classification was not completed.
- Cancellation, lost capture, and unmount cleanup are incomplete.
- The movement threshold is in image coordinates rather than CSS screen pixels.
- Hit regions can diverge from the visible handles.

Implementation must begin by inspecting the current diff, preserving unrelated work, and completing or replacing only these draft changes. Do not treat them as a verified baseline. Do not blindly reset the files.

The earlier 750-test pass occurred before these edits; it does not validate the current draft.

## 4. Product behavior: one explicit collection

### 4.1 User mental model

> Find images, see their thumbnails, select the images you want, then translate, read, or download those images.

URL scope remains an internal default for current-page discovery and completed results. Users should not have to understand a registry or infer hidden collection membership from a button count.

Use three clear concepts:

- **Current Page:** discovered images associated with the active document, including retained translated pages from that document where their original DOM elements have disappeared.
- **History:** saved jobs across pages and sessions, loaded explicitly from extension storage.
- **Selection:** the exact ordered set the user chose from either source.

A reader opens a collection. A reader's download action operates on that collection, never a different global collection.

### 4.2 Source-page isolation

Keep source URL captured at queue time, not completion time. Preserve the existing exact query/hash behavior initially; do not introduce URL normalization without separate tests and a product reason.

Example:

1. Translation is queued on URL A.
2. The site navigates to URL B without reloading the extension content script.
3. A's translation completes.
4. It remains associated with A and cannot appear in B's default page collection or update an unrelated reader item that happens to share its image URL.

Explicit History selection may intentionally combine different source URLs. This is not a violation: the user selected those records, and the UI shows their provenance.

## 5. Reader and export UX redesign

### 5.1 Home tab

Remove blind `Open Chapter Reader` and `Download Chapter ZIP` actions from Home completely. Do not add redundant full-width tab-switch buttons (e.g. `Manage & Export Pages`) to Home, as the top navbar already provides clean, direct tab navigation icons (`Home`, `Stack`, `Settings`).

Home tab retains only primary direct controls:
- Source and Target language dropdowns
- Auto-Translate toggle
- Crop & Translate Area button
- Open Edit Studio button

### 5.2 Stack panel (Selection Hub & Permanent Footer)

Retain `Current Page` (or `Current Chapter`) and `History` tabs with thumbnails and per-image selection states.

The bottom Action Footer must be **permanent and spatially stable**—buttons must never disappear or shift layout when 0 images are checked:

```text
┌──────────────────────────────────────────────────┐
│  Kites                    ⏻   [Home] [Stack] [⚙] │
├──────────────────────────────────────────────────┤
│  [ Current Chapter (14) ]   [ History (42) ]     │
├──────────────────────────────────────────────────┤
│  ☑ 14 / 14 pages          ↺       [⚡ Fast Scan]  │
├──────────────────────────────────────────────────┤
│  [ #1 PAGE  ☑ ]         [ #2 PAGE  ☑ ]           │
│  [   Thumbnail   ]         [   Thumbnail   ]     │
│  [ #3 PAGE  ☑ ]         [ #4 PAGE  ☑ ]           │
│  [   Thumbnail   ]         [   Thumbnail   ]     │
├──────────────────────────────────────────────────┤
│  ── Action Footer (Permanent · Never Shifts)     │
│                                                  │
│  [       ⚡ Translate 14 Selected Pages         ] │  <-- Primary action (Pink)
│                                                  │
│  [   📖 Open Reader   ]    [   📦 Export ZIP (0)   ] │  <-- Secondary tools (50/50)
└──────────────────────────────────────────────────┘
```

Rules:
- **`Translate X Pages` (Primary Button)**:
  - Exclusively driven by checkboxes.
  - When $X > 0$: active pink, e.g. `Translate 14 Selected Pages`.
  - When $X = 0$: disabled gray, `Select Pages to Translate`.
  - When all selected are done: `All Selected Pages Done ✓`.
- **`Open Reader` (Secondary Left)**:
  - Follows selection abstraction cleanly: Reader is a dumb viewer that displays whatever page items it receives.
  - If checkboxes are selected: opens Reader displaying that specific selected subset (works across both Current Chapter and History items).
  - If 0 checkboxes are selected: opens Reader displaying all pages in the current chapter view.
  - Never disabled, never hidden.
- **`Export ZIP (N)` (Secondary Right)**:
  - Exports translated pages belonging to the active chapter scope.
  - $N$ displays the number of translated pages ready to download.
  - If $N = 0$: disabled (opacity 50%) with tooltip: *"No translated pages in this chapter yet"*.
  - Label is short and un-truncated: `Export ZIP (N)`.
  - Never hidden.

### 5.3 Unified Canonical Chapter Scope Resolver (`getChapterScopeId`)

To prevent duplicate logic and resolve the difference between webtoons and paginated manga sites (e.g. nhentai, E-Hentai), define a single shared function `getChapterScopeId(rawUrl: string)` in `src/shared/siteRules.ts`:

1. **Paginated Galleries** (`/g/\d+/\d+/`):
   - `https://nhentai.net/g/677759/6/` $\to$ `https://nhentai.net/g/677759/`
   - Strips trailing page index so all page flips (1 $\to$ 2 $\to$ 3...) share the exact same gallery root ID in memory.
2. **Generic Paginated Patterns** (`/(?:p|page|ch-?\d+)/\d+/`):
   - Strips trailing numeric page segments.
3. **Webtoons & SPAs**:
   - Strips hashes and query pagination parameters (`?page=6`, `#page6`).

Consumed by all three consumer points:
- **ZIP Exporter (`chapterZip.ts`)**: Collects all translated pages sharing `getChapterScopeId(currentUrl)`. On nhentai, exporting from page 7 now includes pages 1–6!
- **Selection Panel (`BatchScanPanel.tsx`)**: Displays and accumulates discovered/translated pages under `getChapterScopeId(currentUrl)`.
- **Reader Modal (`ChapterReaderModal.tsx`)**: Resolves and streams pages for the active chapter scope.
- New discoveries do not automatically reselect items the user deselected.
- `Select all` applies to the visible source tab. Cross-source selections remain visible through a compact selection summary/preview.
- When selection contains History and Current Page entries, show the source counts and allow inspection of the complete selection before acting.
- Selection stores stable identities, not stale copies of whole image records. Action counts resolve fresh status and assets.
- Preserve deterministic displayed order; deselecting and reselecting a page must not accidentally move it to the end. For mixed sources, use a documented stable source/group order and show the resulting order in the selection preview.
- A translated page available through both sources must not be duplicated accidentally. Deduplicate only when job/result identity proves they are the same version; source URL alone is insufficient.

### 5.3 Floating reader pill

Keep it as a convenience shortcut for all discovered images belonging to the current page, not a second selection system.

Label: `Read page · 24 images`.

- It opens immediately even when nothing is translated.
- Its count means discovered images, never sometimes translated count and sometimes total count.
- Opening from the pill uses the same collection builder as Stack's Current Page source.
- It does not overwrite the Stack selection.
- It does not imply every image on a virtualized/lazy-loading site is already discovered.
- The count includes retained completed images previously discovered for this document even when detached, with duplicates removed. Count and opened collection must agree; it is not a viewport-only count.

### 5.4 Reader header

State what was opened:

```text
Selected images · 12                  [Close]
8 translated · 4 original

[Original / Translated]  [Translate remaining 4]  [Download ZIP…]
```

For a pill-launched reader, title becomes `Current page · 24 images`.

- A selected collection has fixed membership/order until explicitly changed by the user.
- An all-current-page reader may accept newly discovered images from the same source scope; its count updates visibly.
- Translation completion changes an existing entry's image/status, not collection membership.
- The Original/Translated toggle affects display only. ZIP variant is stated separately; it must not silently change based on the viewing toggle.
- Pending and failed pages remain represented in the collection instead of vanishing. In Translated view, show the original as a clearly labeled fallback when available; otherwise show an unavailable placeholder. Unknown legacy History translation formats show an explicit legacy-format warning, not a supposedly translated image. In Original view, a missing original produces a placeholder, never a mislabeled translated substitute.
- An open reader stays bound to the source scope/selection captured at launch across SPA navigation. Show `Opened from a previous page` when appropriate, with an explicit action to open the new page's collection; do not silently replace the reader.
- On navigation, Stack's Current Page catalog changes to the new URL, but explicit selections remain identifiable by their captured source. Label previous-page selections in the summary/preview and keep Clear selection available. Never relabel old selections as belonging to the new page.

### 5.5 ZIP selection and preview

Move the main ZIP action into Stack and retain the reader's ZIP action. Both invoke the same export request model and feedback UI.

The first version exports **translated images**, preserving existing export semantics. Adding original-image or mixed-variant archives is not required by this plan.

Clicking `Download ZIP…` shows a compact preview:

```text
Download translated images

Collection: 12 selected images
Ready: 8
Not translated or unavailable: 4

[ordered thumbnails/list]

[Cancel] [Download 8 translated images]
4 images will not be included.
```

Rules:

- When every requested item is ready, confirmation says `Download 12 translated images`.
- When some are not ready, omission requires explicit confirmation. Do not silently skip those pages or substitute other completed pages.
- With zero ready items, no active download confirmation is offered. Explain `Translate selected images first` for untranslated items; report unavailable/deleted or legacy-format assets separately with their actual reason.
- Reader export uses exactly the reader's collection and order.
- Stack export uses exactly the selected collection and order.
- History export resolves the selected job versions, not whatever currently matches a source URL.
- Pin ready asset versions and snapshot collection/order when opening the export preview; release the pins on cancel or completion. Newly completed translations do not silently change that preview; offer explicit refresh. On confirmation, validate pinned asset availability and capture filename context. If the included set changed or an asset became unavailable, update the preview and require reconfirmation. Navigation or new translations must not change an in-progress archive.
- Keep existing size checks and all-or-nothing behavior for archive budget overflow.
- Unexpected per-image fetch failures may produce a partial archive, preserving existing exporter behavior. Disclose this in the confirmation (`If an image cannot be read, available images will download and failures will be listed`). Show explicit partial-success/error feedback listing failures, and never claim a complete archive. If none can be read, download nothing.

Feedback must be visible, not only a tooltip or console log:

- `Preparing 3 of 8 images…`
- `Building ZIP… 60%`
- `Download started: 8 images`
- `Download started: 6 of 8; 2 images could not be loaded` with details/retry path.
- `ZIP exceeds the export limit. Select fewer images.`

Say **Download started**, not **Downloaded successfully**: triggering a browser download does not prove disk-write completion.

A genuinely disabled button cannot also be expected to receive clicks and show a toast. Use nearby explanatory text and an accessible description instead of contradictory disabled-but-clickable behavior.

### 5.6 Discovery limitations

Rename or explain Fast Scan as an action that scrolls the page to discover lazy-loaded images. Current implementation scans after scrolling back; it does not preserve all intermediate virtualized pages.

For this redesign, accumulate eligible discoveries during the scan, deduplicate them, retain their order/source scope, restore the previous scroll position, and report the discovered count. Make cancellation and zero-results feedback clear. Do not claim to identify semantic chapter boundaries or guarantee a complete chapter when the site never exposes all images.

## 6. Collection and asset implementation boundaries

Use a small shared typed collection contract consumed by popup, content reader, and exporter. Do not build a second database framework or duplicate catalogs.

Each entry needs enough identity to distinguish:

- Current-page source document, original source URL, and translation job/result version.
- History job/image identity and saved asset format.
- Stable display order.
- Current readiness and error state.

Keep these separate:

1. Discovery catalog.
2. Selected identities.
3. Active reader collection.
4. Asset resolution/ownership.
5. Export snapshot.

### 6.1 Reader scope fixes

In `src/content/index.tsx`, prevent the reader-open scan effect from replacing a supplied selection or History collection. Only refresh/expand an explicitly all-current-page collection.

Route live completion by job/request identity plus source scope. Matching only an original image URL is insufficient when a URL is reused across chapters or History versions.

Popup-initiated current-page batch jobs must register queue-time context before dispatch, using the existing content boundary or equivalent explicit context carried through the request. Preserve rejection cleanup and detached-page completion handling.

### 6.2 History assets must mean what the UI claims

Current pipeline writes a clean background without translated lettering into `translatedImageBlob`, with text blocks stored separately. Studio Save can write a baked composite into that same field. A field name alone cannot tell whether lettering is present.

Before enabling History Reader/ZIP parity:

1. Add explicit, backward-compatible asset-format metadata for new saves, distinguishing clean backgrounds from baked composites and identifying saved presentation mode where needed.
2. Preserve the clean editable background separately from baked exports in future Studio saves; do not overwrite it with a composite while retaining blocks that will be drawn again.
3. Render known clean backgrounds plus saved blocks using the canonical renderer exactly once.
4. Use known baked translated assets directly, without rendering lettering twice.
5. Treat older ambiguous rows as unknown unless provenance can be established reliably. Show an explicit unavailable/legacy-format explanation; do not silently mislabel a blank background as translated or double-render text.
6. Avoid destructive automatic migration of ambiguous images. Retain original assets and stored text blocks.

Resolve History images through a longer-lived extension context using stable references. Do not send popup-owned Blob URLs to a reader that must outlive the popup. The receiving context owns the display URLs it creates and releases them when its consumers finish.

History availability is separate from the current tab's content-script availability. If the current page cannot host a reader, show a clear limitation rather than reporting success; a new standalone reader host is outside the initial scope.

## 7. Bug fix A: Studio gestures

### 7.1 Required behavior

- First press-and-drag moves the box.
- Click, pause, press-and-drag moves the box.
- Quick second press followed by drag also moves the box.
- Two stationary clicks enter editing.
- Dragging never accidentally becomes text editing on release.
- Resize still fits text live through the existing typesetting function.
- Font-size, wrapping, rotation, and locked-object semantics remain distinct.

### 7.2 Implementation

Use one coherent gesture record containing pointer ID, object ID, handle, initial transform, starting client coordinates, latest coordinates/modifiers, movement classification, and pending frame work.

- On pointer-down, identify the target and arm a potential transform; do not enter text editing before learning whether the gesture is a drag.
- Use a named small movement threshold in CSS pixels, initially 3 px, independent of zoom. Convert coordinates to image space for geometry only.
- Use one click classification mechanism, not manual pointer-down double-click logic plus an independent unguarded native handler.
- Stationary completed clicks can produce edit activation. Movement invalidates the click sequence. Respect pointer identity and ignore unrelated pointers.
- Preserve textarea selection/editing and focus-preserving toolbar behavior.
- On pointer-up, synchronously apply the latest pending transform before recording undo/persistence. Record one transaction only when state actually changed.
- On cancellation/lost capture, roll back the text transform to the gesture snapshot and record no successful transform. Ensure this cannot trigger inpaint/OCR brush submission.
- Clear all refs and pending callbacks on every terminal path; cancel pending work on unmount/page switch.
- Do not indiscriminately rewrite brush handling while fixing text gestures. Give brush cancellation deliberate, separately tested behavior.

### 7.3 Handle geometry

Reserve a usable body hit area on small boxes while keeping visible handles and hit targets consistent. Share geometry between drawing and hit testing rather than shrinking only hit radii.

Test small, narrow, rotated, overlapping, and highly zoomed boxes. Do not assert that the earlier radius formula guarantees a usable center for every box size.

### 7.4 Acceptance

Reproduce all three user click/drag sequences manually and in controlled gesture tests. Test final pointer-up before RAF, undo/redo final coordinates, cancellation, lost capture, locked objects, zoom levels, page switching, and no mutation after unmount.

### 7.5 Studio Text Line Cache Normalization (`TextRenderer.ts:98-104`)

- **Problem**: In `TextRenderer.wrapTextLines`, cached `existingLines` is compared to `text` by joining `existingLines` with spaces: `existingLines.join(' ').replace(/\s+/g, ' ').trim() === text.replace(/\s+/g, ' ').trim()`.
- **Root Cause**: In CJK text (Japanese manga, Chinese manhua), words contain no inter-word spaces. Joining `existingLines` with spaces produces artificial spaces that never match the raw CJK `text`.
- **Consequence**: The cache fails on every frame, falling through to greedy whitespace splitting (`text.split(/\s+/)`), which cannot break unspaced CJK words and dumps all text onto one overflowing line, throwing away the engine's balanced typeset lines.
- **Fix**: Compare both with and without whitespace:
  ```ts
  if (
    normalizedExisting === normalizedCurrent ||
    existingLines.join('').replace(/\s+/g, '') === text.replace(/\s+/g, '')
  ) {
    return existingLines;
  }
  ```

### 7.6 Studio OCR Engine Font Size & Orientation Preservation

- **Problem**: When running Studio OCR on a cropped area, `offscreenStudioBridge.ts:137` hardcodes `fontSize: Math.max(12, Math.min(32, Math.round(t.height * 0.4)))` and forces `isVertical: false`.
- **Root Cause**: `runStudioOcr` in `StudioOcr.ts` dropped `result.fontSizes` and `result.directions` from OCR result mapping, and `offscreenStudioBridge.ts` overwrote font size with `height * 0.4`.
- **Consequence**: Tall dialogue boxes clamp to 32px, small single-line bubbles clamp to 12-16px, and vertical text loses its reading orientation.
- **Fix**:
  1. Forward `fontSize` from `result.fontSizes` and `isVertical` from `result.directions` in `StudioOcr.ts`.
  2. In `offscreenStudioBridge.ts`, preserve `(t as any).fontSize` and `(t as any).isVertical`, falling back to `height * 0.4` only when engine font size is absent.

## 8. Bug fix B: AI initialization feedback

### 8.1 Meaning

Show feedback for **real runtime/model initialization**, not just extension startup and not every inference using an already-ready model.

Examples:

- First OCR use: `Preparing OCR…`
- Switching to another uncached runtime: `Preparing inpainting…`
- Returning to an unloaded model: preparation appears again.
- Reusing a ready engine: normal translation progress without a false initialization flash.

Remove `first use this session`, which incorrectly describes later model switches.

### 8.2 Lifecycle design

Instrument the actual initialization ownership boundary. A manager wrapper is insufficient when an engine's public `init()` is a no-op and actual session creation happens later inside detection, as with the neural bubble adapter.

- Emit start before real asynchronous initialization and settle in `finally` on success or failure.
- Include request/job identity, stage, engine identity, and an initialization operation identity sufficient to pair starts/ends.
- Reuse existing lifecycle abstractions where possible; avoid another overlapping lock/lease system.
- Concurrent initialization consumers must receive correct current state without duplicate model creation or premature completion.
- Track active initialization operations so one engine finishing cannot hide another still loading.
- Stop showing preparation as soon as initialization ends; do not leave the label active until the whole pipeline completes.
- Attach current initialization state to a request that joins an already-running initialization.
- Preserve initialization errors and fallback status. Feedback callback failure must not break model execution.

For cloud/API engines, distinguish lightweight client setup from actual local model loading. Do not claim a remote model is loading on this device. Audit any genuinely asynchronous preparation, but do not artificially prolong trivial no-op init calls for visibility.

### 8.3 Routing and UI

Support ordinary image jobs, capture/crop requests, and Studio OCR/inpaint/retranslation using their actual request identities. Do not depend solely on a `translationJobs` lookup when a Studio RPC has no job row.

Use immediate state updates in a stable status area instead of the current 700 ms suppression. No artificial delay in computation and no minimum wait imposed on the job. An operation shorter than one paint may not visibly render; this is acceptable and different from suppressing a long tier switch.

Popup displays readiness/preparation only when relevant; closing it must not cancel or own initialization. Changing a dropdown alone does not add eager preloading under this plan. Keep the current lazy-load/memory policy.

### 8.4 Acceptance

Test cold start, cached ready reuse, tier A to B to A, bubble lazy session creation, concurrent stages, initialization failure and fallback, shared in-flight initialization, crop request routing, Studio requests, and popup close/reopen. Confirm no stuck status after cancellation or errors.

## 9. Seven optimization tracks

### Optimization 1 — Explicit tensor and runtime resource ownership

**Purpose:** release per-inference resources after use while retaining reusable model sessions intentionally.

- Add bubble inference `try/finally` cleanup for owned inputs and every returned output after parsing, including errors.
- Address OCR output ownership in the installed detector/recognizer dependency through a pinned patch, upstream fix, or narrow maintained adapter. Do not edit `node_modules` as an untracked permanent solution.
- Preserve existing LaMa/AOT cleanup and provider retry lifetimes.
- Preserve WebLLM unload-on-destroy and manager lease protection; no forced unload after each page.
- Distinguish CPU typed arrays, ORT-owned GPU outputs, and externally owned GPU buffers before disposal. Ensure returned parsed data remains valid.

**Trade-off:** correct cleanup should not change output. Dependency adaptation carries upgrade-maintenance cost. Test ownership rather than assuming all outputs are GPU allocations.

**Gate:** mocked ownership tests plus repeated real inference/provider-switch observation. Report memory trends separately from browser/runtime allocator pooling.

### Optimization 2 — Reduce image transport/conversion overhead safely

**Purpose:** reduce main-thread conversion work and unnecessary image copies without breaking Chrome messaging or SPA replacement.

- Measure encoding, message size, relay cost, and content-side conversion independently.
- Keep JSON-compatible messages for the initial implementation.
- Remove avoidable repeated encoding/decoding and large-image payloads from status-only messages.
- Evaluate asynchronous browser-native data-URL-to-Blob conversion against the current `atob` loop in the actual content-script environment. Check CSP, cancellation, failure fallback, and ordering before adopting it.
- Keep intermediate assets in the owning extension context when recipients only need a job reference.
- Any later transport redesign needs a validated channel, origin/partition checks, bounded payloads, and lifetime handling. It is not required to ship the safer optimizations.

**Trade-off:** asynchronous conversion changes completion ordering and needs request guards; it does not automatically remove base64 payload inflation or guarantee zero copies.

**Gate:** byte-equivalent output, same-origin display URLs, live image replacement/reversion, large-image responsiveness, malformed inputs, and no stale image applied after a newer result.

### Optimization 3 — Coalesce Studio transforms and typesetting once per frame

**Purpose:** eliminate calculations the display could never show.

- Retain latest pointer coordinates/modifiers.
- Schedule at most one RAF callback; perform geometry, existing `recalculateBlockTypeset`, and state publication inside that callback.
- Do not calculate typesetting on every pointer event and merely throttle the final store write.
- Keep automatic font fit and line wrapping live. No approximate preview math and no reflow deferred until pointer-up.
- Pure movement continues to avoid re-typesetting when dimensions do not change.
- Flush final work synchronously before gesture finalization.
- Narrow broad React subscriptions only where measurement shows unrelated panels rerendering.

**Trade-off:** intermediate pointer events within a frame are skipped; latest geometry is shown on the next display frame. RAF follows display refresh, not a guaranteed fixed 60 Hz. No quality or final-layout change is intended.

**Gate:** instrument reflow call counts per frame, compare final geometry/layout, and visually test dragging/resizing with ordinary and high-rate pointer input.

### Optimization 4 — Reuse Studio canvas surfaces

**Purpose:** avoid resetting canvas storage and allocating temporary canvases unnecessarily.

- Set overlay dimensions only when dimensions change.
- Explicitly restore/reset required drawing state because resizing previously reset transforms, clipping, alpha, composition, styles, and paths implicitly.
- Reuse a scratch canvas for warped text, with integer dimensions, clear bounds, and known context state before each use.
- Release/resize retained scratch resources at appropriate page/unmount boundaries.
- Keep full redraw behavior initially. Static-layer caches are optional later work only if profiling still shows redraw cost.

**Trade-off:** reusable surfaces retain capacity between frames; this trades churn for retained memory. State isolation must be explicit to prevent visual contamination.

**Gate:** pixel comparisons and visual checks for warped/unwarped text, stickers, transparency, brush masks, selection furniture, and page dimension changes.

### Optimization 5 — Reuse prepared source images within a job

**Purpose:** reduce repeated decoding of the same original bytes.

- First reuse OCR's prepared source for normal detection/recognition where supported.
- Then share a job-local immutable prepared source across dimension checks, OCR, bubble geometry, and inpaint source access.
- Preserve preprocessing behavior: OCR resize, rotation, tiling, color handling, and platform-specific canvas copies.
- Keep mutable cleaned/baked surfaces separate. A decoded cleaned output is not necessarily a duplicate of the original source.
- Close temporary bitmaps in `finally`, including error paths.
- No global full-resolution decoded-image cache.

**Trade-off:** keeping a prepared source alive longer can increase peak memory even while reducing decoding work. Benchmark both latency and peak retained surfaces, especially tall strips.

**Gate:** identical OCR inputs/results within existing tolerances, unchanged inpaint geometry and typesetting, tall-strip regression, Node/browser compatibility, and measured decode count/peak surface lifetime.

### Optimization 6 — Targeted DOM discovery with correct invalidation

**Purpose:** reduce repeated full-document scans and geometry/style reads.

- Batch mutations and scan affected subtrees/candidates rather than the entire document for every change.
- Re-evaluate changed `src`, `srcset`, styles, relevant ancestors, and reused image slots. An element already observed is not permanently unchanged.
- Preserve shadow-root discovery, custom selectors, hidden backing images, non-HTML media, placeholders, and SPA reversion shields.
- Separate read/write phases where practical. Geometry reads alone are not proof of repeated forced layouts; use traces to identify actual layout work.
- Use existing visibility observers without replacing semantic discovery with visibility alone.
- Retain a bounded reconciliation path for navigation, selector changes, and mutations whose affected scope cannot be identified safely.

**Trade-off:** incremental scanning needs invalidation logic. Blindly skipping all observed nodes would miss lazy loading and virtualized replacements; that shortcut is rejected.

**Gate:** added nodes, changed attributes on existing nodes, ancestor visibility/style changes, recycled slots, shadow DOM, infinite scroll, custom selectors, and existing hover/replacement regressions.

### Optimization 7 — Blob lifetime, thumbnails, and bounded session retention

**Purpose:** retain needed results without unbounded extension-owned image accumulation.

#### Studio and History thumbnails

- Give Blob URLs clear owners and release them when their final consumer is done, including errors and superseded asynchronous loads.
- Prefer consumer-lifetime cleanup over blindly revoking every URL at `onload`; other actions may still need the URL.
- Generate actual small thumbnails for gallery display where worthwhile. CSS shrinking alone does not create a smaller source image.
- Keep full-resolution source/result references separate from thumbnails. Smaller thumbnails reduce display work but do not reclaim full-resolution bytes still retained elsewhere.
- Lazy-load offscreen thumbnails and bound decoded full-size reader images around the visible range, while preserving collection metadata and export availability.

#### Proposed retention budget

Use a named, initially **128 MiB encoded-result retention budget** for the content-side session asset pool. This is a starting product default to validate, not a claim that total tab memory is at most 128 MiB. Keep the existing **256 MiB ZIP output/input-budget guard** as a separate constraint.

- Count actual encoded Blob bytes once per shared asset, not URLs or chapters.
- Add separate conservative pixel/surface and in-flight-work guards for decoding/rendering; derive final thresholds from profiling rather than presenting a false total-RAM guarantee.
- Reserve estimated capacity before starting additional jobs where possible. At completion, atomically check actual encoded bytes against the pool budget before registering a result, creating its retained URL, or applying it to the DOM. Simultaneous completions cannot each admit against the same remaining capacity.
- If actual result bytes do not fit, reject retention for that result, release its transient buffers, leave the previous/original display intact, and report `Result not retained: session image limit reached` with an explicit retry path after capacity is freed. Do not silently mark it available in Reader/ZIP. Existing durable job records remain separate and are not deleted.
- Bound in-flight work and validate output size before serializing oversized messages. Transient in-flight bytes are outside the encoded retention ceiling and require separate size/concurrency guards; the retention ceiling is not a total-process-memory guarantee.
- Never silently revoke results still used by the page, selected collection, active reader, or in-flight export.
- Release superseded assets only after their last consumer releases them.
- When new results cannot be retained safely, pause additional batch work and show `Session image limit reached`. Offer explicit actions to download existing results, reduce work, or clear a previous page's retained results with a stated consequence.
- Clearing a previous page's results is explicit: it removes those session translations from future reader/ZIP access unless a durable equivalent has been verified. It does not silently delete History or its configured retention policy.
- An oversized single result fails gracefully with a clear explanation rather than evicting unrelated selected pages.

This initial policy favors explicit admission/refusal over a complex automatic spill-to-disk system. Durable baked-result storage can be a later optimization after the clean/baked asset contract is settled.

**Trade-off:** a real retention ceiling can stop further batch translations until the user frees capacity. That is a visible feature limit and must be communicated; it is not a zero-trade-off optimization. Browser-owned caches, site images, GPU models, and transient allocations remain outside the encoded-result budget.

**Gate:** boundary admission, oversized results, shared references, stale loads, popup closure, export pinning, SPA navigation, explicit clear, and no revoked image still used by an active consumer.

## 10. Delivery sequence

### Phase 0 — Establish a reliable baseline

- Inspect existing draft diffs and separate them from unrelated user work.
- Reproduce user gestures and reader/export mismatch.
- Capture traces for resize, image conversion, repeated inference, large-page decoding, and DOM mutations.
- Confirm relevant development guidance and installed dependency behavior.
- Record unverified claims as hypotheses, not acceptance promises.

### Phase 1 — Gesture correctness and initialization visibility

- Complete the Studio gesture lifecycle, integrating optimization 3 so RAF finalization is correct from the start.
- Add actual model initialization lifecycle reporting across normal/crop/Studio requests.
- Validate before moving to reader redesign.

### Phase 2 — Low-coupling cleanup

- Optimization 1: bubble and OCR resource ownership.
- Optimization 4: canvas reuse with explicit context state.
- Studio Blob cleanup from optimization 7.
- Preserve existing inpaint/WebLLM lifecycles rather than rewriting working cleanup.

### Phase 3 — Collection and asset correctness

- Shared collection identity/order contract.
- Stable selection and queue-time context registration.
- Reader subset preservation and scope-aware completion updates.
- Clean/baked History metadata and non-destructive legacy handling.
- Long-lived History asset resolution and receiver-owned URLs.

### Phase 4 — Reader/Stack/Home UX

- Move reader/export selection actions into Stack.
- Remove Home's blind actions.
- Align floating pill with all-current-page collection.
- Add reader scope/count labels, export preview, and visible progress/errors.
- Accumulate discovery during Fast Scan.

### Phase 5 — Transport, decode, and discovery optimizations

- Optimization 2: safe conversion/relay reductions.
- Optimization 5: prepared-source reuse.
- Optimization 6: targeted mutation discovery.
- Keep changes independently measurable and reversible; do not combine unrelated algorithm changes.

### Phase 6 — Session resource budget

- Finish optimization 7 after collection/asset ownership is explicit.
- Introduce budget accounting, admission control, pinning, and visible limit handling.
- Verify no export or selected reader silently loses assets.

### Phase 7 — End-to-end acceptance and documentation

- Run regression suites, type checks, production build, and real extension QA.
- Record measured changes, remaining limitations, and any deferred candidates.
- Update development docs/devlogs without shortening existing historical explanations.
- No release or production deployment is implied by passing local checks.

## 11. Test and measurement matrix

### Unit and integration tests

- Gesture classification, final RAF flush, undo/redo, cancel/lost capture/unmount, zoom, locking, handle geometry.
- Initialization cold/reused/switched/shared/failed states, pair matching, concurrent stages, fallback, and request routing.
- Tensor ownership success/failure paths and parsed output validity after cleanup.
- Canvas context isolation and dimension reuse.
- Selection metadata refresh, explicit deselection persistence, ordering, mixed sources, and empty-selection behavior.
- Selected reader survives open effects, timers, rescans, and unrelated completions.
- Same image URL across source URLs or History versions does not cross-update.
- Known clean and baked History assets render lettering exactly once; ambiguous legacy assets fail visibly without destruction.
- Popup closure does not invalidate reader images.
- Export ZIP file count/order/bytes match the confirmed collection; scope survives navigation and retranslation.
- Archive overflow aborts instead of silently truncating; unexpected failures are reported.
- Incremental DOM scanning preserves existing media discovery edge cases.
- Retention budget, pinning, shared ownership, and cleanup after final release.

### Real browser/extension checks

- User's exact first-drag, delayed second-drag, quick second-drag, and stationary double-click sequences.
- Live font fitting while resizing, including high zoom and narrow boxes.
- Change OCR, inpaint, translation, and bubble tiers and confirm actual preparation feedback.
- Reader from pill versus selected Stack images: same rendering, intentionally different explicit collection scope.
- Zero translated, partial translation, all translated, and failed translation ZIP flows.
- Current Page plus History selection; close popup immediately after launching reader/export.
- SPA A-to-B navigation with late A completion, repeated source URLs, and detached/virtualized pages.
- Long reading sessions at retention limit; no silent loss from active readers/exports.
- Real downloaded ZIP contents, not just mocked callback invocation.

### Measurement rules

Record comparable fixtures, hardware/browser, selected tiers/providers, and cold versus warm state. Track reflow count/frame, long tasks, conversion time, decode invocations, retained image bytes, and memory trend across repeated inference.

Use a small page, many-text-box page, tall strip, and dynamic reader page. Do not claim success from faster code alone if image quality or selection behavior changes.

Pipeline visual/model/network tests remain a separate manual gate. Do not attach them to `npm test`. Use the repository's supported Node version and existing test/build commands. Add tests for backend orchestration and state semantics; use visual/manual checks for straightforward styling.

## 12. Non-negotiable constraints and exclusions

- Preserve live automatic text fitting and current typesetting math.
- Preserve polygon-only inpaint input, native-scale localized patches, model/provider fallback, and current quality defaults.
- Preserve offscreen message addressing, same-instance local ORT/WASM loading, sequential GPU-sensitive OCR behavior, and documented build workarounds.
- Do not add eager initialization merely because the tier dropdown changed.
- Do not add phrase-level translation caching: context, glossary, model, and neighboring dialogue can change meaning.
- Do not pass `ArrayBuffer` directly through Chrome JSON messaging.
- Do not discard detached translated pages merely because they are no longer in the current DOM.
- Do not apply current-page URL filtering to an explicitly selected cross-source History collection.
- Do not equate current-page image discovery with semantic chapter detection.
- Do not silently evict selected/exported/displayed assets to satisfy a memory budget.
- Do not promise exact FPS, milliseconds saved, GPU-leak size, or total browser RAM without measurement.
- Do not introduce commercial-reference names or links into implementation documentation or comments.

## 13. Documentation and completion criteria

Update the reader/selection/export behavior documentation, resource ownership/limits, initialization event contract, and any new dependency workaround. Add focused devlog entries per delivered phase and preserve earlier explanations where still valid.

The work is complete only when:

1. User-reported gestures work without losing live text fitting.
2. Every meaningful real initialization is observable through its originating request UI, with no stuck state.
3. Stack selection, reader membership, and confirmed ZIP contents agree.
4. URL scoping still prevents unintended SPA cross-page mixing.
5. History assets are not confused with clean backgrounds and do not depend on popup URL lifetime.
6. Resource cleanup and budgets do not invalidate active readers/exports.
7. Optimizations are measured and do not change image/text output unintentionally.
8. Tests, build, real extension checks, and known limitations are reported accurately.

## References

- Chrome message serialization: https://developer.chrome.com/docs/extensions/develop/concepts/messaging#serialization
- ONNX Runtime WebGPU tensor residency and ownership: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- ONNX Tensor API: https://onnxruntime.ai/docs/api/js/interfaces/TypedTensor.html
- Blob URL lifetime and partitioning: https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob
- Repository constraints: `docs/development/workarounds.md`, `docs/development/testing.md`.
- Relevant existing history: devlogs 019, 028, 036, 039, 041, 044, and 047. Historical test claims do not validate new changes automatically.
