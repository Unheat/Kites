# Devlog 094: Dropped-line diagnosis — slot reporting, and the tilt-angle port defect

## 1. Metadata

- **Date:** 2026-11-10
- **Branch:** `main`
- **Feature/Task:** Explain two reports from a live run: `Model dropped or echoed N lines` warnings, and vertical CJK bubbles left untranslated on the page.
- **Status:** Completed for the diagnosis and both fixes; extension suite green (1,366 tests / 118 files), typecheck clean.

## 2. Objective

A live run against OpenRouter logged `Model dropped or echoed 3/19`, `3/13`, and `2/19` while every pipeline stage reported success, and the reader showed a full vertical Chinese bubble left on the page next to its English replacement. Neither symptom names its own cause, so the goal was to decide whether slot loss and line loss were ours or the model's, and fix only what is ours.

## 3. Workflow and Implementation

1. **Reproduced the batch.** Drove `CustomApiEngine` against OpenRouter with the three models from the report (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `deepseek/deepseek-v4.1-flash-1017`) on the same 19 OCR slots, capturing raw replies, parse results, and per-slot classification.
2. **Ruled out the JSON path.** Every successful reply contained `19/19` keys. `parseKeyedOutputWithMetadata` assembles strictly by slot key, so no positional drift and no omitted key: nothing was lost in transport, parsing, or assembly.
3. **Found what the warning actually counted.** All counted slots were verbatim echoes of OCR noise (`棋地臥兆面提态`, `ボ口。`, `规在正提拼尽全力的时候`), plus already-Latin text (`J000`, `Justice`) which the heuristic deliberately ignores. Copying untranslatable text unchanged is what the system prompt instructs, yet the single log line reported it as loss and claimed translations were being "yielded".
4. **Split the report.** `BaseLlmTranslationEngine.translate` now counts `missingKeys` (absent from the reply — real loss) and `echoedKeys` (returned unchanged in the source script — not translated) separately, logs the slot ids for each, and states that those lines keep their source text. Both remain warnings; translation behavior is unchanged.
5. **Found a second, unrelated failure.** `qwen3.8-27b` spent the whole 4096-token completion ceiling on reasoning and truncated mid-JSON, which strict parsing reported as "Model hallucinated". A `lastCompletionTruncated` flag fed by the provider finish reason is now threaded into `buildStrictParseError`, so a cut-off reply says the completion budget ran out instead of blaming the model.
6. **Traced the leftover bubble to the OCR pre-filter.** The reported page logged 13–18 `high-tilt` drops, including real words (`どんと` at 15.9°, `こり` at 30.3°). The rule drops any recognized line past 12° tilt under 0.60 confidence. The donor applies that rule to *regions* and guards it with `if !is_bubble` (`xianscan-rust/src/pipeline/region_builder/filter.rs`); this port is line-level and bubble-blind, and the earlier native-dialogue exemption (`527a90d`) was wired only into the neighborhood-suppression path.
7. **Established age, not regression.** `git log -S "angleDeg >= 12.0 && score < 0.60"` points at `7ede72f` (2026-09-05), which is an ancestor of `v1.0.2`, `v1.0.5.1`, `v1.3.0`, `v1.3.2`, and `v1.4.0`. A clean 1.3.2 build reproduces the same leftover bubble, so this is a long-standing false drop, not fallout from 1.4.0 or from `527a90d`.
8. **Made one rule, two call sites.** Extracted `isNativeDialogueLine(text, lang)` into `src/shared/utils/textCleaning.ts` (≥2 characters, non-Latin source, native script present) and used it for both the high-tilt and the neighborhood-suppression floors. The three score floors became named constants instead of inline literals.
9. **Wrote regression tests that can actually fail.** Two battery tests assert that a 15°-tilted Chinese column at 0.45 survives while a 15°-tilted Latin line at 0.45 is still dropped.

## 4. Root cause of the leftover bubble: the tilt was measured wrong

Comparing our port against the donor turned up a genuine port defect, not a threshold to tune.

- **Two different functions.** The donor measures line tilt with `calculate_box_angle` (`xianscan-rust/src/ml/geometry.rs:157`), which labels corners from the x-sorted pairs, computes mean width/height, then branches: vertical boxes are measured against the **vertical** axis, and the result is damped for jitter and finally clamped so any tilt past 45 degrees reports as level. Our port used `calculateRotationAngle`, a raw `atan2` of the first two polygon points with no branch and no clamp.
- **The consequence is over-filtering of vertical columns.** `orderRectCorners` labels the leftmost corner `tl`, which for a rotated column is its physical *bottom-left*, so the leading edge is the long edge and the reported angle is the complement of the real tilt. A 15 degree column reads ~75 degrees, which is over the 12 degree gate.
- **It also mis-flags artwork.** Because nothing was clamped, 46-70 degree strokes were reported as tilted *lines* and could drop nearby text.
- **Measured, not assumed:**

| Fixture | old `calculateRotationAngle` | donor-faithful |
| --- | --- | --- |
| upright vertical column | 0° | 0° |
| vertical column, 15° tilt | ~75° | 0° |
| horizontal row, 10° tilt | 10° | 10° |
| diagonal artwork, 60° | 60° | 0° |

- **Fix:** ported the donor function as `calculateBoxTiltDegrees` in `src/shared/utils/geometry.ts` and switched the OCR pre-filter battery to it. `calculateRotationAngle` is untouched because the renderer and Studio use it for glyph rotation, where its existing semantics are correct.
- **A column is never "high-tilt" in the donor's model**, so the tilt rules stop deleting vertical dialogue by construction. That is why an exemption list was the wrong idea.
- **Rejected: keeping garbled columns.** An earlier iteration exempted portrait boxes from every score floor. That lets a column whose recognition failed (`"Wn"`, score 0.38) flow downstream, where it is baked over erased art as gibberish — worse than leaving the source visible. The exemptions for the slanted-non-native and short-Latin rules were reverted; only the native-dialogue score floor remains, because that one requires actual native characters as evidence.
- **Added `[OcrAudit]`.** One consolidated log per page: every detected line with score, box size, tilt, text, and the stage that dropped it. Two rounds of this investigation were spent guessing which filter fired; this table ends that.

## 5. Roadblocks and Decisions

- **The first draft of the tests passed vacuously.** The pre-filter battery short-circuits with `if (rawTexts.length <= 1)`, so single-line fixtures never entered it and both the positive and negative cases "passed". The negative control unexpectedly keeping the Latin line exposed it; every battery fixture now carries a second neutral line and asserts it survives as proof the battery ran.
- **Red-green check, not a claim.** Collapsing the exemption back to the flat 0.60 floor makes the new positive test fail; restoring it makes it pass.
- **Latin-source pages are deliberately not exempted.** For English and other Latin sources `hasNativeScriptForLang` returns true for anything, so an exemption there would exempt every line. `isNativeDialogueLine` gates on `isNonLatinSource` first, which also returns the neighborhood-suppression exemption on Latin pages to its pre-`527a90d` strictness.
- **Skewed native dialogue is ordinary, not pathological.** Scanned pages are rarely level, so 12–20° tilt with a low recognition score is normal for a vertical column. Confidence, not tilt, separates dialogue from screentone and clothing folds, so the exemption relaxes the confidence floor and leaves the angle gate alone.
- **Not changed: truncation policy.** A truncated batch still fails the page. Whether to retry that chunk with a larger budget or fall back to source text (as `CloudflareTranslateEngine` does with `throwOnCountMismatch = false`) is a product decision and is left open.
- **Unconfirmed for the specific reported page.** The exemption fixes a demonstrated failure mode (real words dropped at 12–30°). Whether that exact bubble is dropped by this rule can only be confirmed from that page's OCR console log, which has not been captured yet.

## 6. Verification and Next Steps

- `npx vitest run src/` — **1,375 tests / 118 files passing**, including echoed-vs-omitted reporting, truncation naming, six `calculateBoxTiltDegrees` unit tests (complement, clamp, jitter, corner-order invariance), and battery tests for tilted columns.
- `npx tsc -b` — clean.
- Live reproduction: probe against OpenRouter confirmed `keys=19/19` and classified every counted slot as an echo. The probe was disposable and is not part of the repo.
- Next: capture the OCR battery log for the affected page to confirm the drop reason, decide the truncation policy for reasoning models, and consider surfacing per-page echo counts in Studio history so readers can see which bubbles kept their source text.
