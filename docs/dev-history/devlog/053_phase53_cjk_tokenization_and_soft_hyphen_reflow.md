# Devlog 053: CJK Typesetting Word Segmentation and Soft Hyphen Line Reflow

## 1. Metadata

- **Date:** 2026-10-20
- **Feature/Task:** Fix CJK Font Size Collapse on Box Expansion and Clean Rejoining of Line-Break Hyphens
- **Branch:** `fix/cjk-fitting-collapse-and-hyphen-reflow`
- **Status:** Completed & Verified (867 tests passing)

---

## 2. The Objective

Resolve two critical typography defects discovered during Studio interactive text box resizing:

1. **CJK Font Size Collapse (The 14px Snap):**
   In speech bubbles containing continuous Chinese or Japanese text without spaces (e.g. `也感谢您今天来到我们这里， BABYBOY`), slightly expanding the box horizontally caused the font size to suddenly collapse from large readable text (38px–45px across 4 lines) down to tiny 14px–15px text (squeezed onto 2 lines), leaving the speech bubble mostly empty.
2. **Soft Hyphen Baking on Box Widening:**
   When an English word (e.g. `community`) was broken across lines by the pipeline's hyphenator (`com-\nmunity`), expanding the speech bubble in Studio to a much wider width failed to rejoin the word. Instead, the hyphen was permanently baked into the text, rendering as `com-munity` on a single wide line.

---

## 3. Root Cause Analysis

### 3.1 CJK Tokenization in Pass 1 Binary Search

In `src/offscreen/utils/typesetLayout.ts`, `fitFontSizeWithLines` uses a 4-pass binary search fitting algorithm ported from XianScan:
- **Pass 1:** Searches for the largest font size where every word fits on a single line without breaking (`maxWordWidth <= maxW`).
- **The 14px Gate (`cleanBest >= 14`):** If Pass 1 finds a clean unbroken-word fit at $\ge 14$px, it early-returns immediately to prioritize clean whole words over ugly hyphenated breaks.

However, `rawWords` was tokenized solely by whitespace:
```ts
const rawWords = text.split(/[\s\n]+/).filter(Boolean);
```
In Chinese, sentences have no spaces between words:
- The entire 13-character phrase `也感谢您今天来到我们这里，` was treated as a **single unbroken 13-character word**.
- In narrow boxes, this 13-character token could not fit on 1 line at $> 14$px. Pass 1 failed (`cleanBest < 14`), falling through to Pass 4 where character-by-character CJK wrapping correctly fit large text (38px–45px).
- But when the box was widened by just a few pixels, the 13 characters barely squeezed onto 1 line at 14px. Pass 1 succeeded with `cleanBest = 14`.
- The gate `cleanBest >= 14` evaluated to `true`, causing an immediate early return! Pass 4 was skipped, and the font size snapped from 38px down to 14px.

### 3.2 Soft Hyphens Baked into Restored Text

When the translation pipeline hyphenates a long word (e.g. `community`), it stores two separate fields in Dexie:
- `translatedText`: `"Summer at the community pool with my sisters"` (pure, unhyphenated string).
- `lines`: `["Summer at the", "com-", "munity pool with my", "sisters"]` (rendered layout lines).

In `restoreTextObject`, when `lines` were joined with `\n` into `obj.text`, `com-` became a hard string token. During subsequent resizing, newline normalization (`text.replace(/\n/g, ' ')`) produced `"com- munity"`, which `wrapText` joined as `"com-munity"`. The typesetter had no way to know that `"com-"` was an automatic line-break hyphen rather than an intentional compound word like `"twenty-one"`.

---

## 4. Implementation

### 4.1 CJK-Aware Token Segmentation in `fitFontSizeWithLines`

Updated `src/offscreen/utils/typesetLayout.ts` to tokenize CJK text by atomic breakable units:
- When `CJK_REGEX.test(text)` is true:
  - Each individual CJK character (`\u3040-\u30ff`, `\u4e00-\u9fff`, `\uac00-\ud7af`, etc.) is an atomic breakable token.
  - Contiguous Latin words (`[a-zA-Z0-9'’-]+`) remain intact word tokens so they are not broken letter-by-letter unless hyphenated.
- For Western text, whitespace splitting is preserved exactly, maintaining full backward compatibility and unbroken-word prioritization.

### 4.2 Clean Rejoining of Line-Break Hyphens

Implemented soft-hyphen unbreaking across the reflow lifecycle:
1. **`splitIntoLogicalParagraphs` (`typesetLayout.ts`):** When joining soft-wrapped lines, if `prevLine` ends with `(\b[a-zA-Z]+)-` and `nextLine` starts with `[a-z]`, they are joined without space (`${current.slice(0, -1)}${line}`), restoring the unhyphenated word.
2. **`studioTypeset.ts` (`recalculateBlockTypeset` & `wrapSimpleGreedy`):** Reconnects soft line-break hyphens (`/(\b[a-zA-Z]+)-\s*\r?\n\s*([a-z]+)/g -> $1$2`) prior to paragraph reflow in both Auto Balloon and Simple Wrap modes.
3. **`persistedTextObjects.ts` (`restoreTextObject`):** Un-hyphenates soft line breaks in restored text objects while preserving exact pre-rendered `lines` for initial canvas display.
4. **Intentional Hyphen Protection:** User-typed hyphens (`spider-man`, `twenty-five`, `pre-existing`) on single lines or with capitalized segments (`Spider-Man`) have no trailing `-\n` or lowercase continuation, leaving them 100% intact.

---

## 5. Verification

- `npm test`: **84 test suites, 867 unit tests passed** cleanly with 0 failures.
- Added regression test `does not collapse CJK font size when horizontally expanded` in `typesetLayout.test.ts`. Confirmed font size monotonically increases (190px: 38px $\rightarrow$ 210px: 42px) instead of collapsing to 15px.
- Added regression test `un-hyphenates soft line-break syllables when box is widened` in `studioTypeset.test.ts` for both Auto Balloon and Simple Wrap.
- Added regression test `un-hyphenates soft line-break syllables into clean words for future resizing while keeping initial lines intact` in `persistedTextObjects.test.ts`.
- `npx tsc -b`: 0 errors.
- `npm run lint`: 0 errors.
- `npm run build`: built in 1.52s.
