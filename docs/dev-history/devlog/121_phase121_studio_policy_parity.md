# Phase 121: Studio policy and typography parity

**Date:** 2026-11-23

## Context

Phase 120 made Studio forward its engine selections explicitly, but the offscreen Studio OCR stage still substituted its own copy of popup *policy* for the real one, and the Studio UI kept a second OCR tier catalog. Both are the same class of drift: an entry point that can run a shared operation does not forward what the user configured.

Stacked on PR #55 (`fix/studio-route-parity`).

## Bugs

1. **SFX policy ignored.** `runStudioOcr` called `resolveSfxPolicyStrategy(DEFAULT_SFX_POLICY)` instead of reading `popupState.sfxPolicy`. A user on `translate-plainly` had sound-effect artwork preserved in Studio but translated by the page pipeline; the reverse mismatch applied to `preserve`.
2. **SFX policy not forwarded to OCR masking.** The policy gate above decided translation, but `ocrContext` omitted `sfxPolicy`, so `OcrManager` classified and mask-filtered artwork under `preserve`. Under `translate-plainly` the sound-effect polygon was missing from `rawPolygons`; Studio then translated the region without inpainting it, painting text over the original lettering. Under `preserve`, preserved artwork was still erased by the Studio mask. Forwarding the policy and excluding preserved artwork from Studio's erase mask makes both stages agree (found in PR #56 review).
3. **Typography settings dropped.** Studio OCR returned `bold`/`fontFamily` but not `italic`, horizontal alignment, or the stroke-disabled choice. The pipeline honoured those in rendered output, while Studio painted upright, centred, stroked text. Studio text objects also always fell back to `strokeWidth: 2`.
4. **OCR tier list duplicated.** The popup and Studio each hardcoded the OCR tier array, labels, and the `'v6-small'` default in several places. Adding or renaming a tier required edits in two UIs, while the offscreen registry was the real authority.

## Fix

- `src/shared/ocrTiers.ts` is now the canonical catalog: `OCR_TIER_CATALOG`, `OcrTierId`, `DEFAULT_OCR_TIER_ID`, `OCR_TIER_IDS`. `src/shared/ocrTiers.test.ts` pins it to `ocrRegistry` so catalog and registry cannot diverge silently.
- `PopupState` defaults use `DEFAULT_OCR_TIER_ID`; `EngineSelectionPanel` and `StudioEngineSelector` derive their options from the catalog instead of re-declaring literals.
- `runStudioOcr` resolves the artwork strategy from `popupState.sfxPolicy ?? DEFAULT_SFX_POLICY`, forwards the resolved policy into `ocrContext` for `OcrManager`, and excludes preserved artwork indices from the inpaint mask so preserved ink is neither erased nor painted. Bare fragments remain preserved regardless of policy (`isPreservedArtwork`).
- Studio OCR responses now carry `italic`, `align`, `strokeWidth`, and `strokeColor: 'transparent'` when strokes are disabled; the bridge maps them into `TextObject` with the previous values as fallbacks for older responses.
- `AGENTS.md` §3 gains rule 5, **Entry-Point Parity**: when the page pipeline and a Studio route can run the same offscreen operation, every entry point forwards the same explicit settings object; offscreen must not substitute global popup state for a setting the caller already passed.

## Verification

- `npx vitest run src/shared/ocrTiers.test.ts src/offscreen/services/StudioOcr.test.ts src/studio/bridge/offscreenStudioBridge.test.ts` — 3 files, 55 tests passed.
- `npm run gate:translation` — no pipeline files changed; nothing to prove.
- `npm run lint` — 0 errors; `npm run docs:api` — zero warnings; `npm run docs:check` — 880 undocumented (baseline 880, delta 0).
- `npm run build` — pass. `npm test` — 145 files, 1678 tests passed.

## Out of scope

- Studio typography settings that the *pipeline* itself does not persist (letter spacing, opacity, background fill, drop shadow) stay unplumbed; adding them to one entry point first would recreate the drift this phase removes.
- OCR-created objects store `strokeWidth: 0/2` explicitly while pipeline-restored objects infer `2` from the renderer default; re-enabling strokes later can therefore differ between the two origins. Not addressed here because it changes persisted-object semantics.
- Gated pipeline paths (`src/offscreen/engines/ocr/`, translation engines) were not edited. `ocrRegistry` keeps its own `'v6-small'` literal because the translation gate requires a recorded benchmark for pipeline edits; the catalog test enforces the alignment instead.
