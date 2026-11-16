# Devlog 106: Per-Image Reader Controls and Stable Eye Toggle

- **Date:** 2026-11-15
- **Feature/Task:** Per-image hover/loading states, queue fan-out, automatic translation feedback, eye-toggle race
- **Status:** Completed on `main`

## Objective

The reader overlay must treat every image as its own state machine:

- an idle image shows Translate,
- a queued/translating image keeps its spinner pinned to that image,
- a translated image shows eye, download, and Studio actions,
- hovering a different image shows that image's own state instead of reusing one global button,
- automatic translation and multiple queued images use the same rules.

The eye button also had to keep toggling after leaving and re-entering a translated image.

## Root causes

- `GlobalOverlay` rendered one hover control from `activeImg`. Pending URLs lived in a global
  `translatingUrls` Set, but only the current hover target had a mounted button, so a spinner
  disappeared when the pointer moved away even though its job was still queued. A second gate
  prevented hover dismissal whenever **any** job was pending, so the next image could inherit a
  stale control instead of showing its own state.
- Automatic mode sent `TRANSLATE_IMAGE` without adding the target to the pending UI state.
- The control re-resolved its target by `srcUrl` after translation. Once the DOM source became a
  blob URL, that lookup could return a recycled/backing image without the original backup attrs.
  The eye button then changed its local icon while `toggleImageDisplay` restored the blob as the
  "original" (or found no usable target).
- `toggleImageDisplay` trusted only `targetImg`'s own `data-kites-orig-src`. A backing image that
  never received the backup attrs could not restore the archived original.

## Implementation

1. Added `pendingImages: Map<stableUrl, OverlayImage>` and a `remember/forget` pair. The rendered
   control set is active hover + pending targets, deduplicated by stable overlay id; Persistent
   mode adds all discovered targets.
2. Removed the global "any job pending" hover-hide gate. Pending controls remain visible on their
   own targets, while the hovered control follows normal enter/leave behavior.
3. Automatic mode now registers the same pending control and translation state before sending
   `TRANSLATE_IMAGE`; its failure callback clears both.
4. `TranslateButton` receives its mounted target, resolves the registry identity from
   `data-kites-orig-src`, and uses that identity for registry reads, re-translate, download, and
   Studio actions. It no longer re-resolves by the post-translation blob URL.
5. `toggleImageDisplay` falls back through the source element and archived `record.originalUrl`
   before using `target.srcUrl`, so a backing/recycled image without its own backup attrs can
   still return to the original.

The behavior was studied against a commercial web-reader pattern where each target owns an
overlay/state record and only releases it when the target is original or replaced. Kites keeps
its own control geometry and queue implementation; no donor code was copied.

## Evidence

- `readingIntegration.test.tsx`: a pending spinner stays pinned while hovering another image;
  auto-translated visible images get a spinner; five simultaneous clicks produce five independent
  spinners; eye toggle works after leaving and re-entering a translated image.
- `imageReplacer.test.ts`: original restoration falls back to the archived record when the img
  backup attrs are missing.
- `npm test`: 1484 passed / 126 files.
- `npx tsc -b`: exit 0; `npm run build`: exit 0; `npm run docs:check`: 0 violations;
  `npm run docs:api`: generated; `npm run lint`: 0 errors.

## Decision

State belongs to the image, not to the current hover slot. A pending job owns a pinned control;
hover controls are transient; the stable original URL is the registry key, and the mounted target
is the mutation target. This removes both the disappearing-spinner problem and the eye-toggle
identity race without changing queue capacity or translation semantics.
