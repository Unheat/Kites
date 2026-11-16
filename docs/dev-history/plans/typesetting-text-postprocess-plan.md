# Typesetting and Text Post-Processing Improvement Plan

Date: 2026-10-16  
Status: Proposed implementation plan; active co-authoring draft.  
Branch: `feat/typesetting-text-postprocess-improvements` (worktree `../Kites-typesetting`, branched from `main`).

---

## 1. Scope, Architecture & Boundaries

### 1.1 Outcome and Objectives
Elevate Kites text post-processing, line wrapping, and typography rendering to commercial scanlation quality across all supported language pairs, while reducing binary search typesetting compute by 60–75%.

Key deliverables:
1. **Script Hygiene & Sanitization**: Complete Korean (Hangul) script protection, preserve Katakana middle dots in mixed text, and compact multi-punctuation runs.
2. **Kinsoku Shori & Token Protection**: Prevent punctuation at line start, bind opening marks forward (Spanish `¿`, `¡`, brackets, quotes), and keep multi-punctuation attached to words.
3. **Hyphenation & Reflow Hardening**: Prevent contraction breaks (`could-n't`), prevent number breaks (`1000-0000`), fix premature paragraph splits on short LLM lines, and handle narrow vertical bubble overflow.
4. **Comic Lettering & Stroke Layering**: Crossbar "I" convention for comic font presets and clean stroke-then-fill canvas layering to eliminate aperture bleed.
5. **Typesetting Memoization**: In-memory token measurement cache to eliminate 70,000–150,000 redundant `ctx.measureText` calls per page.

### 1.2 Pipeline Architecture & Data Flow
The typesetting pipeline operates in three distinct stages:

```text
[Raw Translation String]
         │
         ▼
[1. Text Sanitization (textCleaning.ts)]
   - Strip markdown, normalize quotes, compact symbols, script detection
         │
         ▼
[2. Layout & Typography Engine (typesetLayout.ts)]
   - fitFontSizeWithLines (4-pass search with memoized measureText)
   - balancedWrapText (diamond envelope, Kinsoku Shori, hyphenation)
         │
         ▼
[3. Canvas Text Rendering (cotransDefaultRenderer.ts / canvasTypesetting.ts)]
   - Affine matrix transformation, stroke-then-fill layering, WCAG color sampling
```

### 1.3 Strict Worktree & Ownership Boundaries
To prevent conflicts with parallel active branches (notably `feat/reader-studio-runtime-improvements`):

* **Files Owned by this Branch (`feat/typesetting-text-postprocess-improvements`)**:
  * `src/shared/utils/textCleaning.ts`
  * `src/offscreen/utils/typesetLayout.ts`
  * `src/offscreen/utils/cotransDefaultRenderer.ts`
  * `src/offscreen/utils/canvasTypesetting.ts`
  * `src/test/typesetLayout.test.ts`
  * `src/test/textCleaning.test.ts`
* **Files Strictly Excluded (Owned by Studio / Runtime Agent)**:
  * `src/studio/canvas/StudioCanvas.tsx` (Owns pointer-event throttling via RAF, gesture lifecycle, handle hit testing)
  * `src/studio/canvas/TextRenderer.ts` (Owns Studio line-cache normalization)
  * `src/studio/bridge/offscreenStudioBridge.ts` (Owns Studio RPC font size passthrough)
  * `src/content/*`, `src/popup/*`, `src/offscreen/services/*` (Owns reader UI, ZIP export, tensor cleanup)

### 1.4 Core Invariants & Architectural Constraints
1. **Preserve Cotrans / XianScan Hybrid Boundary**: Cotrans owns all block grouping and merging; XianScan owns input hygiene and layout mathematics. Splitting is strictly post-merge.
2. **Preserve Polygon-Only Inpaint Contract**: Typesetting changes must never modify OCR polygon masks or inpainting buffers.
3. **Live Auto-Fitting Invariant**: Text must always fit and balance automatically based on bounding geometry; never bypass mathematical fitting in favor of static defaults.

---

## 2. Text Post-Processing & Script Normalization

### 2.1 Korean (Hangul) Script Classification Fix
* **Current Defect**: `CJK_SCRIPT_REGEX` (`src/shared/utils/textCleaning.ts:9`) only matches Han, Hiragana, and Katakana ranges `[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]`. It omits Hangul syllables (`\uac00-\ud7af`), Hangul Jamo (`\u1100-\u11ff`), and Compatibility Jamo (`\u3130-\u318f`).
* **Root Cause & Impact**: Korean translations take the non-CJK branch in `sanitizeTypesetText` (`:345`). Korean quotation marks `「` and `」` are erroneously replaced with ASCII `"`, and Korean interpuncts `・` are converted to periods `.`.
* **Fix**:
  1. Update `CJK_SCRIPT_REGEX` to include Hangul Unicode blocks:
     ```ts
     export const CJK_SCRIPT_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;
     ```
  2. In `sanitizeTypesetText`, ensure Korean text preserves East Asian corner quotes (`「`, `」`) and interpuncts (`・`).

### 2.2 Middle Dot (`・`) Preservation in Mixed & Transliterated Text
* **Current Defect**: `sanitizeTypesetText` (`src/shared/utils/textCleaning.ts:348`) replaces `[．。﹒・]` with ASCII `.`.
* **Impact**: In manga dialogue, katakana foreign names and transliterations frequently employ the Japanese middle dot `・` (U+30FB) as a word separator (e.g., `ジョン・スミス` or `モンキー・D・ルフィ`). Converting this to `.` destroys the typography, turning names into pseudo-domain names (`ジョン.スミス`).
* **Fix**: Remove `・` from the period replacement list. Only convert true full-width ideographic period marks:
  ```ts
  out = out.replace(/[．。﹒]/g, '.');
  ```
  Preserve `・` (U+30FB) and bullet `•` (U+2022) as legitimate name separators across all scripts.

### 2.3 Robust Multicharacter Punctuation Compaction
* **Current Defect**: `compactSpecialSymbols` (`src/offscreen/utils/cotransDefaultRenderer.ts:125`) only runs `.replace(/([!?~])\s+([!?~])/g, '$1$2')` twice on ASCII marks. A sequence of 4 spaced marks (`! ! ! !`) leaves internal spaces (`!! !`), and full-width manga marks (`！？～`) are ignored entirely.
* **Fix**: Centralize `compactSpecialSymbols` into `src/shared/utils/textCleaning.ts` and use lookahead regexes covering both ASCII and full-width marks:
  ```ts
  export function compactSpecialSymbols(text: string): string {
    return text
      // Compact spaced single-dot ellipses like ". . ." or ". . . ."
      .replace(/(?:\.\s+){2,}\./g, '...')
      // Compact spaced exclamation, question, and tilde marks (ASCII + CJK)
      .replace(/([!?~！？～])\s+(?=[!?~！？～])/g, '$1')
      // Compact spaced horizontal ellipses and multi-dot runs
      .replace(/(\.{2,}|…)\s+(?=\.{2,}|…)/g, '$1');
  }
  ```

### 2.4 Punctuation Debris & String Replace Bug
* **Current Defect**: In `src/offscreen/utils/canvasTypesetting.ts:96` (`segEng`), string literal replacement is used:
  ```ts
  text = text.replace('  ', ' ').replace(' .', '.').replace(/\n/g, ' ');
  ```
  This only cleans the *very first* double space and spaced period in an entire text block.
* **Fix**: Replace with global regex patterns:
  ```ts
  text = text.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?:;])/g, '$1').replace(/\n/g, ' ');
  ```

### 2.5 Unified Pipeline Sanitization
* **Current Defect**: `cotransDefaultRenderer.ts:706` invokes `sanitizeTypesetText`, but Pass 1 free-box measurement in `canvasTypesetting.ts:641` passes raw unsanitized text.
* **Fix**: Call `sanitizeTypesetText` once at the entry of both `renderRegionDefault` and `renderTextBlocksBatch`, guaranteeing that measurement and rendering always operate on identical strings.

---

## 3. Line Breaking, Punctuation Protection & Kinsoku Shori

### 3.1 Orphan Punctuation Line Elimination
* **Current Defect**: In `src/offscreen/utils/typesetLayout.ts:272-277` and `316-324`, `wrapText` strips trailing punctuation runs from words (e.g., `What?!` $\to$ `['What', '?!']`). If adding `'?!'` exceeds the line width threshold ($1.15 \times \text{maxWidth}$), it pushes `'?!'` as a standalone line.
* **Typesetting Standard**: Punctuation must never wrap to a new line without its accompanying word stem. A line consisting solely of `?!` or `...` is a severe typesetting defect.
* **Fix**:
  1. Treat words and their trailing punctuation as an indivisible atomic token during candidate line measurement.
  2. If the combined token exceeds the current line's remaining width, push the *entire* word-punctuation unit to the next line.
  3. If the combined token exceeds the total `maxWidth`, permit an emergency break only within the word stem, keeping trailing punctuation firmly glued to the final word fragment.

### 3.2 Kinsoku Shori (Prohibited Line-Head Punctuation)
* **Current Defect**: When translating into Japanese, Chinese, or Western languages, closing punctuation marks (`。`, `、`, `！`, `？`, `…`, `ー`, `)`) can land at index 0 of a newly wrapped line.
* **Fix**: Introduce strict line-start prohibition in `typesetLayout.ts`:
  ```ts
  const NO_LINE_START_RE = /^[.,!?:;…\-—―–ー－～)」』】》〉，、。：；！？]/;
  ```
  If wrapping produces a line beginning with any character matching `NO_LINE_START_RE`:
  - **Deterministic Rule 1 (Pull-Back)**: If `previousLine.width + char.width <= maxWidth + char.width` (standard typography margin-overflow allowance), pull the character back to the end of the previous line.
  - **Deterministic Rule 2 (Pull-Down Fallback)**: Otherwise, pull the preceding token from the previous line down to join the punctuation at the start of the new line.

### 3.3 Forward Binding for Opening Marks
* **Current Defect**: In Spanish (`¿`, `¡`), French (`«`), and bracketed dialogue (`(`, `[`, `{`, `“`, `「`), opening punctuation can wrap to the end of a line, separated from the word it introduces.
* **Fix**: Implement opening mark forward binding:
  ```ts
  const OPENING_MARK_RE = /^[¡¿([{«‹‘‚‛“„‟〈《「『【〔〖（［｛]/;
  ```
  When scanning tokens, any token matching `OPENING_MARK_RE` binds directly forward to the immediate next word token without an inserted space (e.g. `¿Qué` remains bound as an indivisible unit `¿Qué`). Line breaking will never place a break between an opening mark and its trailing word.

### 3.4 Soft-Break Normalization for LLM Translation Outputs
* **Current Defect**: `isHardLineBreak` (`src/offscreen/utils/typesetLayout.ts:388`) contains an overly aggressive heuristic:
  ```ts
  const prevWords = prev.split(/\s+/);
  if (prevWords.length <= 4 && prev.length <= 30 && !/[,，;；\-\/]$/.test(prev)) return true;
  ```
  LLMs frequently return short, poetic, or multi-line translations (e.g., `"I wanted to\ngo home"`). Because line 1 has $\le 4$ words and no trailing comma, this heuristic marks it as a permanent paragraph break. `reflowText` refuses to join them, locking the text into two jagged lines.
* **Fix**: Refine `isHardLineBreak` so that soft newlines from LLMs reflow naturally:
  - Require true terminal punctuation (`[.!?…:;。！？]`) or an explicit empty line (`\n\n`) to qualify as a hard paragraph break.
  - In the absence of terminal punctuation, treat single newlines as soft formatting spaces, allowing `reflowText` and `balancedWrapText` to compute the optimal multi-line diamond shape.

### 3.5 Hyphenation Hardening
1. **Contractions**:
   - In `findHyphenationPoints` (`typesetLayout.ts:114`), Rule 5 (VC-CV) treats apostrophe `'` as a consonant. This results in hyphenating contractions like `could-n't` or `couldn'-t`.
   - *Fix*: Explicitly exclude `'` and `’` from the consonant character set in syllable and morphology analysis.
2. **Numeric Strings**:
   - In `breakLongWord`, pure numbers (e.g. `10000000`) fall back to character breaking with inserted hyphens (`1000-0000`).
   - *Fix*: Do not hyphenate numeric strings (`/^\d+$/`). If a number overflows a bubble, scale font size down rather than inserting false hyphens.
3. **Locked 7-Letter Stem Protection Invariant**:
   - In accordance with standard English typography and reference engines (Cotrans/XianScan), words shorter than 7 letters must **never** be broken or hyphenated (`stem.length < 7` returns `{ head: [], tail: word }`).
   - Relaxing this rule to $\ge 4$ characters was evaluated and rejected: lowering the stem threshold causes short words (`know`, `never`, `force`) to be diced into 2-letter fragments (`kn-ow!`, `ne-ver`, `fo-rce`), fooling the binary search into picking overly large font sizes and creating barcode-like line splits.
   - Keeping the strict 7-letter invariant forces the binary search to select a proper readable font size that keeps words whole on their own lines.

### 3.6 Notch Depth & Elliptical Balance Scoring
* **Enhancement**: Replace purely rectangular line-count balancing with organic comic balloon profiling.
* **Implementation**:
  During `balancedWrapText`, score candidate line configurations using the notch depth metric:
  $$\text{notchDepth} = \max\left(0, \min(w_{i-1}, w_{i+1}) - w_i - 0.05 \cdot w_{\max}\right)$$
  Penalize configurations where an intermediate line $w_i$ dents inward compared to surrounding lines. Prefer balanced diamond envelopes ($w_1 < w_2 > w_3$) that fit naturally into oval speech bubbles without clipping bubble perimeters.

---

## 4. Comic Lettering Conventions & Canvas Rendering Mechanics

### 4.1 Crossbar "I" Comic Lettering Rule
* **Industry Standard**: In comic scanlation and lettering, the uppercase serif "I" (with top and bottom horizontal crossbars) is strictly reserved for:
  1. The personal pronoun "I" (`I`).
  2. Contractions of the pronoun "I" (`I'M`, `I'LL`, `I'D`, `I'VE`).
  3. Acronyms and initialisms pronounced as letters (`FBI`, `CIA`, `AI`, `UFO`, `DNA`).
  All other occurrences of uppercase "I" inside words (`IT`, `IN`, `THIS`, `KILL`, `WILL`, `IMPOSSIBLE`) must use the straight vertical "stick I" without crossbars.
* **Font Mapping Reality**: Comic fonts (such as *CC Wild Words* and *Anime Ace*) map lowercase `i` to the straight stick glyph, and uppercase `I` to the crossbar glyph.
* **Implementation**:
  Add `formatComicLetteringCasing(text: string, isComicFont: boolean): string` in `src/shared/utils/textCleaning.ts`:
  ```ts
  export function isComicLetteringFont(fontFamily: string): boolean {
    return /wild\s*words|anime\s*ace|comic\s*neue|comic\s*sans|bangers/i.test(fontFamily);
  }

  export function formatComicLetteringCasing(text: string, isComicFont: boolean): string {
    if (!isComicFont) return text;
    // Step 1: Standard uppercase conversion for comic dialogue
    let upper = text.toUpperCase();
    // Step 2: Replace internal stick 'I' with 'i', protecting pronoun 'I', contractions, and acronyms
    return upper.replace(/\bI\b(?=['’]?(?:M|LL|D|VE)?\b)/g, '§PRONOUN_I§')
      .replace(/\b(?:FBI|CIA|AI|UFO|DNA|VIP|ID)\b/g, (match) => match.replace(/I/g, '§PRONOUN_I§'))
      .replace(/I/g, 'i')
      .replace(/§PRONOUN_I§/g, 'I');
  }
  ```
  This transformation is activated only when `isComicLetteringFont(fontFamily)` evaluates to true.

### 4.2 Canvas Stroke Inward-Bleed Elimination
* **Current Defect**: Standard `ctx.strokeText()` centers the stroke outline on the glyph vector path. For strokes $> 2\text{px}$, half the stroke bleeds inward, filling in the delicate apertures (counter-spaces) of characters like `e`, `a`, `o`, `s`, and `&`.
* **Fix**:
  1. Configure context stroke joints:
     ```ts
     ctx.lineJoin = 'round';
     ctx.miterLimit = 2;
     ```
  2. Enforce strict two-pass rendering:
     - **Pass 1 (Outlines)**: Draw all background strokes for every line with `ctx.lineWidth = strokeWidth * 2`.
     - **Pass 2 (Fills)**: Draw all foreground text fills (`ctx.fillText`) over top.
  The top-layer fill cleanly occludes the inner half of the stroke, ensuring glyph centers remain crisp and open while delivering a full-strength protective halo against dark/screentone backgrounds.

### 4.3 Dead Code Elimination in `cotransDefaultRenderer.ts`
* **Audit Finding**: Lines 151–567 of `src/offscreen/utils/cotransDefaultRenderer.ts` contain ~415 lines of dormant code ported from early Cotrans Master:
  - `calcHorizontal` (lines 151–414)
  - `putTextHorizontal` (lines 422–478)
  - `putTextLines` (lines 492–540)
  - `cropToContent` (lines 546–567)
  None of these functions are imported or invoked anywhere in the codebase (`renderRegionDefault` directly renders validated lines on the affine-transformed canvas).
* **Action**: Safely remove these unused legacy functions. Migrate any valuable geometry/docstring explanations to active layout functions. Verify that `npm test` and build succeed.

---

## 5. Engine Performance & Measurement Memoization

### 5.1 The `ctx.measureText` Combinatorial Explosion
Profiling reveals an extreme bottleneck in `src/offscreen/utils/typesetLayout.ts`:
* `fitFontSizeWithLines` runs up to 4 passes.
* Each outer pass executes a binary search over font size ($\sim 6$ steps).
* Each size step invokes `reflowText` $\to$ `balancedWrapText`.
* `balancedWrapText` executes its **own inner binary search** over bounding width ($\sim 7$ steps).
* Inside every inner step, `wrapText` measures every word, candidate line, and hyphen split.

**Operation Count**:
$$\text{Calls per bubble} = 4 \times 6 \times 7 \times (\sim 20 \text{ tokens}) \approx 1,200 \text{ to } 3,500 \text{ calls}$$
For a standard manga page with 30 speech bubbles evaluated across a 2-pass layout (Pass 1 discovery + Pass 2 render), the offscreen canvas invokes `ctx.measureText` **70,000 to 150,000 times per image**.

### 5.2 Context State Thrashing
In `fitFontSizeWithLines`:
* `ctx.font = fontSpec(...)` is reassigned repeatedly across binary search iterations.
* Mutating `ctx.font` forces the browser's CSS parser to parse font strings and invalidates internal font engine caches on every step.

### 5.3 High-Performance Scoped Memoization Cache
Implement a scoped, zero-allocation measurement cache passed into the layout engine:

```ts
export interface MeasureCache {
  measure(text: string, fontSpec: string): number;
  clear(): void;
}

export function createMeasureCache(ctx: CanvasRenderingContext2D): MeasureCache {
  const map = new Map<string, number>();
  let currentFontSpec = '';

  return {
    measure(text: string, fontSpec: string): number {
      const key = `${fontSpec}\0${text}`;
      let w = map.get(key);
      if (w === undefined) {
        if (currentFontSpec !== fontSpec) {
          ctx.font = fontSpec;
          currentFontSpec = fontSpec;
        }
        w = ctx.measureText(text).width;
        map.set(key, w);
      }
      return w;
    },
    clear() {
      map.clear();
    },
  };
}
```

*Signature Propagation*: `cache?: MeasureCache` is passed as an **optional parameter** to `fitFontSizeWithLines` and `balancedWrapText`. If omitted, an internal cache instance is created on-the-fly, preserving 100% backward compatibility for all existing unit tests and callers.

### 5.4 Expected Architectural Gains
1. **60–75% Reduction in Native Calls**: Common high-frequency words (`"the"`, `"you"`, `"I"`, `"to"`, punctuation marks) are evaluated dozens of times across binary search steps; repeated lookups become near-instantaneous `Map.get()` calls.
2. **Elimination of CSS Font String Thrashing**: `ctx.font` is only reassigned when the font specification actually changes, not on every token measurement.
3. **Studio Interaction Fluidity**: When Studio resizes a text box, each frame's `recalculateBlockTypeset` invocation drops from $\sim 40\text{–}60\text{ms}$ down to $\sim 5\text{–}10\text{ms}$, ensuring the UI runs comfortably within 60 FPS budgets even before RAF coalescing.
4. **Zero Persistent Memory Leak**: The cache is allocated per layout batch (or per `fitFontSizeWithLines` call) and cleared immediately upon completion.

---

## 6. Phased Implementation, Tests & Verification Matrix

### 6.1 Phased Delivery Schedule

```text
Phase 1: Script Normalization & P0 Bug Fixes (textCleaning.ts)
  │
  ▼
Phase 2: Kinsoku Shori, Orphan Elimination & Layout Hardening (typesetLayout.ts)
  │
  ▼
Phase 3: Typesetting Performance Memoization (MeasureCache)
  │
  ▼
Phase 4: Comic Lettering Conventions & Canvas Stroke Layering (cotransDefaultRenderer.ts)
  │
  ▼
Phase 5: Automated Test Suite & Visual Gate Acceptance
```

#### Phase 1: Script Normalization & P0 Bug Fixes
* **Files**: `src/shared/utils/textCleaning.ts`, `src/offscreen/utils/canvasTypesetting.ts`.
* **Changes**:
  1. Add Hangul ranges to `CJK_SCRIPT_REGEX`.
  2. Preserve Katakana middle dot `・` in `sanitizeTypesetText`.
  3. Expand `compactSpecialSymbols` to full-width and multi-character runs.
  4. Fix single-replace literal string bug in `segEng` using global regexes.
* **Verification**: Add comprehensive unit tests in `src/test/textCleaning.test.ts`.

#### Phase 2: Kinsoku Shori, Orphan Elimination & Layout Hardening
* **Files**: `src/offscreen/utils/typesetLayout.ts`.
* **Changes**:
  1. Atomic word-punctuation token bundling (zero orphan punctuation lines).
  2. Implement `NO_LINE_START_RE` (prohibit line-initial `。、！？…ー」』】`).
  3. Implement `OPENING_MARK_RE` (bind forward `¿`, `¡`, `«`, `(`, `[`, `“`, `「`).
  4. Fix `isHardLineBreak` to reflow soft newlines from LLM translations.
  5. Exclude apostrophes (`couldn't`) and digits (`10000000`) from hyphenation rules.
  6. Add narrow-bubble ($\text{width} < 60\text{px}$) short-word fallback.
* **Verification**: Add unit tests in `src/test/typesetLayout.test.ts`.

#### Phase 3: Typesetting Performance Memoization
* **Files**: `src/offscreen/utils/typesetLayout.ts`.
* **Changes**:
  1. Implement `MeasureCache` scoped to layout execution.
  2. Integrate memoization with `fitFontSizeWithLines` and `balancedWrapText`.
  3. Cache invalidation on font specification changes.
* **Verification**: Count `ctx.measureText` calls before vs after across test fixtures; verify $\ge 60\%$ call reduction and byte-identical layout results.

#### Phase 4: Comic Lettering Conventions & Canvas Stroke Layering
* **Files**: `src/shared/utils/textCleaning.ts`, `src/offscreen/utils/cotransDefaultRenderer.ts`, `src/offscreen/utils/canvasTypesetting.ts`.
* **Changes**:
  1. Add `formatComicLetteringCasing` (Crossbar "I" convention for comic font presets).
  2. Configure `lineJoin = 'round'`, `miterLimit = 2`, and two-pass stroke-then-fill layering.
  3. Remove uncalled legacy functions (`calcHorizontal`, `putTextHorizontal`, `putTextLines`, `cropToContent`) from `cotransDefaultRenderer.ts`.
* **Verification**: Visual rendering check on comic font presets (*CC Wild Words*, *Anime Ace*).

---

### 6.2 Testing & Quality Verification Matrix

#### 1. Mandatory Backend Unit Tests (`npm test`)
In accordance with workspace testing rules (Mandatory backend unit tests):
* `src/test/textCleaning.test.ts`:
  * Korean text preserving corner quotes `「` `」` and interpunct `・`.
  * Mixed Japanese/English names preserving middle dot (`ジョン・スミス`).
  * Full-width multicharacter compaction (`！ ！ ！` $\to$ `！！！`, `? ? ?` $\to$ `???`).
  * Crossbar "I" conversion: `"I AM IT"` $\to$ `"I AM iT"`, `"I'M IN"` $\to$ `"I'M iN"`, `"FBI AGENT"` $\to$ `"FBI AGENT"`.
* `src/test/typesetLayout.test.ts`:
  * Orphan punctuation: string `"Really?!"` wrapped in narrow container must never produce `["Really", "?!"]`.
  * Kinsoku Shori: wrapping Japanese/Chinese text must never start lines with `。`, `、`, `！`, `ー`.
  * Spanish/French opening marks: `¿Cómo estás?` must bind `¿` to `Cómo`.
  * LLM soft-break reflow: `"I wanted to\ngo home"` must reflow into a balanced block without artificial line breaks.
  * Hyphenation safety: `couldn't` must not break at `'`; `10000000` must not contain hyphens.
  * Performance: Verify `MeasureCache` cuts native measurements by $\ge 60\%$.

#### 2. Manual Visual Verification Gate (`npx tsx src/test/pipelineVisualTest.ts`)
Run separately from `npm test` per [[visual-test-separate-from-npm-test]]:
* Execute: `npx tsx src/test/pipelineVisualTest.ts`
* Validate output images `src/test/result/pipeline/imageN.{png,jpg}`:
  * Image 4 (Dense Japanese speech bubbles): Zero dialogue loss, clean diamond envelopes, no clipped text.
  * Image 6 (Chinese manhua vertical bubbles): Proper multi-line wrap without single-letter slivers.
  * Image 8 (Connected horizontal dialogue): High-contrast text stroke, crisp glyph apertures without inward bleed.

#### 3. Language & Script Coverage Matrix
* **Japanese $\to$ English**: Standard manga formatting, contraction hyphenation safety, crossbar "I" rules.
* **Japanese $\to$ Spanish / French**: Opening marks (`¿`, `¡`, `«`) forward-bound.
* **Japanese $\to$ Korean**: Hangul script classification, quotes and interpunct preservation.
* **Chinese $\to$ English**: Diamond envelope balancing on vertical/horizontal speech bubbles.
* **English $\to$ Japanese / Chinese**: Kinsoku Shori line-start and line-end rules.
* **Vietnamese**: Accented Latin glyph preservation and multi-line word boundary reflow.

---

### 6.3 Non-Negotiable Constraints & Invariants
1. **Zero Merge-Stage Changes**: All changes reside in text pre-cleaning or post-merge typesetting. `src/offscreen/utils/geometry.ts` must remain at 0 changed lines.
2. **Zero Inpaint Contract Changes**: Inpainting engines continue to receive polygons only; no mask manipulation or polygon expansion changes.
3. **Zero Edits to Studio UI Files**: `StudioCanvas.tsx`, `TextRenderer.ts`, and `offscreenStudioBridge.ts` are left to the sibling branch to ensure zero merge conflicts.
4. **Clean Builds & Typing**: `npx tsc --noEmit` and `npm run build` must pass cleanly without warnings or type bypasses.
