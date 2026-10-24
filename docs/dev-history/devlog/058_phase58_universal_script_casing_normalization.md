# Devlog 058: Universal Script Casing Normalization Pipeline

### 1. Metadata
* **Date:** 2026-10-24
* **Feature/Task:** Universal Script Casing Normalization Pipeline across Bicameral and Unicase Scripts
* **Status:** Completed
* **Branch:** `feat/universal-script-casing-normalization`

### 2. The Objective (The "Why")
When translating comic scans with Western text (e.g. English scanlations traditionally lettered in 100% ALL CAPS), PaddleOCR detects all-caps Latin characters. Downstream Neural Machine Translation (NMT) decoders (such as Google Translate GTX) project source casing onto target tokens, while their sentence-initial detruecaser capitalizes only the first word. This produces broken Frankenstein casing in bicameral target languages (e.g., `"A-ARA-ARA, Trông NHƯ MẸ ĐÁNH MÓNG TAY VÀO ĐẦU HẢ?"`), whereas unicase source scripts like Japanese or Chinese naturally bypass this glitch because their glyphs have no concept of uppercase or lowercase.

The objective was to build a clean, script-agnostic normalization pipeline across all 50+ supported languages that prevents casing projection defects before MT, heals Frankenstein artifacts post-MT, and reserves comic all-caps strictly for English comic font lettering.

### 3. Current Workflow & Implementation Steps (The "How")

1. **Script-Agnostic Typography Classification (`src/shared/utils/casingNormalization.ts`)**:
   - Categorized languages and Unicode characters into **Bicameral** (Latin, Cyrillic, Greek) vs **Unicase** (CJK Han/Kana, Hangul, Arabic, Devanagari, Thai, etc.).
   - Fast-pathed unicase scripts: zero modification, zero overhead for Japanese, Chinese, and Korean.
   - Built protected set of standard initialisms and acronyms (`FBI`, `CIA`, `USA`, `DNA`, `AI`, `OK`, `TV`, `ID`, etc.) and Roman numerals (`II`, `III`, `IV`, etc.).

2. **Pre-MT Source Normalization (`normalizeSourceCasingForMt`)**:
   - Detects if source text in a bicameral script has $\ge 70\%$ uppercase letters across multiple words (all-caps comic lettering).
   - Exempts short shouts and onomatopoeia via `isOnomatopoeiaOrShout` (`KYAAA!`, `HOOO!`).
   - Normalizes all-caps dialogue into natural sentence case before dispatching to MT engines.
   - Directly eliminates the input trigger that causes NMT casing projection glitches.

3. **Post-MT Frankenstein Casing Guard (`normalizeTargetCasing`)**:
   - Inspects bicameral target language results for mixed casing defects (TitleCase or lowercase word followed by a run of $\ge 2$ consecutive all-caps words).
   - Normalizes the all-caps run to lowercase while preserving sentence-initial capitalization, protected acronyms, and leading loanword/SFX prefixes (`"A-ARA-ARA, Trông như mẹ đánh móng tay vào đầu hả?"`).

4. **Engine Orchestration Integration (`src/offscreen/services/TranslationManager.ts`)**:
   - Pre-normalizes candidate texts before entering the waterfall engine loop.
   - Post-normalizes engine results before returning to caller.

5. **LLM Prompt Hardening (`src/offscreen/engines/translation/BaseLlmTranslationEngine.ts`)**:
   - Added sentence case rule to `buildJsonMessages` system turn:
     `- Write translations using natural sentence capitalization (capitalize only sentence starts and proper nouns). Never mimic all-caps source dialogue unless the text is an onomatopoeia or shout.`

6. **Font-Aware English Comic Lettering (`src/offscreen/utils/canvasTypesetting.ts` & `cotransDefaultRenderer.ts`)**:
   - Hooked `formatComicLetteringCasing` into `measureDefaultLayout` when `isComicLetteringFont(fontFamily)` is active.
   - Preserves natural sentence case for all non-English targets (Vietnamese, French, Spanish, German, etc.) and non-comic fonts, avoiding tone mark and diacritic visual degradation.

### 4. Roadblocks & Decisions (The Pivot Points)

* **Avoid Koharu's Reverted Mistake**:
  Koharu previously attempted forcing uppercase in its renderer for all Latin text via ICU `CaseMapper`, which severely degraded non-English languages (such as Vietnamese and Turkish with diacritics and tone marks) and forced the maintainers to revert casing manipulation entirely. We avoided this pitfall by normalizing at the MT boundary and restricting renderer all-caps to English comic lettering fonts only.

* **Unicode Word Boundary Issue**:
  JavaScript regex `\b` tests ASCII `\w` vs `\W`. It treats Cyrillic, Greek, and Vietnamese accented characters as `\W`, causing `\b` word boundary matches to fail completely on non-ASCII words. We solved this cleanly by tokenizing via Unicode property escapes (`([^\p{L}\p{N}'’\-]+)`).

* **Roman Numerals vs English Pronouns**:
  An initial Roman numeral regex matched `"IM"` (from `"I'M"`), causing contractions to remain uppercase. Solved by testing English pronoun contractions (`/^I(['’](?:m|ll|d|ve))?$/i`) before Roman numeral checks and restricting Roman numerals to a strict canonical set.

### 5. Next Steps / Key Takeaways

* **Test Suite**: 23 new unit tests in `src/shared/utils/casingNormalization.test.ts`, 2 integration tests in `src/offscreen/services/TranslationManager.test.ts`, 1 font casing test in `src/offscreen/utils/cotransDefaultRenderer.test.ts`. Total test suite: 909/909 tests passing.
* **Build**: Production build succeeded with zero type errors in 1.71s.
