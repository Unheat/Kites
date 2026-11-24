# Phase 120: Studio route settings parity

**Date:** 2026-11-23

## Context

Studio page tools share offscreen services with the main pipeline, but their request handoff drifted from popup/background-owned settings.

## Bugs

1. **Engine override drift.** StudioCanvas brush OCR sent OCR/inpaint overrides without `translationEngineId`; full-page retranslate sent no engine overrides. Offscreen read global popup state, so Studio-selected or post-hydration tiers (including Local Only) could be ignored while Studio recorded its selected IDs in `translationJobs`.
2. **Colorize `none` collapsed to global.** Offscreen treated explicit `colorTier: 'none'` as unset and substituted the global tier. The Studio button also stayed enabled when the Disabled tier was selected.
3. **Generated-layout provenance dropped.** `requestStudioOcr` did not carry `textFromGeneratedLines` from offscreen responses into prepared `TextObject`s, so generated line breaks could be treated as authored on later reflow.
4. **Studio hydration stale.** `studioStore.hydrateFromStorage()` read raw `chrome.storage.local` popup state, bypassing background defaulting/legacy normalization, and Studio had no listener for popup-state changes while the page stayed open.

## Fix

- Added `src/studio/state/studioRouteSettings.ts` with `resolveStudioOperationOverrides()` returning `{ ocrEngineId, inpaintEngineId, translationEngineId }`. Studio full-page retranslate and StudioCanvas brush OCR both spread this helper into `requestStudioOcr` payloads. Full-page retranslate records the same resolved override IDs in `translationJobs`.
- Added `src/offscreen/services/studioColorizeTier.ts` with `resolveStudioColorTier(requestedTier, activeColorId, defaultColorId)`. Precedence is explicit request (including `'none'`) -> global -> canonical default. Offscreen `handleStudioColorize` uses it. `ColorSettings` disables the action when the resolved tier is `'none'`.
- Added `textFromGeneratedLines?: boolean` to Studio OCR response typing in `src/offscreen/services/StudioOcr.ts` and `src/studio/bridge/offscreenStudioBridge.ts`, and mapped it through bridge response normalization.
- Studio store now hydrates through background `GET_POPUP_STATE` and exposes `subscribeToGlobalState()` that listens for `POPUP_STATE` storage changes and rehydrates. `Studio.tsx` mounts the subscription once.

## Verification

- Targeted repro suite: `npx vitest run src/studio/state/studioRouteSettings.test.ts src/offscreen/services/studioColorizeTier.test.ts src/studio/state/studioStore.hydration.test.ts src/studio/bridge/offscreenStudioBridge.test.ts src/studio/tools/ColorSettings.test.tsx` — 15 passed.
- `npm run lint` — 58 pre-existing warnings, 0 errors.
- `npm run docs:api` / `npm run docs:check` — pass (undocumented baseline unchanged).
- `npm run build` — pass.

## Out of scope (stacked PR2)

SFX-policy plumbing, typography-field parity, OCR catalog/default consolidation, and AGENTS/coding-standards rule updates remain in the stacked follow-up.
