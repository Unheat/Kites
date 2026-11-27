# Route 1: Auto Balloon typesetting

## 1. Overview & Current Scope

**Current-code audit: 2026-10-28, cumulative `origin/main..main` through `656d720`.** Earlier descriptions of this route described an exact ellipse-chord solver and a 9px floor. Those descriptions are superseded by the implementation below. Reference-derived algorithms do not establish end-to-end pixel parity.

Auto Balloon is the free-region route used by the Western default renderer when no accepted `typesetBox` is available. `TypesetMode` includes `balloon` and `auto-balloon` as aliases, plus `contour` and `simple`; `ellipse` is retired and normalized to `contour` when restoring old Studio records.

- Strategy: `src/offscreen/engines/typeset/AutoBalloonTypesetter.ts`.
- Shared fitting, wrapping and measurement cache: `src/offscreen/utils/typesetLayout.ts`.
- Strategy selection: `src/offscreen/engines/typeset/TypesetStrategyFactory.ts`.
- Fit verification and region resizing: `src/offscreen/utils/renderer/regionGeometry.ts`.

`TypesetStrategyFactory.resolve()` chooses Contour DP first for a fixed region with a contour, explicit contour mode, or rounded geometry unless explicitly simple. A fixed simple region without contour selects Simple Rect. Everything else selects Auto Balloon. This is not selection solely by the mode label.

## 2. Measurement & Geometry

`measureDefaultLayout()` sanitizes and compacts text, then calls `fitFontSizeWithLines()` with a 5% inset and an upper bound of:

$$S_{max}=\text{maxFontSizeCap or }48$$

The cap is the caller's ceiling, not the current size: a fit already at 59px can grow when the caller allows 120px. The shared fitter uses rectangular usable dimensions `max(10, dimension * 0.90)`, `fontSpec()` and a per-font measurement cache. Its lower probe bound is `MIN_FONT_SIZE = 6`, not a guaranteed 9px or 14px floor. The strategy passes `options.minFontSize ?? 14` as the requested/start size; that argument does not replace the shared fitter's 6px lower bound.

Balanced wrapping can form a diamond-like stanza, but the current strategy does **not** implement the previously documented per-line ellipse chord equation or golden-aspect cost formula. Those formulas were design descriptions, not this route's current acceptance predicate.

## 3. Four Fitting Passes

1. **Clean binary search:** Prefer whole-word layouts. Require each measured line to fit usable width (0.5px tolerance), total height to fit using `LINE_HEIGHT = 1.2`, and no newly inserted hyphen breaks.
2. **Tall-narrow floor search:** For usable `H/W >= 2`, probe a geometric size derived from width and area, bounded by the caller's ceiling. This is a candidate improvement search, not a blanket height-based ceiling.
3. **Vertical-fill hyphenation:** If clean fitting fails or remains below 14px and the tall-box threshold is met, scan downward from a bounded candidate ceiling with discretionary hyphenation.
4. **Fallback binary search:** Retry reflow under the width/height predicate. If no larger fit exists, retain the initialized 6px wrapped layout.

`AutoBalloonTypesetter.typeset()` returns the measured lines and reports `overflowed` using `defaultLayoutFits()`. A nonempty result is not proof of containment; the final renderer does not universally reject every result marked overflowed.

## 4. Hyphenation & Script Routing

`findHyphenationPoints()` routes every language with a vendored hypher trie (45 languages: the Latin/Cyrillic set, the Indic scripts, Turkish, Finnish, ...) through the curated TeX patterns with the language's hypher bounds — byte-identical to the contour route, so a word splits the same no matter which engine renders the bubble. Legacy Liang dictionaries survive only for the three languages with no trie data (Indonesian, Malay, Romanian; `id_ID.txt`/`ro_RO.txt` under `public/assets/hyphenation/`), and the `syllableRules.ts` akshara/vowel rules cover Nepali, Azerbaijani and Uzbek without any data. The comic-lettering length gates (6-letter minimum, 64-character maximum) apply on the trie path exactly as on the dictionary path. Long-word logic also uses the seven-character stem gate and measured discretionary-hyphen suffixes. Shared typography helpers heal typesetter-inserted hyphens before Studio reflow so resizing does not turn temporary syllable breaks into canonical dialogue.

Non-Western output routing belongs to `renderTextBlocksBatch()` in `canvasTypesetting.ts`, not to a failed Auto Balloon strategy. The batch dispatcher selects the legacy orientation-aware path by target language; it does not wait for this strategy to fail.

## 5. Live Bake vs Studio Edits

The live free-region renderer can resize/decollide OCR quads and cap short non-scream text relative to the page dialogue median before invoking this strategy. Fixed bubble layouts bypass those movement operations. Studio Auto Balloon reuses `measureDefaultLayout()` but supplies its own ceiling and style adapter. Studio contour and simple editing are separate branches; their behavior must not be inferred from Auto Balloon's four passes.

For font readiness, final Canvas drawing and persistence caveats, see [Cotrans renderer](cotrans-default-renderer.md) and [Studio architecture](studio-and-typesetting.md).
