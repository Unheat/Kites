# Devlog 059: Verbatim Typesetting Casing and Unicase Script Preservation

### 1. Metadata
* **Date:** 2026-10-25
* **Feature/Task:** Verbatim Typesetting Casing, Eliminating Forced Comic Lettering Uppercase & Protecting Natural Sentence Case
* **Status:** Completed
* **Branch:** `fix/verbatim-typeset-casing-sentence-case`

### 2. The Objective (The "Why")
When translating manga from unicase source languages (such as Chinese or Japanese) into bicameral target languages (such as English), machine translation engines (Google Translate, DeepL, LLMs) naturally output clean sentence case (e.g. `"There is no other way to win!"`).

However, in Phase 58 (commit `a19220a`), `formatComicLetteringCasing` was injected into `canvasTypesetting.ts` and `cotransDefaultRenderer.ts`. This forcibly uppercased all text rendered with comic font presets and mapped internal "I" characters to lowercase "i" under the assumption of traditional print scanlation conventions. When the target browser lacks locally installed comic fonts (e.g., `CC Wild Words`) and falls back to standard system `sans-serif` (Arial), this created jarring dotted "i" visual artifacts in the middle of words (e.g. `"THERE iS NO OTHER WAY TO WiN!"`, `"REiNFOR-CEMENTS!"`, `"iT'S"`).

Furthermore, forced uppercase degraded readability and posed typography hazards for languages with stacked diacritics (such as Vietnamese) or grammatical noun capitalization (German). The objective was to eliminate forced uppercase transformation in the typesetting rendering layer, aligning with the donor standard (Cotrans and Koharu) where MT output is rendered 100% verbatim.

### 3. Implementation Steps (The "How")

1. **Remove Forced Comic Uppercase from Typesetters:**
   - In `src/offscreen/utils/canvasTypesetting.ts`, removed `formatComicLetteringCasing` and `isComicLetteringFont` from the `renderTextBlocksDefault` layout pipeline.
   - In `src/offscreen/utils/cotransDefaultRenderer.ts`, removed `formatComicLetteringCasing` from `measureDefaultLayout`.
   - Restored verbatim measurement and layout using clean text directly from the translation stage.

2. **Align with Donor Standards:**
   - Both Cotrans (`scratches/reference/cotrans-2023`) and Koharu (`scratches/reference/koharu`) render translated text verbatim without uppercase mutations unless explicitly requested. Koharu previously reverted forced uppercase (commit `1afef774`) because of similar typography regressions.

3. **Preserve Language Boundaries Across All 54 Supported Languages:**
   - **Unicase Sources (CJK, Arabic, Hebrew, Hindi, Thai):** Fast-pathed in Pre-MT and Post-MT normalization; translation output is rendered verbatim in natural sentence case.
   - **Bicameral Sources (English scanlations in 100% ALL-CAPS):** Pre-MT normalization in `TranslationManager` still converts $\ge 70\%$ all-caps dialogue into sentence case to prevent NMT Frankenstein casing projection bugs.
   - **Renderer Layer:** Passive and verbatim across all scripts and fonts.

4. **Update Unit Tests:**
   - Updated `src/offscreen/utils/cotransDefaultRenderer.test.ts` to assert that `measureDefaultLayout` preserves verbatim casing across any font family.

### 4. Verification
* **Test Suite:** All 92 test files and 996 unit tests passed (`npm test`).
* **Production Build:** Vite production build completed with zero errors (`npm run build`).
