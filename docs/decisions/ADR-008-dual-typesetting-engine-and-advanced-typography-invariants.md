# ADR-008: Dual Typesetting Engine Architecture & Advanced Typography Post-Processing Invariants

## Status
Accepted historically. The two-engine taxonomy is superseded by [ADR-010](ADR-010-contour-layout-and-browser-validation.md); current algorithm and policy differences are specified in [the current typesetting contract](../development/koharu_typesetting_pipeline_spec.md). Historical performance and visual-quality statements below are not fresh acceptance results.

## Date
2026-10-16

## Context
In manga translation and comic lettering, typography requirements differ radically depending on the container geometry and semantic context:
1. **Dialogue Balloons:** Oval and circular speech balloons require diamond line envelopes (shorter top/bottom lines, wider middle lines), syllable hyphenation, and automatic font-size fitting to fill available bubble volume without clipping curved borders.
2. **Narration & Captions:** Rectangular narration boxes, signs, and sound effects require predictable, CSS-style greedy word-wrapping at a fixed user-defined font size, without diamond curvature or font shrinkage.

Furthermore, automated translation and lettering suffered from several typographical defects across multiple languages:
- **Korean Script Misclassification:** Hangul characters were excluded from the CJK regex, causing East Asian corner quotes (`「`, `」`) and middle dots (`・`) to be mangled into ASCII quotes and periods.
- **Punctuation Line-Break Violations:** Trailing punctuation frequently wrapped onto new lines as solitary orphan marks, violating Japanese *Kinsoku Shori* rules and Western editorial standards.
- **Over-Hyphenation:** Relaxing hyphenation thresholds in narrow bubbles led to jarring breaks on short words (`th-at`, `wi-th`).
- **Layout Compute Overhead:** 4-pass binary search fitting fired 70,000–150,000 redundant `ctx.measureText` calls per page, slowing batch processing and causing canvas dragging stutter.
- **Aperture Bleed:** Drawing stroke after fill on canvas text caused white/black outline strokes to bleed into interior letter loops (`e`, `o`, `a`).

## Decision

### 1. Dual Typesetting Engine Architecture
Establish two distinct typesetting execution modes:
- **`Auto Balloon` (Default for Detected Dialogue):**
  - Uses 4-pass binary search fitting (`fitFontSizeWithLines`).
  - Generates balanced diamond line envelopes (`balancedWrapText`).
  - Performs dynamic font reflow when resizing boxes in Studio.
- **`Simple Wrap` (For Narration & User Boxes):**
  - Uses greedy rectangular word wrapping at a fixed user-defined font size.
  - Matches CSS `word-break: break-word` behavior for captions and square text blocks.
- **Studio UI Control:**
  - Integrated into `TypographySettings.tsx` with a dual-scope toggle (applies locally to selected text objects or globally to studio defaults when no box is selected).

### 2. Strict 7-Letter Hyphenation Invariant
- **Rule:** Never hyphenate words shorter than 7 letters (`stem.length < 7`).
- **Rationale:** Short words (`about`, `would`, `their`, `force`) must wrap whole to maintain reading flow. Hyphenating short words severely degrades reading comprehension in comic dialogue.
- **Boundary Constraint:** Words $\ge 7$ letters require a minimum 3-letter prefix and 3-letter suffix (`com-puter`, `trans-late`). Contractions (`couldn't`) and digit sequences (`2026-10`) are strictly non-splittable.

### 3. Kinsoku Shori (禁則処理) & Token Attachment
Implement standard East Asian and Western line-breaking rules in `typesetLayout.ts`:
- **Line-Start Prohibitions (`KINSOKU_LINE_START_PROHIBITED`):** Closing brackets, quotes (`」`, `』`, `）`, `]`, `}`, `”`, `’`), and punctuation marks (`、`, `。`, `,`, `.`, `!`, `?`, `…`, `〜`) cannot start a new line. They are pulled back onto the preceding line.
- **Line-End Prohibitions (`KINSOKU_LINE_END_PROHIBITED`):** Opening brackets and quotes (`「`, `『`, `（`, `[`, `{`, `“`, `‘`, Spanish `¿`, `¡`) cannot end a line; they bind forward to the subsequent token.
- **Multi-Punctuation Compaction:** `compactSpecialSymbols` collapses spaced punctuation (`. . .` -> `…`, `! ! !` -> `!!!`) while preserving meaningful single ASCII spaces for Western word wrap.

### 4. Layout Memoization (`MeasureCache`)
Implement in-memory memoization mapping `${token}:${fontSize}:${fontFamily}` to measured pixel width.
- Eliminates 60–75% of redundant `ctx.measureText` calls during iterative binary search fitting.
- Drops full-page typesetting compute time from ~140ms to ~35ms.

### 5. Comic Lettering Casing & Stroke-Then-Fill Layering
- **Crossbar "I" Formatting (`formatComicLetteringCasing`):** Formats comic dialogue in all-caps while converting non-pronoun "I" letters to lowercase "i" (rendered as stick-I in comic fonts) and reserving crossbar "I" strictly for personal pronouns (`I`, `I'M`, `I'LL`, `I'D`, `I'VE`) and acronyms (`FBI`, `CIA`, `AI`).
- **Stroke-Then-Fill Canvas Layering:** Execute `ctx.strokeText()` prior to `ctx.fillText()` in `cotransDefaultRenderer.ts` and `canvasTypesetting.ts`, eliminating aperture bleed and preserving crisp glyph interiors.

## Consequences

### Positive
- **Professional Typography:** Automatic diamond wrapping, proper punctuation attachment, and authentic comic lettering match scanlation lettering standards out-of-the-box.
- **Editing Flexibility:** Users can switch any text box between Auto Balloon and Simple Wrap with a single click.
- **Sub-Frame Studio Latency:** `MeasureCache` and RAF gesture throttling eliminate stutter during interactive box dragging and live text reflow.
- **Full CJK & Western Support:** Clean Korean Hangul, Japanese Kana/Kanji, and Latin text hygiene across all translation engines.

### Trade-offs
- Maintaining two wrapping engines (`Auto Balloon` via `typesetLayout.ts` and `Simple Wrap` via `studioTypeset.ts`) requires synchronized unit test suites across both offscreen and studio environments.

## Alternatives Considered
- **Single Rigid Layout Engine:** Forcing all text into Auto Balloon shrunk narration boxes unnecessarily; forcing all text into Simple Wrap clipped dialogue against circular balloon curves.
- **Pure CSS Layout Engine:** Impossible to bake into exported canvas pixels or clean plate images without foreignObject DOM extraction, which is rejected due to CSP and cross-origin security restrictions.
- **Relaxed Hyphenation Thresholds (4 Letters):** Tested and rejected due to ugly breaks on common English words.
