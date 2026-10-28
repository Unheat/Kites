# Phase 78: Browser Font Measurement Failure and Contour Integration Investigation

## 1. Metadata

- **Date:** 2026-10-27–2026-10-28; documentation reviewed 2026-10-28.
- **Scope:** `cf6dadf`, `ef1361e`, `ee09b0d`, `843db0b`, `656d720`, plus browser probe `b84af75` and outline visibility `6a3b878`.
- **Status:** merged into local main. Application font syntax defect reproduced and patched; full visual parity remains unproven.
- **User-reported cost:** approximately one day and more than 600 million tokens across the investigation. This records the user's estimate, not independently measured usage or billing.

## 2. Objective

Explain why the Node visual runner looked reasonable while real Chrome showed tiny syllable columns, oversized overlapping phrases, and inconsistent Studio outlines. Fix integration defects without mistaking screenshot-specific tuning for an exact donor port.

## 3. Investigation and implementation

### Font identity was not the whole problem

`cf6dadf` copied CC Wild Words and Anime Ace reference files into `public/fonts/`, added explicit CSS aliases, and changed preset stacks to prefer them. This removed dependence on certain local installations/substitutions. The browser symptom persisted, proving asset availability alone was insufficient.

### Invalid CSS font stacks retained stale measurement state

The contour fitter formerly used:

```typescript
ctx.font = `${stylePrefix}${Math.round(size)}px "${fontFamily}"`;
```

For a preset already containing quoted names and commas, the result was invalid CSS. A real-Chrome probe reproduced the setter ignoring it. Fresh contexts retained `10px sans-serif`; reused contexts could retain a previous block's font. Probe sizes therefore did not reliably change the measuring font, while the painting path used a valid family stack. Both oversized and undersized output followed from this mismatch.

`843db0b` preserves complete stacks instead of wrapping them again, and applies equivalent handling to Studio's rectangular wrapping path. This is an application defect, not evidence that Chrome's arithmetic or integer operations differ from Node.

The local runner used `CCWildWords, sans-serif`, not the production quoted stack. Quoting that entire value requests one family containing commas and may fall back. The investigation did not establish that Node accepts the identical malformed production string correctly. Earlier explanations claiming that were too strong.

### Coordinate and mode contracts

The acceptance callback began passing raw page-absolute contours to a box-local measurement path. `843db0b` subtracts the candidate origin. Since `wrapTextContour()` derives its bounds from supplied points, the former explanation that all absolute contours necessarily produce zero intersections was inaccurate; mismatched anchor/placement frames remain the real contract violation.

`ee09b0d` removed active `ellipse` mode checks, retaining legacy restore normalization. It did **not** create a universal inside-bubble/outside-bubble discriminated model: geometry, curvature, fixed layout, mode, and persistence still influence routing independently.

`ef1361e` generated sub-chamber polygons rather than leaving rectangular partition contours absent. It also broadened outline visibility, added a white contrast halo, scaled local contours through resize handles, and added a Reset to Bubble Frame action.

A blue outline now means stored contour points exist. It does not prove the current solver used them. In particular, backend factory contour priority can override `simple`, while saved labels and Studio future-edit intent can still say Caption Box.

### Local tuning introduced alongside fixes

The debugging commits also changed:

- Curvature rectangular classification to `fillRatio >= 0.94`.
- Contour token hyphenation threshold to 7.
- Vertical clearance using a size-dependent `0.35` factor.
- Word-count-based dialogue ceilings of 18/20/24px and width/height ratios 0.85/0.40.
- Studio/default contour sizing wrapper options.

`656d720` named the ceiling constants, but also changed the automatic height lower bound from 16 to the 9px readable-floor constant; it was not strictly a no-behavior-change extraction.

These are local adaptations. The inspected Koharu `automatic_maximum()` uses bubble width horizontally, height vertically, and 24px for nonbubble text. It does not implement the Kites word-count caps. Historical commit subjects/comments attributing those caps to Koharu should not be read as evidence.

## 4. Test harness and evidence

`scripts/chromeBubbleProbe.mjs` exercises `STUDIO_OCR` in a visible Puppeteer Chrome instance and reports geometry/layout metadata. It initially defaulted to v6-small and an untranslated/inpaint-only response; a returned patch is not the final English text canvas.

`scripts/e2eChromeBakeVisualTest.mjs` creates an isolated browser context, configures settings, seeds a local YOLO model into CacheStorage, creates job/image records, runs the pipeline, saves a baked image, and prints database blocks. Early runs used the wrong image-record field; this was corrected to `rawImageBlob`. Opening another fresh browser later yielded an empty database, not evidence that the preceding job failed to persist.

The harness's final implementation calls a temporarily exposed orchestrator from an extension page. It does not cover addressed `PROCESS_JOB` routing, content-script replacement, the complete Studio UI, or a visual assertion. Some settings strings are normalized by background code, so tests must record the effective state rather than assume the input literal matches runtime selection.

Actual generated images were opened during this investigation. They improved after the font syntax repair, but the last inspected image still showed a narrow tiny-text column in the large central burst bubble. Node and browser used different translations, OCR grouping/source-language filtering, styles, and entry points. No controlled full-page pixel comparison was completed. Statements that every bubble matched the reference were not supported by those artifacts.

Recorded checks at merge: 104 Vitest files / 1,122 tests passed, and production build passed. These are integration/unit/build results, not visual equivalence.

## 5. Lessons and remaining acceptance boundary

1. Inspect requested **and resulting** `ctx.font` during each probe; invalid setters can preserve stale state without an exception.
2. Hold translated text, font bytes, weight/style, geometry, and options constant before comparing runtimes.
3. Fix syntax and coordinate ownership before tuning font ceilings or classifier thresholds.
4. Keep original analysis geometry distinct from accepted layout geometry and authored Studio geometry.
5. Test first-open, font switching, transforms, mode switching, reset, undo/redo, save/reload, and export separately.
6. Do not change an expected unit-test size merely to imply visual correctness; record why the behavior changed and inspect the browser output independently.
7. Do not call an implementation “1:1” because a filename, commit subject, or named constant says so.

Current contracts and remaining limitations are maintained in [the typesetting specification](../../development/koharu_typesetting_pipeline_spec.md), [workarounds section 15](../../development/workarounds.md#15-canvas-font-syntax-and-contour-coordinate-contracts), and [ADR-010](../../decisions/ADR-010-contour-layout-and-browser-validation.md).
