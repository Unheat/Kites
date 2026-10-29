# Devlog 086: Source-Faithful Koharu Contour Typesetting Port

### 1. Metadata
* **Date:** 2026-10-29
* **Feature/Task:** Replace the approximate contour typesetter with a direct port of the pinned Koharu renderer core
* **Branch:** `fix/koharu-contour-source-parity`
* **Donor revisions:** `koharu` @ `56787dc90606bd630ba7401441b32ab2f76afc18`; `typst/hypher` 0.1.8 @ `d81cc506416bffef2a75ee2dc969d4b41bc36613`
* **Status:** Completed for the portable core (1255 tests in 114 files, typecheck/build/lint green). Live Rust differential execution and end-to-end pixel parity are **not** claimed.

---

### 2. The Objective
The contour route did not behave like the donor on the same page. It hyphenated only when the clean fit bottomed out at the 9 px floor, never expanded the text contour, and silently capped font size. The request was an exact source port, not an abstraction that merely looked equivalent: portable algorithms, constants, predicates, ordering, and fallbacks had to be translated faithfully, with platform-only substitutions isolated and documented.

Scope stayed on horizontal contour sizing, profiles, line breaking, hyphenation, placement, and the pipeline/Studio adapters that feed or paint those results. OCR, bubble discovery/partitioning, inpainting, and the XianScan/Auto Balloon routes were left alone.

---

### 3. Root Causes Found

#### 3.1 Hidden caps and a rounded search
The old `contourTypeset.ts` had accumulated debugging adaptations:
* a hard 48 px automatic ceiling,
* a 0.85 × container-width and 0.40 × height ratio,
* word-count-based 18/20/24 px dialogue caps,
* rounded probe font sizes,
* `>=` instead of the donor's strict `floor(clean) > floor(min)` early return,
* the legacy 7-character English hyphenation wrapper.

Together these produced the reported symptom: the solver only reached for hyphens at the minimum bucket, and large bubbles could not expand the text to the contour.

#### 3.2 Frame vs contour bounding box
Several callers passed only a contour and let the solver derive its frame from the contour bounding box. Because `BubbleLayoutService` had already translated contours into box-local space, the whole-chamber adapter then applied a second 4 px inset — an 8 px drift between acceptance measurement and paint. Studio had the same class of problem: its frame is the authored box, not the polygon bounds.

#### 3.3 Dictionary readiness cache defect
A hyphenation lookup performed before the dictionary finished loading cached its empty result permanently, so the first edit after a cold start never hyphenated.

#### 3.4 Studio OCR precomputation
Studio OCR precomputed contour layouts for every region, including Auto Balloon boxes. Those boxes must keep their OCR font size and defer layout to Studio, so the precomputation was both wrong and wasted work.

#### 3.5 Painting reconstructed spacing
The renderer recomputed line pitch from font size instead of using the solver's `positionedLines`, so a fractional/fitted layout could drift at paint time.

---

### 4. Implementation & Architecture

#### 4.1 Pure core extraction
`src/offscreen/utils/contourTypeset.ts` (1078 lines) became a compatibility facade over 11 focused modules under `src/offscreen/utils/contour/`:

| Module | Responsibility |
| --- | --- |
| `fontSearch.ts` | Eight downward probes, ten refinements, 0.01 px tolerance, LastResort policy |
| `profiles.ts` | Scanline profiles, five ink-band samples, common axis, 64-line cap, ink air |
| `lineBreaks.ts` | Profiled and uniform DP, overflow/line-count/cost ordering, cubic fallback |
| `placement.ts` | PAD1 tight ink bounds, absolute baselines, full-frame fit |
| `segments.ts` | Segment templates, mandatory/discretionary breaks, suffix advances |
| `geometry.ts` | Polygon inline spans, stem/punctuation extraction, bubble contour generation |
| `metrics.ts` | Canvas measurement adapter and provenance (`actual-ink` vs `advance-only-fallback`) |
| `numeric.ts` | `Math.fround` helpers reproducing Rust `f32` boundaries |
| `constants.ts` | Donor constants; deprecated ceiling exports now resolve to `Infinity`/no-op |
| `layout.ts` | Top-level `wrapTextContour`, frame resolution, composition |
| `types.ts` | Shared pure-core types |

#### 4.2 Donor search and policy
* Whole-word search runs first. It returns early only when `floor(cleanSize) > floor(minimum)`.
* At the minimum bucket, LastResort is evaluated and chosen only if it gains a strictly larger floor bucket.
* Inside the recovery pass, every candidate size still prefers a clean fit before a hyphenated one.
* Probe sizes, the selected size, and the painted font string remain fractional.
* The automatic maximum is the inset frame width; no implicit 48 px/word-count/percentage caps remain. Explicit authored limits still apply.

#### 4.3 Profiles, DP, and placement
* Five samples across the measured ink band are intersected to produce a line profile.
* Candidate ordering is overflow status, then line count, then penalty — including overflowing candidates.
* The uniform DP fallback keeps multiple lines and reports overflow rather than fabricating one contained line.
* Placement uses PAD1 around actual ink bounds and absolute alphabetic baselines.

#### 4.4 Hyphenation
* Exact hypher 0.1.8 trie payloads for all 48 supported languages were copied into `hyphenation/hypherData/` with their upstream notices; each language is a separate dynamic-import chunk.
* Contour eligibility uses a five-scalar alphabetic core with compact two-character fragment bounds. It does **not** inherit the legacy seven-character English wrapper.
* Break opportunities come from a UAX #14 adapter (`linebreak@1.1.0`). This is the same responsibility as the donor's ICU4X locale-tailored segmenter, not an identical dependency; injected opportunities bypass the adapter.
* Dictionary loading now primes legacy Liang and contour trie caches independently, and any successful load invalidates word-level memoization so a pre-load empty lookup cannot persist.

#### 4.5 Adapter isolation
* `utils/contourFrame.ts` owns the whole-chamber 4 px descriptor inset. Only callers that pass an un-inset chamber use it.
* `ContourDpTypesetter`, `SimpleRectTypesetter`, Studio contour reflow, and `precomputeStudioOcrLayouts` pass an explicit frame to the pure solver directly, because their contours are already frame-local.
* Pipeline acceptance measurement and final painting now receive the same frame (`PipelineOrchestrator` forwards `{ width: proposed.w, height: proposed.h }`; `canvasTypesetting` derives the frame from edge midpoints instead of the contour bbox).
* Studio OCR uses the canonical `TypesetStrategyFactory`, preloads the selected font faces and one dictionary, and only precomputes accepted fixed (`contour`/`simple`) horizontal regions.
* `TextRenderer` paints the solver's `baseline` with `textBaseline = 'alphabetic'` when present, and falls back to ink-top placement otherwise.
* Persisted objects keep fractional sizes and `positionedLines`; a new `useLayoutReadiness` retries only layouts generated while fonts/dictionaries were pending, and never resets persisted lines, moves, selections, edits, or undo.

---

### 5. Roadblocks & Decisions

1. **No Rust/Cargo on the host.** Donor execution was impossible, so the tests are source-derived TypeScript checks against pinned donor semantics. They are explicitly **not** described as an executed Rust oracle; live differential parity remains unproven. A pinned test-only oracle in CI is the correct follow-up.
2. **Canvas shaping vs HarfRust/skrifa.** Exact glyph advances and ink bounds cannot be reproduced through Canvas 2D. The measurement adapter is isolated in `metrics.ts`, and results tag their provenance. Width-only mocks report `advance-only-fallback` rather than claiming ink parity.
3. **Unusable frames now return `null`.** The pure solver's contract changed from "always a result" to "null when the resolved frame has no positive area". This is fail-fast at the boundary instead of a silent empty layout; all adapters null-check.
4. **Legacy routes untouched.** XianScan/Auto Balloon keep their four-pass fitter and Liang hyphenation. Only shared dictionary-cache correctness crosses the boundary.
5. **Honest acceptance.** The visual harness now transcribes `UNDERSTOOD!` without pre-inserted hyphens, because the old `UN-DER-STOOD!` was not evidence of automatic hyphenation.

---

### 6. Testing & Verification
* `npm test`: **1255 tests, 114 files, all passing.**
* `npx tsc -b` and `npm run build`: green.
* `npm run lint`: 0 errors (75 pre-existing warnings).
* New/updated suites cover: eight-probe search and 0.01 px refinement; clean-above-minimum retention; minimum-bucket recovery; fractional sizes; 64-line cap; DP overflow/line-count/cost ordering; uniform fallback; PAD1 baselines; f32 boundaries; five-character eligibility and fragment bounds; multilingual hypher vectors; dictionary pre-load lookup then successful load; Studio frame propagation without double inset; zero-area frames returning `null`.
* `npm run test:visual:koharu` renders `image6_koharu_exact.png` and writes `image6_koharu_exact.json` with the donor commit, source/font SHA-256, and each block's input, resolved strategy, lines, size, and placements. A clean runner exit is still not full-page visual parity.
* Controlled browser checks compared backend and Studio output for the reinforcements, `TEACHER`, `DANGEROUS`, and `UNDERSTOOD!` fixtures.

---

### 7. Next Steps / Key Takeaways
1. Open the PR, run CI, and merge once the diff review passes.
2. Visually inspect `image6_koharu_exact.png` plus the JSON sidecar; some regions can still fall back to Auto Balloon after geometry rejection, so attribute visible hyphens only after checking the recorded strategy.
3. Add a pinned Rust oracle to CI if a toolchain becomes available; until then, do not call the source-derived tests differential proof.
4. Key lesson: naming a constant "donor" does not make it a port. Caps, rounded probes, and `>=` comparisons were invisible until the donor predicates were translated line by line — and the frame/contour distinction mattered as much as the search itself.
