### Date: 2026-10-12

* **Feature/Task:** Phase 25: Per-image translation controls and queue-limit feedback
* **Ticket/Issue:** Translate spinner moved to a newly hovered image instead of staying with its queued image.
* **Status:** Implemented; source tests, production build, and isolated browser overlay checks passed

### Objective

Keep each queued or processing image's spinning control attached to that image until its request finishes. Allow the reader to hover and enqueue other images independently, including rapid requests, while preserving the existing control appearance and tall-webtoon viewport positioning.

### Incident and Root Cause

Hover mode rendered one `TranslateButton` from one `activeImg` value. Hovering the next image replaced that value and moved the existing control's CSS anchor. Because the component had no stable image key, its local `localTranslating` state survived the move. The first image lost its indicator, and the second image could inherit a spinner without being clicked.

Tracking pending URLs in a Set prevented one completed request from clearing other requests' state, but did not retain the DOM targets needed to render their controls independently.

### Decisions

1. **Use one control with idle and busy states, not a separate spinner implementation.** Both states must share the same CSS anchoring, viewport clamp for tall strips, icon, dimensions, and initialization pill. Future positioning fixes must apply to both states together.
2. **Separate hover visibility from request lifecycle.** A hover target can disappear or change without deleting a queued image's status. Render the union of pending image targets and eligible manual targets, deduplicated so one image does not get overlapping controls.
3. **Keep background admission authoritative.** A tab's visible spinners cannot measure global capacity: other tabs and captured regions can also queue work, and the existing capacity setting counts waiting jobs, not the single actively running job. Do not reject requests based on the content script's local map size.
4. **Share accepted-job events across entry paths.** Background emits an addressed `IMAGE_QUEUED` event after acceptance, before starting processing. Manual controls, Auto, and context-menu requests use the same status lifecycle. Rejections must not be acknowledged as queued.
5. **Show status in Auto without idle controls.** The user explicitly chose visible queued/processing indicators in Auto and no idle hover/persistent action controls while Auto is enabled. Switching Auto off restores the stored manual Hover/Persistent preference.
6. **Keep queue rejection feedback local to the requested image.** Show `Queue limit reached · please wait` in the existing adjacent pill treatment for 2.5 seconds, then dismiss it. A rejected request is not a busy job.
7. **Preserve sequential inference.** Multiple visible spinners represent waiting requests plus the running request, not parallel WebGPU pipelines. The capacity slider remains 1–5; existing waiting-capacity semantics are unchanged.

### Edge Cases Covered by the Implementation

* Multiple rapid clicks on different images must preserve each image's own control and anchor.
* Duplicate requests for an active job must not delete that job simply because more than five seconds elapsed.
* Admission of captured regions and URL requests must share the same serialized capacity guard.
* Right-click acceptance must create status even without first clicking the overlay.
* Queue rejection and transport failure must reset busy state rather than leave a permanent spinner.
* Completion or failure of one image must not remove another image's indicator.
* Idle and busy controls must use the same tall-strip scroll clamp.
* Disabling the extension must hide controls; changing mode must not leak duplicate controls.
* Detached or recycled DOM targets must not display an old image's status on unrelated media.

### Verification

* `npm test`: **429 tests passed across 46 files** (398-test baseline; 31 additional regression cases).
* `npm run build`: **passed**, including `tsc -b` and production Vite bundling. Existing bundle-size warnings remain.
* `git diff --check`: **passed**.
* Browser check: loaded the actual `GlobalOverlay` and content CSS in an isolated local page with a mocked Chrome queue boundary. Observed three independently anchored busy controls plus a fourth idle hover control, a queue-limit pill beside the rejected image, pill dismissal, completion removing only its own spinner, Auto showing accepted spinners without idle controls, and a scrolled tall-image control keeping the same visible-top position before and after becoming busy.
* The browser harness does not load the packaged extension service worker or run real OCR/translation/inpainting. Context-menu lifecycle and admission races are covered with mocked Chrome/Dexie integration tests; a real extension/site end-to-end run was not performed. Real-model pipeline visual tests remain separate from `npm test`.

### Implementation Locations and Limits

* `src/content/contentUi.tsx` contains the side-effect-free overlay and shared controlled button. `src/content/index.tsx` keeps CSS loading, root mounting, and unload cleanup. Importing UI tests no longer mounts a second unmocked content root.
* Background admission and queue dispatch share a short Promise gate. The gate covers waiting-count checks, insertion, and acceptance notification, not the long-running inference task.
* Right-click rejection can discover the requested image even when no optimistic overlay request exists and show the same brief feedback pill.
* DOM source identity is revalidated on the existing 300ms scan interval. Disconnected/recycled targets stop rendering old status; matching targets can be recovered.
* Terminal messages are checked against `jobId` when supplied. Legacy terminal payloads without `jobId` cannot distinguish delayed results from a newer same-URL retry.
* Auto rejects do not show idle feedback controls, matching the explicit status-only Auto policy.

### Key Takeaway

A spinner is a view of a request's lifecycle, not a property of whichever image the cursor last hovered. Keep one shared visual control, but let background acceptance and terminal events own its busy state.
