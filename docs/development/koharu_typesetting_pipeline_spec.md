# Koharu and Kites Typesetting: Current Contract and Parity Assessment

**Reviewed:** 2026-10-28, local `main` through `656d720`.

**Purpose:** describe the shipped local implementation, its donor lineage, and remaining differences. “Exact” in a test filename or historical commit subject is not an acceptance result.

## 1. Status and scope

Kites ports contour-based line profiling, dynamic-programming line selection, reflex-neck decomposition, and anchor-based polygon partitioning from the local Koharu reference. It retains its own OCR grouping, YOLO/heuristic geometry acquisition, Canvas measurement/rasterization, free-text renderer, and Studio edit behavior.

Full end-to-end visual equivalence to Koharu or `pipelineVisualKoharuExactTest.ts` has **not been established**. Earlier claims of complete parity are superseded by this assessment. The browser investigation reproduced an application font-string bug and produced inspected images, but used different text, OCR output, style, and orchestration from the Node runner. A successful unit suite or browser script exit is not a pixel-parity gate.

See [Devlog 078](../dev-history/devlog/078_phase78_koharu_typesetting_visual_parity_browser_canvas_discrepancy.md), [font library specification](font_library_spec.md), and [testing guide](testing.md).

## 2. End-to-end mapping

```mermaid
flowchart TD
  Pixels[Original image pixels] --> OCR[PaddleOCR and geometric text grouping]
  Pixels --> Geometry[YOLO masks or heuristic carriers]
  OCR --> Associate[Associate text boxes with carriers]
  Geometry --> Associate
  Associate --> Partition[Resolve shared chambers and noise fragments]
  Translation[Translation output] --> Accept[Selected-font candidate measurement]
  Fonts[Preset or registered library face] --> Accept
  Partition --> Accept
  Accept --> Layout[Contour DP or rectangular DP or Auto Balloon]
  Layout --> Bake[Canvas 2D text painting]
  Layout --> Persist[Save final boxes lines and positionedLines]
  Persist --> Studio[Restore without initial reflow]
  Studio --> Edit[Text font or dimension edit]
  Edit --> Reflow[Studio mode-specific reflow]
```

### Detection and association

- Kites uses YOLO11n segmentation at 1024 square input or a heuristic pixel carrier extractor. These are not Koharu's detector/model.
- `NeuralBubbleDetector.matchBubbleIndex()` uses text-box intersection **coverage**, not intersection over union, with a default threshold of 0.50 and a center check. `BubbleLayoutService` uses the same coverage value for association.
- The inspected Koharu detection source uses foreground-mask containment with a threshold of 0.9 and chooses a containing bubble. This is not mathematically equivalent to box coverage.
- In neural mode an unmatched text region has no carrier. In heuristic mode the extractor attempts carrier discovery from original pixels. The active model setting does not guarantee that every visually enclosed text block receives an accepted layout.
- The mask curvature classifier's current rectangular threshold is `fillRatio >= 0.94`. It is a local heuristic, not semantic proof of a caption.

### OCR and grouping

Kites uses PaddleOCR line detection/recognition followed by geometric grouping and `utteranceSplitter.ts`. The donor pipeline can use different analysis entities and recognition models. Different blocks, anchors, noise fragments, or source-language filters can change shared-chamber partitioning before typesetting starts.

Do not attribute these differences to JavaScript integer arithmetic. Model outputs and preprocessing may differ across runtimes, but that requires measurement; the demonstrated font failure was invalid application syntax.

## 3. Geometry contracts

### Coordinate ownership

| Data | Coordinate space | Owner |
| --- | --- | --- |
| OCR polygons and boxes | Original image/page pixels | OCR service |
| `BubbleGeometry.contours` | Page-absolute vertices | `acquireBubbleGeometry()` |
| Accepted `typesetBoxes` | Page-absolute rectangles | Layout resolver |
| Resolved `contourPoints` | Relative to accepted box origin | Layout resolver |
| `positionedLines` | Local layout coordinates | Typesetter/render result |
| Studio contour | Relative to object frame | Restore/edit state |

The pipeline acceptance callback subtracts the candidate box origin from raw contour vertices. This keeps the contour and local text anchor in the same frame. `wrapTextContour()` also derives bounds from the supplied polygon, so absolute coordinates do not inherently mean zero intersections. Mixed frames can instead misplace anchors or downstream positions.

### Shared chambers

`resolveBubbleLayoutsDetailed()` groups common/nested/high-overlap carriers. It uses:

1. A single-region contour or computed typeset box, followed by pairwise clamping.
2. Rectangular/shared-container partitioning when all members are classified flat or no shared contour exists.
3. Reflex-neck decomposition, then contour-clipped anchor/Voronoi fallback for curved shared balloons.
4. A noise guard: if every secondary box has area at most 35% of the dominant box, the dominant takes the full shared contour and siblings become `skipped`. Substantial stacked siblings are not absorbed solely because they overlap horizontally.
5. Candidate acceptance and group collision rollback, followed by sibling boundary constraints.

The rectangular partition branch now supplies generated local sub-chamber polygons. These are synthetic geometry, not recovered mask boundaries. Contour point count alone does not establish whether a polygon is organic or synthetic.

Groups can still be rejected atomically. Rejected geometry is not universally recovered by a second heuristic pass. The pipeline's persistence code can fall back to raw analysis contours/carriers after detailed rejection; therefore saved editing metadata may differ from the strategy that painted the baked result. This is a known integration limitation, not guaranteed successful contour routing.

### Inpainting boundary

Bubble geometry affects layout, not erasure ownership. Inpainting remains polygon-only using original/raw OCR text polygons. Contours are not a blanket erase mask. Preserve the contract in ADR-002.

## 4. Typesetting algorithms and differences

### Contour DP

`ContourDpTypesetter` delegates to `wrapTextContour()`:

- Token/segment templates and hyphenation opportunities are built once per pass, outside font probes.
- Candidate measurement uses Canvas glyph advances; an optional `MeasureCache` keys widths by the live font string and text.
- Each line samples five positions across an approximate glyph ink band. At each sample the widest valid polygon span is chosen, then the spans are intersected across the band.
- A common horizontal center keeps the paragraph aligned rather than zig-zagging between asymmetric chords.
- Dynamic programming scores slack, overflow, break penalties, and discretionary hyphens. Non-overflowing candidates beat overflowing candidates; among clean candidates fewer lines beat more lines before penalty tie-breaking.
- Coarse downward font probes followed by refinement handle non-monotonic profile changes.
- `positionedLines` preserves line-local placement rather than asking the painter to reconstruct uniform spacing.

This shares donor structure, but it is not byte-for-byte equivalence: JavaScript numbers, Canvas shaping, approximate ink height, raster-size rounding, line pitch, font bounds, and wrapper options differ.

### Current local sizing policy

Current constants in `contourTypeset.ts`:

- Default minimum readable size: 9px. Acceptance probes may explicitly pass 6px or a user minimum; a default is not a universal floor.
- Dense dialogue ceiling: 18px; short dialogue ceiling: 20px; matching single-word scream ceiling: 24px.
- Automatic ceiling ratios: width 0.85 and height 0.40.
- Vertical clearance uses `max(inlineAir, round(fontSize * 0.35))`.
- Minimum candidate hyphenated token length: 7, with at least two characters on each side of an accepted cut.

**These are Kites adaptations introduced during debugging.** Naming constants does not demonstrate that values are optimal or donor-derived.

In the inspected donor, `text_renderer.rs::automatic_maximum()` uses bubble width horizontally, bubble height vertically, and 24px for nonbubble text. The donor does not contain the Kites 18/20/24 word-count cap policy. The donor also uses measured ink metrics and a different clean-fit floor comparison. Earlier claims that the local caps were an exact port were incorrect.

### Strategy routing

Active canonical persisted/editing modes are `contour`, `balloon`, and `simple`. `ellipse` survives only as a legacy stored value normalized to `contour` during restore. A generated ellipse polygon is a geometry fallback, not a fourth engine.

- `contour`: contour DP, supplied polygon or a fallback shape.
- `balloon`: Auto Balloon, the Cotrans/XianScan-derived free-box route.
- `simple`: backend `SimpleRectTypesetter` runs contour DP on a rectangle; Studio simple edits instead use rectangular greedy wrapping at the current font size.

`TypesetStrategyFactory.resolve()` gives supplied contours priority for fixed layouts, even when a mode field says `simple`. This explains why a saved Caption Box label and a contour-shaped initial layout can coexist. `getByMode()` serves explicit strategy lookup; it is not interchangeable with inferred resolution.

See the [Auto Balloon](auto_balloon_typesetting_spec.md), [Simple Rect](simple_rect_typesetting_spec.md), and [renderer](cotrans_renderer_spec.md) specifications for route-specific behavior.

## 5. Font measurement and painting

The contour fitter previously wrapped a complete CSS stack in quotes. An already quoted stack then became invalid CSS, and Chrome retained its **previous** canvas font rather than adopting the requested probe size. Fresh contexts retained `10px sans-serif`; reused contexts could retain the preceding block's font. The drawing path used a valid stack, so the words painted at sizes unrelated to those measured. This accounts for state-dependent tiny and oversized text without invoking a browser arithmetic defect.

The fix preserves comma-separated stacks and quotes individual unquoted family names only when necessary. The same contract applies to Studio simple wrapping. The Node runner's former `CCWildWords, sans-serif` string was not the same as the quoted preset stack; enclosing it as a single family could silently select a fallback there too.

`PipelineOrchestrator` explicitly preloads selected family candidates before measurement. Studio library registration occurs asynchronously at boot; it is not proof every preset has been loaded before the first synchronous edit. Font syntax validity, face availability, weight/style, and readiness must all be checked separately.

Koharu resolves font resources through its own native font system and shapes glyphs using its native stack. Kites uses FontFace/CSS and Canvas 2D. No per-family hardcoded geometry algorithm is justified by the reference investigation.

## 6. Persistence and Studio lifecycle

- The pipeline saves final renderer geometry, chosen font size, lines, spacing, colors, rotation, and positioned scanlines where available.
- Restore threads `contourPoints` and `positionedLines` into `TextObject`; existing measured lines are retained until a layout-affecting edit. Selection alone should not refit.
- `TextRenderer` paints Canvas 2D text from positioned lines when valid and compatible with styling; otherwise it uses its horizontal/vertical path. It is not an SVG text renderer.
- `CanvasFurniture` draws stored contour points with a white halo and blue dashed stroke regardless of mode, unless the object is skipped. A visible outline is evidence of stored geometry, not evidence of the chosen solver or text containment.
- Resize handles proportionally scale local contour points using a captured baseline and reflow during animation-frame updates. Other edit routes must not be assumed to share that scaling automatically.
- `originalContourPoints`, `detectedWidth`, and `detectedHeight` preserve an in-memory baseline. Restore initializes them from current persisted geometry; they are not independently saved original detections.
- Reset to Bubble Frame restores dimensions and contour only. It does not restore original page position or rotation, and the original detection baseline does not survive arbitrary save/reload as an independent record.
- Undo/redo stores object snapshots, so retained contour metadata travels with those snapshots. A complete transform/mode/save/reload acceptance matrix remains required before claiming donor lifecycle parity.
- Mode-only changes preserve current lines and define future edit intent. Switching away from contour is not proof that original geometry has been deleted; switching back is not a new detection pass.

Koharu distinguishes the original automatic analysis region from authored geometry. Its overlay can show the original automatic region while a custom geometry is transformed. Its transient drag transform and committed re-layout are not identical to Kites' current live reflow/overlay behavior.

## 7. Validation and diagnostics

### Why the Node runner is not an end-to-end oracle

`pipelineVisualKoharuExactTest.ts` uses hardcoded semantic transcription, native OCR/inference, a directly registered reference font, bold drawing, and manually constructed neural mask evidence. It does not instantiate `PipelineOrchestrator`, and its acceptance callback does not pass the same contour metadata as production. It does not exercise Chrome's font setter, background state normalization, database restore, Studio font switching, undo, or export.

`chromeBubbleProbe.mjs` drives Studio OCR, not a live-web bake; its returned inpainted patch is not a rendered English Studio canvas. The standalone Chrome bake harness uses a temporary exposed orchestrator in an extension page, seeds model cache, and prints blocks. It currently calls the orchestrator directly, not the addressed `PROCESS_JOB` path, and has no automated image-diff assertion. Browser execution success is not visual acceptance.

### Diagnostic order

1. Confirm requested and resulting `ctx.font` at multiple probe sizes in the actual context.
2. Confirm face bytes, selected family, bold/italic, and readiness agree between measurement and painting.
3. Hold translated text, source language, OCR boxes, masks, and styles constant across runtimes.
4. Compare accepted/rejected box, partition cell, contour origin, mode, and skip status per region.
5. Inspect `positionedLines` and final painted bounds, not just `fontSize`.
6. Test initial Studio restore separately from edits, transforms, mode switches, reset, undo/redo, save/reload, and export.

## 8. Module ownership and retained history

- `engines/typeset/`: strategy interface/factory and three concrete strategies.
- `utils/contourTypeset.ts`: profiles, segment templates, DP, sizing policy, polygon generation.
- `utils/typography/`: shared tokenization, kinsoku rules, and marker-aware unwrapping.
- `utils/geometry/`: polygon math, neck decomposition, partitioning, sibling clearance.
- `services/BubbleLayoutService.ts`: association, geometry resolution, noise suppression, acceptance/rollback.
- `utils/cotransDefaultRenderer.ts` and `utils/renderer/`: strategy dispatch, Canvas painting, line-break/region helpers.
- `studio/canvas/`: object edits, transforms, text painting, and selection furniture.

The retired `renderer/cotransTextRasterizer.ts` is no longer an active module. Historical devlogs 072–077 preserve implementation milestones; their exact-parity wording is historical, not stronger evidence than this current assessment.
