# Devlog 122: Clean-room rewrite of the typography line-break and hyphenation utilities

**Date:** 2026-11-27

## Objective

An external author reported that three utility files reproduced code from a closed-source
extension and asked for removal or a rewrite without that code within two weeks. The goal was
full compliance with zero behavior regressions: same invariants, new expression, provenance
cited to public standards, and every closed-source donor name scrubbed from the repository.

## Root causes

- `src/offscreen/utils/typography/kinsokuShori.ts` and
  `src/offscreen/utils/typography/textUnwrap.ts` (added 2026-10-26) and
  `src/offscreen/utils/hyphenation/RuleBasedEngine.ts` (added 2026-10-24) carried
  third-party-derived constants, function names and regex bodies; only comments and types
  were new. Devlogs 038/048/063/069/070 and the editor port plan documented the parity
  framing, confirming the provenance risk rather than refuting it.
- The complaint surfaced a structural smell, not just a legal one: the same kinsoku data
  existed in three places (flagged module, `tokenizer.ts`, `typesetLayout.ts` copies), the
  wrap marker was defined twice (`textUnwrap.ts` + `hyphenation/types.ts`), and half of
  `kinsokuShori.ts` was dead code (`bindWrapTokens`, `lineStartBarred`, `barredStart` had no
  importers).
- The main wrap route dispatched Indic/vowel languages to hand-rolled syllable tables while
  the contour route already used the vendored hypher tries for the same languages — two
  engines for one operation.

## Implementation

1. `src/offscreen/utils/typography/lineBreakRules.ts` replaces `kinsokuShori.ts`: codepoint
   range tables with per-group citations to UAX #14 line-break classes and the W3C Japanese
   layout line-start prohibition tables; predicates renamed (`isContinuousScriptChar`,
   `isCompoundDashTail`, `isOpeningMark`, `isLineStartForbidden`). Dead binding API deleted.
2. `src/offscreen/utils/typography/lineJoin.ts` replaces `textUnwrap.ts`: line-based rejoin
   and unwrap reducers instead of a char scan; `WRAP_HYPHEN_MARKER` keeps the persisted
   `-\u2060` value and is now the single definition (`hyphenation/types.ts` re-exports it);
   the rejoin predicate widened from ASCII to any spaced-script letter, which additionally
   heals accented-Latin splits the old matcher missed.
3. `src/offscreen/utils/hyphenation/syllableRules.ts` replaces `RuleBasedEngine.ts` as a
   fallback-only engine (`indicAksharaPoints`, `vowelPatternPoints`) written from Unicode
   script tables; `HyphenationService` dispatch routes trie-capable rule-class languages
   (hi, bn, mr, ta, te, gu, kn, ml, pa, tr, fi) through the vendored TeX patterns — the same
   engine the contour route uses — and only ne/az/uz hit the rules. Trie coverage verified
   against `hypherData/tries/` (48 chunks; ne/az/uz absent).
4. All call sites renamed (`studioTypeset`, `StudioCanvas`, `persistedTextObjects`,
   `ellipseTypeset`, `contour/segments`, `typesetLayout`, `contourTypeset`, barrels, tests).
   `typesetLayout.ts`'s separate inline regex copies were deliberately left untouched to keep
   the regression surface inside the flagged scope.
5. Provenance scrub: the 350-line donor-port plan and devlogs 070/038 deleted outright (user
   decision); 11 one-line mentions neutralized across devlogs 048/063/069/071, `fullplan.md`,
   three code comments, one test description and the site showcase copy. Repo-wide sweep for
   the donor name outside `scratches/` (gitignored, user-kept) returns zero hits.

## Evidence

- `npx vitest run src/offscreen/utils src/studio src/offscreen/services`: 739 tests / 62 files
  passed mid-change; `npm test`: **1680 tests / 145 files passed** on 2026-11-27 (macOS,
  darwin 27.0.0 arm64) including the new dispatch tests (`HyphenationService.test.ts` now 21:
  Tamil routes through the trie with points equal to the contour route; Nepali falls back to
  akshara rules synchronously; `isLoaded` reflects trie readiness).
- `npm run build` exit 0; `npm run lint` 0 errors (54 pre-existing warnings, all in
  `archive/`).
- One regression caught and fixed during the rewrite: the first `rejoinHyphenatedBreaks`
  draft kept the trailing hyphen when joining lines; the marker path masked it because
  `finalizeUnwrap` strips the marker, so only plain-hyphen tests failed
  (`lineJoin.test.ts:54`). Fixed by stripping the tail before concatenation.
- Donor sources were never opened during the rewrite; the behavioral spec was the existing
  suites, per [ADR-014](../../decisions/ADR-014-clean-room-provenance-and-standard-cited-typography-data.md).

## Decision

Rewritten utilities derive character data from cited public standards and vendored
permissively-licensed components, never from a closed-source donor; persistent marker values
are contracts that outlive engine rewrites. Donor names stay out of the repository; documents
whose subject was donor parity are deleted rather than rewritten. Follow-up (not done here,
recorded in the ADR): collapse the legacy Liang dictionaries into the hypher tries, and
consolidate `typesetLayout.ts`'s duplicated line-start/opening-mark regexes onto
`lineBreakRules.ts`.
