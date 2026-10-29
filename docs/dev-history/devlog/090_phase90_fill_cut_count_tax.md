# Devlog 090: Fill Policy Cut-Count Tax

### 1. Metadata
* **Date:** 2026-10-29
* **Feature/Task:** Charge each additional discretionary hyphen cut extra required size gain in the Kites fill policy
* **Branch:** `fix/fill-cut-count-tax`
* **Status:** Completed (unit-verified)

---

### 2. The Objective
After PR #42's fill policy, one comparison decides clean-vs-split, and the winning split layout may spray cuts across many words (the IF-THE-SITUATION… bubble hyphenated SITU-, BE-, CRIT-, RE-, IMMEDI- at once), while the desired behavior is "the long word hyphenates, spray cuts don't". User-approved design: keep the single whole-layout comparison but make the required gain grow with each additional cut.

### 3. Implementation
* `searchFillPolicy` now reads the winning split layout's discretionary cut count (`discretionaryCuts`, optional on the candidate contract; missing counts as zero) and requires `CONTOUR_FILL_MIN_GAIN + CONTOUR_FILL_EXTRA_CUT_PENALTY × (cuts − 1)` relative gain over the clean fit. Both constants are Kites extensions (0.2 / 0.2; the base was user-tuned from the initial 0.15 to 0.2).
* `layout.ts`'s evaluator reports the count: for hyphenated template passes it counts chosen break points whose ending segment carries a discretionary suffix (`countHyphenCuts`); clean passes report zero. The identity of the winning object decides which segment list the break indices refer to, so the count is exact even when the hyphenated pass internally returns its own clean result.
* Everything else is unchanged: two whole-layout searches, per-size clean-first, donor floor tail, and the 9px minimum still bind first.

### 4. Behavior on the reported bubbles
* I'LL STAND UP … REINFORCEMENTS bubble: winning layout has 1 cut → base threshold only → its ~25% gain clears 0.2 → the bottom long word still hyphenates.
* IF THE SITUATION … IMMEDIATELY bubble: winning layout needed 5 cuts → required gain 0.2 + 4×0.2 = 1.0 → the split is rejected and the smaller clean layout renders.

### 5. Testing & Verification
* New policy tests: five-cut modest-gain rejected; five-cut +105% accepted; single cut at base threshold; boundary test updated to the user-tuned 0.2 constant (12.0 on a 10px clean fit).
* Full contour suites, typecheck, and full project suite green.

### 6. Next Steps / Key Takeaways
1. Visual QA on real pages; if spray cuts still appear on dense dialogue, raise `CONTOUR_FILL_EXTRA_CUT_PENALTY` — it is the single knob for this behavior.
2. Key lesson: the DP optimizes line packing at a given size, so global preferences like "few cuts" must enter the selection between layouts, not the DP's internal cost (the donor comparator ranks line count before cost, which would drown a cost tweak).
