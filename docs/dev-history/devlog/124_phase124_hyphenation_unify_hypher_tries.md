# Devlog 124: Main-route hyphenation unified on the vendored hypher tries

**Date:** 2026-11-27

## Objective

Both wrap routes must split words through the same pattern engine: the main route
(Auto Balloon / simple / ellipse / legacy renderer) joins the contour route on the 48 vendored
hypher tries, the legacy Liang dictionaries survive only for the languages with no trie data,
and the same word may no longer split differently depending on which engine drew the bubble.
This completes the collapse deferred in [ADR-014](../../decisions/ADR-014-clean-room-provenance-and-standard-cited-typography-data.md).

## Root causes

- `HyphenationService.findHyphenationPoints` gated trie routing to rule-class languages only
  (`ruleClass ? resolveHypherKey(...) : undefined`); every other language fell to the legacy
  Liang dict branch with symmetric `minSide=2`, while the contour route applies per-language
  hypher bounds (`contourSegmentCore.ts` defaults through `getHypherBounds`). Two measured
  mechanisms diverged: bounds (en right bound 3 drops a split 2 letters from the end) and
  pattern vintage (`de_DE.txt` vs the hypher German trie at identical 2/2 bounds).
- The trie path carried no comic-lettering length gates: `hypherSplitOffsets` checks only
  `wordBytes < 2`, while the dict path enforces `HYPHEN_MIN_LETTERS = 6` and
  `HYPHEN_MAX_WORD_LENGTH = 64` (`LiangEngine.ts`). Measured probe: the ungated trie returns
  `[2]` for 'apple' where the dict path returns `[]`.

## Measured divergences (pre-change, `.workflow/find-divergence.ts`, 2026-11-27)

| Language | Word | Main (dict) | Contour (trie) | Mechanism |
|---|---|---|---|---|
| en | international | `[2,5,7,11]` | `[2,5,7]` | bounds 2/2 vs 2/3 |
| en | community | `[3,5,7]` | `[3,5]` | bounds |
| en | immediately, technology, particularly, opportunity | extra tail point | — | bounds |
| de | Verkehrsinfrastruktur | `[3,8,10,13,14,18]` | `[3,8,10,13,18]` | pattern vintage (2/2 both) |
| pt | extraordinariamente | `[2,5,7,9,11,13,14,17]` | `[2,5,7,9,11,13,14]` | bounds |

## Implementation

1. `HyphenationService.findHyphenationPoints` dispatch is now trie-first for ANY language with
   a vendored loader, passing `getHypherBounds(baseLang)` left/right — byte-identical to the
   contour route. The comic gates port onto the trie branch (`HYPHEN_MIN_LETTERS`/
   `HYPHEN_MAX_WORD_LENGTH`, same `word.length` semantics as `LiangEngine.ts`), so words under
   6 letters stay whole on the main route even though the contour route gates at its own caller
   (`contourSegmentCore.ts` `minimumWordLength`); that intentional route difference for short
   words is documented in the method docstring.
2. `isLoaded` mirrors the dispatch exactly: trie-capable → trie cache; rule-fallback
   (ne/az/uz) → always ready; dict-only (id/ms/ro) → patterns cache; no-data (CJK, unknown) →
   true.
3. `HYPHENATION_DICTIONARY_MAP` trimmed to id/ms/ro (both served by `id_ID.txt`, plus
   `ro_RO.txt`); the 19 redundant dictionary files (~2.66MB of the 2.8MB asset folder, largest
   de_DE 999KB / hu_HU 964KB / nb_NO 190KB) are deleted from `public/assets/hyphenation/`.
   `hypherData/patterns/*.tex` stays as the license/provenance record for the tries.
4. Bonus coverage: languages that never had dictionaries (el, is, ka, sr, af, ... — 27 in the
   trie set without a map entry) now hyphenate on the main route for free.
5. Tests: the inverted isolation test became a synthetic-Liang proof that the dict path still
   owns `id` (`registerPatterns('id_ID', 'ext1ensive')` → `[3]` while the contour route for the
   same word returns `[]`); the `isLoaded` matrix gained dict-only rows (id/ro) and trie-backed
   comments; a committed parity reproducer pins main === contour for en/de/pt/nb cases
   (RED at 134b7bc: `en:international expected [2,5,7,11] to deeply equal [2,5,7]`).
6. Docs updated in the same commit: `auto-balloon-typesetting.md` §4, `pipeline.md` contour
   wording, `testing.md` hyphenation description, `fullplan.md` overlay, `typesetLayout.ts`
   docstrings. Dead re-exports `MIN_HYPHEN_WORD_LENGTH`/`MIN_HYPHEN_SIDE_LENGTH` removed from
   `contourTypeset.ts`.

## Evidence

- RED: `npx vitest run src/offscreen/utils/hyphenation/HyphenationService.test.ts` exit=1,
  1/22 failing (committed log `.workflow/red-gate.log`, commit 134b7bc).
- GREEN: same command exit=0, 22/22 (2026-11-27, macOS arm64).
- P2P: `npm test` 1689 tests / 146 files passed (was 1680/145 pre-change; +9 from the new
  tests, zero regressions); `npm run build` (tsc -b) exit 0; `npm run lint` 0 errors
  (53 pre-existing warnings, one fewer than before — a dead-import warning resolved);
  `npm run docs:check` 874 undocumented (baseline 880, delta −6), 0 shape violations;
  `npm run docs:api` regenerated with zero warnings.
- Assets: `public/assets/hyphenation/` 2.8MB → 136KB on disk (dist shrinks identically via the
  default publicDir copy).
- Translation gate not run (recorded deviation): `scripts/translation-gate.mjs` watches
  translation/OCR files, none of which this change edits; hyphenation alters rendering split
  points only.

## Decision

One pattern engine, everywhere: a language with a vendored trie uses it on every wrap route
with the language's own hypher bounds, so main-route and contour-route splits are pinned equal
by test. The legacy Liang path is a compatibility shim for exactly id/ms/ro, and the arithmetic
rules exist only where no data exists. Future pattern additions (e.g. upstream TeX sets for
uz/az/ne/id/ms/ro) retire the remaining fallbacks without touching the dispatch shape.
