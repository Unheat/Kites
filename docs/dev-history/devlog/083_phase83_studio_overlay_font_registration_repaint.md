# Phase 83 — Studio overlay repaint after font registration

**Date:** 2026-10-28
**Branch:** `main`

## Symptom

On first opening Studio, persisted text boxes painted with a fallback font. Clicking any
single box made the whole page snap to the saved font. The snap applied to every box, not
only the selected one.

## Root cause: repaint race, not a font-loading failure

Three facts combine:

1. `Studio.tsx` registers persisted font-library faces on mount with
   `void ensureFontsRegistered().catch(...)` — fire-and-forget. Registration performs an
   IndexedDB read plus `FontFace.load()` and settles after the first overlay paint.
2. `TextRenderer.renderText` builds `ctx.font` from `obj.fontFamily` and paints. Canvas
   `fillText` never triggers webfont loads, and an unloaded family silently renders with
   fallback glyphs.
3. `StudioCanvas.redrawOverlay` re-runs only when its dependency array changes
   (`imageWidth`, `imageHeight`, `textObjects`, `imageLayers`, `selectedTextId`,
   `editingTextId`, `selectedImageLayerId`, `appearance`, `hideBoxes`, `viewMode`).
   Font registration changes none of them, so the fallback paint persisted until user
   interaction changed `selectedTextId` and forced a redraw — by which time faces were
   loaded, so every box repainted correctly. That is why one click fixed the whole page.

Nothing in `src/` listened to `document.fonts.ready`, so no path existed from
"fonts became available" to "overlay repaints".

The offscreen bake document was never affected: it registers faces at boot long before any
job, and `PipelineOrchestrator` already awaits `document.fonts.load()` per family plus
`document.fonts.ready` before measuring. Only the Studio live overlay lacked the equivalent.

## Fix

One effect in `StudioCanvas.tsx`, placed with the other redraw effects: join the memoized
`ensureFontsRegistered()` promise (shared with `Studio.tsx`, no double IndexedDB read) and
call `redrawOverlay()` once it settles. A `cancelled` flag prevents a repaint after unmount.
Effect re-runs keyed on `redrawOverlay`; once registration has resolved those re-runs are
cheap no-op repaints.

A brief fallback flash (IndexedDB read + font parse, tens of milliseconds) can still appear
before the snap. Eliminating it entirely would mean delaying initial text hydration until
registration resolves, which also delays clearing the previous page's text on page switches;
that trade-off was rejected. Registration failures keep their existing warning in
`Studio.tsx`; the overlay-side catch is intentionally silent to avoid duplicate logs.

## Verification

- `npm test`: 1163 tests pass (106 files).
- `npm run build`: `tsc -b` + Vite build clean.
- Visual QA on a cold Studio open with a persisted catalog font is still pending; green
  tests and build are not visual proof.

## Files touched

- `src/studio/canvas/StudioCanvas.tsx` — font-registration repaint effect.
- `docs/dev-history/devlog/083_phase83_studio_overlay_font_registration_repaint.md` — this log.
