# Phase 83 — Studio overlay first-open fallback font

**Date:** 2026-10-28 (amended after first attempt failed)
**Branch:** `main`

## Symptom

On first opening Studio, persisted text boxes painted with a fallback font. Clicking any
single box made the whole page snap to the saved font. The snap applied to every box, not
only the selected one.

## Root cause: canvas never requests CSS @font-face presets

Saved dialogue defaults to the CSS preset stack
`"Kites Comic", "SVN-Wild Words", "CC Wild Words", ..., sans-serif`
(`DEFAULT_FONT_FAMILY` in `typesetLayout.ts`). Those faces come from `@font-face` rules in
`src/index.css` pointing at bundled `/fonts/*.ttf` files. Three facts combine:

1. Canvas `fillText` never triggers webfont loading. A face that no DOM text has requested
   is treated as unavailable, so `ctx.font` silently walks the stack down to `sans-serif`.
2. `document.fonts.ready` only waits for loads already triggered — it does not start one.
   Nothing on Studio mount requests the preset families, because the Studio chrome itself
   renders in the UI font, not the bubble font.
3. `StudioCanvas.redrawOverlay` only re-runs when its dependency array changes. Selecting a
   box renders DOM text in the bubble's family (style panel / preset label), which finally
   triggers the CSS face load; the redraw that comes with the selection then paints every
   box correctly. That is why one click fixed the whole page.

The offscreen bake document was never affected: `PipelineOrchestrator` already calls
`document.fonts.load()` per family plus `document.fonts.ready` before measuring
(`PipelineOrchestrator.ts`, "fonts.ready only waits for faces already triggered to load").

## First attempt (insufficient)

An effect joined the memoized `ensureFontsRegistered()` promise (IndexedDB library faces —
catalog downloads and user imports) and repainted when it settled. It did not fix the bug:
the preset families are CSS faces, not library faces, so registration settling changed
nothing about them, and the repaint still painted before any DOM text had requested the
face. Diagnosis corrected with the evidence above.

## Fix

- `fontLibrary.ts` gains `preloadFontFamilies(stacks)`: splits each CSS stack, skips generic
  families, and requests `16px` and `bold 16px` (the two dialogue weights) for every
  concrete family via `document.fonts.load`, then awaits `document.fonts.ready`. Failures
  are non-fatal — a missing family falls back down its stack. Guarded by
  `typeof document !== 'undefined' && document.fonts`, matching the orchestrator's pattern,
  so jsdom tests are safe.
- `StudioCanvas.tsx` replaces the first-attempt effect: on every `textObjects` change it
  awaits library registration, preloads the families the boxes reference, then repaints
  once. Covering `textObjects` changes means refonting a box also repaints with the newly
  selected face.

A brief fallback flash (bundled local font files load in milliseconds) can still appear
between the first paint and the preload repaint. Eliminating it entirely would mean gating
initial text hydration on face loading, which also delays clearing the previous page's text
on page switches; rejected for now.

## Verification

- `npx vitest run src/shared/fontLibrary.test.ts`: 8 tests pass (stack parsing, dedupe,
  non-fatal failures).
- Full suite: 114 files / 1255 tests pass.
- `tsc -b` + Vite build clean.
- Visual QA on a cold Studio open with preset font stacks is still pending; green tests and
  build are not visual proof.

## Files touched

- `src/shared/fontLibrary.ts` — `preloadFontFamilies` helper.
- `src/studio/canvas/StudioCanvas.tsx` — preload + repaint effect.
- `src/shared/fontLibrary.test.ts` — preload coverage.
- `docs/dev-history/devlog/083_phase83_studio_overlay_font_registration_repaint.md` — this log.
