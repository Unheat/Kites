# ADR-014: Clean-Room Provenance and Standard-Cited Typography Data

## Status

Accepted and implemented on 2026-11-27.

## Context

An external author reported that three utility files (`kinsokuShori.ts`, `textUnwrap.ts`,
`RuleBasedEngine.ts`) reproduced code from a closed-source browser extension, and asked for the
files to be removed or rewritten without that code. An internal audit confirmed the provenance
risk: the repository's own plans and devlogs framed several ports as parity work against that
extension, and AGENTS.md §11 (never name closed-source donors) was honored everywhere except
41 mentions across 14 files. The same audit found usable replacements already inside the repo:
the hypher 0.1.8 pattern tries (MIT/Apache, vendored with license notices) cover every
rule-class hyphenation language except Nepali, Azerbaijani and Uzbek, and the contour route
already routed Tamil through those patterns while the main route did not.

## Decision

1. **Clean-room rule for rewritten utilities.** Reimplementation may draw only on (a) the
   project's own test expectations as the behavioral spec and (b) public standards and
   permissively licensed components (Unicode UAX #14, W3C Requirements for Japanese Text
   Layout, Unicode Script property tables, vendored MIT/Apache pattern data). Donor sources
   are never opened during a rewrite, and flagged identifiers, file names and table
   expressions are replaced with new ones.
2. **Character data lives in cited tables.** Line-break legality data is authored as
   codepoint-range tables with per-group class citations instead of inline regex literals,
   so provenance is auditable per range (`src/offscreen/utils/typography/lineBreakRules.ts`).
3. **One engine per operation.** Rule-class hyphenation languages resolve through the
   vendored hypher patterns on every wrap route; hand-rolled syllable rules survive only as
   the fallback for languages with no trie data (`syllableRules.ts`, same data, new
   expression).
4. **Provenance policy is enforced repo-wide.** Closed-source donor names do not appear in
   code, docs, devlogs, site copy or new documents; historical documents whose subject was
   donor parity are removed rather than rewritten. Git history is left intact (the demand is
   removal going forward).
5. **Persistent markers are contracts, not code.** The wrap-hyphen marker value
   (`-\u2060`) is persisted in Studio text objects, so its value outlives any engine
   rewrite (`WRAP_HYPHEN_MARKER`, single-sourced in `lineJoin.ts`).

## Consequences

- Behavior parity is enforced by the existing typesetting suites (1680 tests) instead of by
  donor comparison; line-start prohibition and hyphen-split invariants are pinned there.
- Tamil/Hindi/Turkish/Finnish hyphenation quality improves (curated TeX patterns replace
  two-conjunct hand tables), and both wrap routes share one engine per AGENTS.md §3 rule 5.
- `isLoaded()` now reflects trie readiness for trie-capable rule-class languages; all three
  preload routes already awaited `loadHyphenationLanguage` before typesetting.
- The 350-line donor-port plan and two donor-named devlogs are deleted; the historical record
  of the rewrite lives in Devlog 122 and this ADR. Follow-up candidates, out of scope here:
  collapse the legacy Liang dictionaries into the hypher tries (bundle-size win, changes
  output for 25 languages) and consolidate the duplicated line-break regex copies in
  `typesetLayout.ts` onto `lineBreakRules.ts`.
