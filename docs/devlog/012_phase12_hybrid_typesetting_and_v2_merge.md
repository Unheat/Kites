# Devlog: Cotrans Default Affine-Warp & XianScan-Style Hybrid Typesetting

* **Date:** 2026-09-05
* **Feature/Task:** Phase 12: 1:1 Cotrans Default Renderer and Hybrid Typesetting Layout Engine
* **Ticket/Issue Link:** N/A
* **Status:** Completed

---

## Objective

Solve text overflow, unnatural Latin word breaks, micro-font scaling, and adjacent bubble collisions in comic translations. Implement the reference 1:1 Cotrans DEFAULT renderer (`cotransDefaultRenderer.ts`) combined with an advanced XianScan-style hybrid typesetting layout engine (`typesetLayout.ts`) and V2 OCR text block merging (`OcrManager.ts`).

---

## Workflow & Implementation Steps

1. **6-Stage Morphological Hyphenation (`typesetLayout.ts`):**
   * Implemented `findHyphenationPoints` strictly enforcing the comic typesetting rule: never hyphenate words shorter than 7 letters.
   * Applied rule-based morphological splitting across explicit hyphens, common prefixes (`un-`, `dis-`, `super-`), common suffixes (`-tion`, `-ment`, `-able`), double consonants, and VC-CV syllables.
2. **Balanced Diamond Text Wrapping (`balancedWrapText`):**
   * Implemented binary search over candidate line widths to identify the tightest width that preserves line count $N$.
   * Produces classic comic inverted pyramid / diamond envelopes for dialogue inside oval speech bubbles.
3. **4-Pass Binary Search Font Fitting with Tall-Narrow Floor (`fitFontSizeWithLines`):**
   * *Pass 1:* Clean binary search on font size using whole words without hyphenation.
   * *Pass 2:* Aspect-ratio geometric floor: when $H/W \ge 2.0$, prevents font sizes from collapsing into unreadable micro-text by establishing a candidate floor based on width and box area.
   * *Pass 3:* Vertical-fill hyphenation for tall bubbles ($H/W \ge 1.5$) stepping down from effective cap to fit high-density dialogue.
   * *Pass 4:* Robust minimum fallback (`MIN_FONT_SIZE = 6`).
4. **Speech Bubble Decollision (`decollideBoxes`):**
   * Implemented overlap resolution pushing adjacent bounding boxes apart by a 4px margin while leaving nested parent/child bubbles intact.
5. **1:1 Cotrans Default Renderer Alignment (`cotransDefaultRenderer.ts`):**
   * Ported 2023 Cotrans region expansion `resizeRegionToFontSize` to calculate target font bounds without 2025 font inflation bugs.
   * Replaced generic canvas text rendering with `putTextLines`, rendering text with proportional stroke borders and line spacing before applying affine warping onto rotated target polygons.
6. **V2 OCR Text Line Merging (`OcrManager.ts`):**
   * Integrated orphan terminal punctuation recovery attaching lone `!`/`?` marks to neighboring lines.
   * Added Furigana Kana filtering (`isKanaOnly` check for text blocks with font size $< 0.45 \times \text{main}$) to eliminate reading aids from translations.
   * Applied majority reading direction voting (`majorityDirection`) and Kruskal Minimum Spanning Tree partitioning (`splitTextRegion`) with Cotrans aspect ratio and distance tolerances.

---

## Roadblocks & Decisions

### Upstream Cotrans 2025 Font Inflation vs. 2023 Touhou Reference

* **The Problem:** The current master branch of Cotrans (2025) aggressively inflates bounding boxes by up to $4\times$, allowing text to escape speech bubbles and bleed across panels.
* **The Solution:** Following AGENTS.md §8, pinned logic strictly to Cotrans 2023 (`commit 39fb606`). Bounding regions scale uniformly only when the font size falls below the minimum page threshold (`(width + height) / 200`).

### Font Fitting Collapsing on Narrow Vertical Japanese Columns

* **The Problem:** Vertical manga textlines are tall and narrow. Fitting horizontal English words into these boxes via naive binary search shrinks font size down to 4-5px to avoid breaking words across narrow widths.
* **The Solution:** Introduced Pass 2 in `fitFontSizeWithLines`. When aspect ratio $H/W \ge 2.0$, a geometric floor (`Math.round(maxW * 0.28)`) guarantees readable English font sizes and triggers morphological hyphenation instead of extreme font shrinkage.

---

## Verification

* Ran test suites in `src/offscreen/utils/typesetLayout.test.ts` verifying hyphenation point detection, diamond wrapping, aspect ratio floors, and box decollision.
* Ran test suites in `src/offscreen/utils/cotransDefaultRenderer.test.ts` confirming affine-warp canvas rendering and text bounding boxes.
* Ran full test suite across the project to ensure no regressions.

---

## Next Steps / Key Takeaways

* **Key Takeaway:** Real-time canvas measurement combined with multi-pass aspect ratio floors solves the classic English-in-manga typesetting dilemma without requiring heavy neural layout models.
* **Next Action:** Add user font selection in the Studio Dashboard to allow switching between standard sans-serif and custom comic book fonts.
