# Devlog 107: Translate Only What Is Painted

- **Date:** 2026-11-16
- **Feature/Task:** Translation dispatch boundary — deterministic passthroughs, Studio artwork regions, one preserve rule
- **Status:** Completed on `fix/recovery-resampling`

## Objective

Text that no model can change, or whose translation is thrown away, must cost nothing: no prompt
tokens, no recovery request, and no fallback engine. One page-level consequence mattered as much as
the tokens: a page holding only an ellipsis must not be judged "untranslated" and re-dispatched down
the whole engine waterfall.

## Root causes

1. **`returnedPageUntranslated()` counted punctuation as evidence.** `TranslationManager.ts` skipped
   lines outside the source script only when a language was declared (`sourceIsKnown`). Under
   `auto` every non-blank line counted, so `……` — resolved by `isDeterministicPassthrough` before
   dispatch and returned untouched by design — satisfied `unchanged === translatable` on its own.
   The manager then threw `Engine X returned every line untranslated` and the pipeline tried the
   next engine, which could not possibly answer differently. Probe: `returnedPageUntranslated(['……','！？'], …, 'auto')` returned `true`; with `'ja'` it returned `false`.
2. **Studio sent artwork to the translator.** `StudioOcr.ts` mapped *every* region into
   `originalTexts` for `processTranslation`, and computed `artworkIndices` only afterwards, using it
   solely to set `isArtwork` so the canvas skips painting. Sound effects, display lettering and
   fragments were therefore translated and the result discarded. The page pipeline
   (`PipelineOrchestrator.ts`) already excluded exactly those blocks.
3. **The preserve rule existed twice.** `OcrManager.ts` and `PipelineOrchestrator.ts` each spelled
   `kind === 'fragment' || preservesArtwork`. A rule that decides whether hand lettering is erased
   and whether a model is paid for ink had two owners.

## Implementation

1. `src/offscreen/services/TranslationManager.ts` — `returnedPageUntranslated()` skips
   `isDeterministicPassthrough(text)` before the script test, for declared and `auto` sources alike.
   Such a line is neither evidence of translation nor of failure.
2. `src/shared/sfx/sfxPolicy.ts` — new `isPreservedArtwork(kind, strategy)`, the single definition of
   "this block stays as drawn".
3. `src/offscreen/services/OcrManager.ts`, `src/offscreen/services/PipelineOrchestrator.ts` — call it
   instead of the duplicated expression. Behaviour unchanged.
4. `src/offscreen/services/StudioOcr.ts` — resolves the same rule with `DEFAULT_SFX_POLICY` (the
   policy Studio already assumed), builds `translatablePositions` from non-artwork regions, sends only
   those to the translator, and scatters the answer back into a full array aligned to `regions`.
   When every region is artwork the translator is not called at all. `isArtwork` was also added to
   the `StudioOcrResponse.textObjects` type, which the implementation had been setting while the
   contract omitted it.
   Studio ignoring `translate-plainly` here is deliberate, not an oversight: Studio never paints an
   artwork object, so under that policy it would translate a sound effect, throw the answer away and
   leave the erased ink blank. Keeping the ink is the only behaviour Studio can honour, and the canvas
   already skips these objects.

Correct alignment detail: the scatter indexes by **position in `regions`**, not by `region.index`,
because `normalizeRegions()` drops blank regions and `texts[index]` downstream is positional.

## Evidence

- RED (`eaa0c2d`): `does not retry a page that holds nothing but an ellipsis` failed with
  `instantiatedIds = ['SmolLM2-…', 'gg-translate']`; `never sends artwork regions to the translator`
  failed with `processTranslation` receiving `['ドン','テスト']`.
- GREEN: `npx vitest run src/offscreen/services/TranslationManager.test.ts src/offscreen/services/StudioOcr.test.ts src/shared/sfx` → 103 passed.
- `npm test` → 129 files, 1530 tests passing (1524 before, +2 reproducers, +2 shared-predicate specs, +2 negative controls).
- `npm run build` → built in 2.54s, no type errors. `npm run lint` → warnings only, pre-existing.
- `npm run docs:check` → undocumented 880 (baseline 880, delta +0), docstring violations 0.
- `npm run docs:api` → HTML generated at `./docs/api` with zero warnings; the new export gets its own
  page (`functions/shared_sfx_sfxPolicy.isPreservedArtwork.html`). `docs/api/` is gitignored, so the
  generated output is not part of the commit.
- `src/shared/sfx/sfxPolicy.test.ts` covers the shared predicate directly: every kind is preserved
  under `preserve`; under `translate-plainly` sound-effect and display lettering are translated
  while a `fragment` stays artwork. That branch (`kind === 'fragment'` with
  `preservesArtwork: false`) is otherwise unexercised, because both call sites that run it default to
  `preserve`.
- Two negative controls were added after review: a page of real dialogue that comes back unchanged
  under `auto` still counts as failed and still falls back (so the passthrough skip cannot widen into
  "anything unchanged is fine"), and a Studio page whose every region is artwork never calls the
  translator at all rather than calling it with nothing.
- Independent review (`judge-pr`, round 1) rejected on exactly those two gaps - the missing predicate
  tests and the unrecorded `docs:api` outcome - and confirmed the two bug fixes and the diff as
  correct; both are addressed above.
- Real browser (`scripts/webllm-local-run.mjs`, WebLLM Qwen3.5-0.8B, auto→en fixture, 29 slots) runs
  recorded in the PR body; this change does not touch prompt text.

## Roadblocks (rejected alternatives)

- **Leave Studio translating artwork** — rejected: the result is stored on an object the canvas
  skips, so the tokens buy nothing, and each artwork block also widened the page-level
  untranslated verdict. The page pipeline already had the boundary; Studio was the outlier.
- **Filter artwork only in the engine** — rejected: `BaseLlmTranslationEngine` cannot see the
  artwork classification, and doing it there would still pay for the chunk's framing and glossary
  and would leave the alignment problem to the engine.
- **Treat punctuation as "untranslated" but stop the waterfall for it** — rejected as the same bug
  in another place: the verdict function decides, so the skip belongs there.
- **Rewording the prompt so the model copies less** — measured earlier in the same session and left
  alone; see devlog 106 era benchmarks. Not part of this change.

## Decision

The translation payload contains only text a model can actually change and whose answer will be
painted. Three independent filters enforce that: OCR artwork classification (via the shared
`isPreservedArtwork`), `isDeterministicPassthrough` before dispatch, and the same artwork rule in
Studio. Any future block type that is skipped at render time must be excluded at one of those
boundaries, not after the request.
