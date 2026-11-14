### Date: 2026-11-11

* **Feature/Task:** Gate Bubble Contour typesetting by detected bubble evidence in Studio
* **Ticket:** —
* **Status:** Completed

### Objective

Region text that is not inside a speech bubble (captions, narration boxes, free text — i.e. no dashed blue contour) could still be switched to **Bubble Contour** typesetting. Contour fitting on a box with no chamber polygon falls back to a synthetic rounded contour, which is meaningless for a caption block and produces unstable layouts. Bubbles, by contrast, must stay able to move freely between all three engines and come back to contour at any time.

### Which flag already existed (audited before changing anything)

| flag | scope | survives a mode switch |
| --- | --- | --- |
| `contourPoints: Point[]` (the dashed blue polygon, ≥3 vertices) | persisted on `TextObject` | yes — `typesetMode` edits never touch it |
| `originalContourPoints` + `detectedWidth` / `detectedHeight` | transient Studio detection baseline (drives `Reset to Bubble Frame`) | yes |
| `isRounded` / `borderRadius` | persisted curvature classification from `computeMaskCurvature` | yes |
| `typesetMode: 'contour' \| 'balloon' \| 'simple'` | the engine in use **right now** | no — flips to `simple`/`balloon` |
| `typesetBoxes[i]`, `proposals[i]`, `carriers[i]`, `curvatures[i].isRounded` | pipeline-only (`PipelineOrchestrator`, ~line 651) | n/a (not persisted) |

`PipelineOrchestrator` already classifies persisting blocks as `hasContour = contour.length >= 3`, `hasBubble = typesetBoxes[i] || proposals[i] || carriers[i]`, `isContour = hasContour || curvature.isRounded`, then saves `contour` for bubbles, `simple` for captions and `balloon` for the off tier.

### Workflow & Implementation Steps

1. **Added the derived catalog** in `src/shared/constants.ts`: `CONTOUR_REQUIRED_TYPESET_MODES` plus `availableTypesetModes(hasBubbleContour)`, which filters the canonical `TYPESET_MODES` array rather than restating a list in the UI (AGENTS §3 single-source-of-truth rule).
2. **Added `src/studio/canvas/typesetModes.ts`** with `hasBubbleContour`, `availableTypesetModesFor`, `isTypesetModeAvailable` and `resolveTypesetMode`. Membership is read from `contourPoints` **or** `originalContourPoints`, so a restored baseline still counts.
3. **Gated the switcher** in `TypographySettings`: the Bubble Contour button is `disabled` with a tooltip explaining why, and `handleToggleTypesetMode` refuses an unavailable mode for the selected object. In global edit mode the button stays enabled as a stored default, because each object resolves its own allowed engine.
4. **Made the fallback real, not cosmetic:** `applyTextObjectUpdates` now runs `resolveTypesetMode(updated, chosenMode ?? object.typesetMode ?? globalMode)`. A global Contour default therefore cannot reach a caption — it resolves to Balanced Fit instead of silently contour-fitting with a generated ellipse.
5. **Kept the round trip open:** switching a bubble to Caption Box leaves `contourPoints` and `originalContourPoints` untouched, so Bubble Contour stays enabled and re-selectable, and `Reset to Bubble Frame` still restores the detected frame plus contour.
6. **Fixed the shared fixture** in `TypographySettings.test.tsx`: `makeObject` now seeds a 4-point chamber polygon (real pipeline dialogue carries one); caption fixtures pass `contourPoints: undefined` explicitly.

### Roadblocks & Decisions

* **The Problem:** the obvious gate (`typesetMode === 'contour'`) is exactly the wrong one — it records the current engine, so it would lock a bubble out of contour the moment the user tried Caption Box, which is the failure the user explicitly warned about.
* **The Solution:** gate on the detected chamber polygon. It is durable detection output, it is already drawn as the dashed outline, and it is the same evidence the pipeline used to classify the block as a bubble in the first place.
* **Rejected alternative:** synthesizing a contour for contourless text (or keeping contour selectable and letting it generate an ellipse). That preserves the current confusing behaviour: a caption would get a fake bubble fit with no relation to its box.
* **Rejected alternative:** dropping `contourPoints` when switching engines so provenance and engine agree. That would have destroyed the ability to switch back and would break `Reset to Bubble Frame`.
* **Cost check:** two array-length comparisons per render; one extra filter of a 3-entry array per mode resolution.

### Next Steps / Key Takeaways

* **Takeaway:** classify by *evidence* (what the detector found), never by *current state* (what the user picked last) — the latter is unrecoverable in a settings UI.
* **Takeaway:** a disabled control plus a tooltip beats silently ignoring the click; the tooltip now states which two engines the text can use.
* **Verification:** `npx tsc --noEmit`, `npm test` (1432 passed), `npm run lint`, `npm run build`. New coverage: disabled/refused contour for contourless text, contour reachable again after a bubble switches away, restored `originalContourPoints` counted as evidence, and `applyTextObjectUpdates` never contour-fitting free text under a global Contour default.
