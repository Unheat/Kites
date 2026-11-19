# Frontend subsystems (brief)

Deliberately short. Per [the documentation guide](../doc_guide.md), frontend layers get a high-level
view only: responsibilities, data flow, entry points. Their behaviour is verified by running the
extension, not by per-symbol docs.

## Popup (`src/popup/`)

- **Responsibility**: configuration surface. Writes `PopupState` to `chrome.storage.local` and reports
  model/download status.
- **Data flow**: reads `STORAGE_KEYS.POPUP_STATE` on open → renders settings → serialized writes back
  through the background worker (concurrent popup writes are normalized there).
- **Entry point**: `App.tsx` → `SettingsView` panels; engine/model catalogs come from `src/shared/`
  registries, never from hardcoded lists in components.
- **Custom APIs**: `ApiManagerPanel` lists saved entries and supports add, edit and delete. Editing
  reuses `AddApiForm` with the saved configuration, keeps its `id`, and shows only a blank key
  replacement field (blank means keep the stored key).

## Content script (`src/content/`)

- **Responsibility**: discover translatable media on the host page, show the per-image translate
  control, request translation, and swap the result in without breaking the page.
- **Data flow**: `MediaTarget` discovery → per-image control state (idle, pending, translated) →
  `TRANSLATE_IMAGE` message with the stable original image URL → background queues the job →
  offscreen returns a baked data URL → same-origin blob swap with a reversion shield. Pending
  controls stay pinned to their own image while the pointer moves; hover and automatic queues
  share the same state.
- **Entry point**: `index.tsx`; media discovery in `mediaTargets.ts`, overlay placement in
  `overlayPlacement.ts`.
- **Known constraints**: clear `srcset` on swap; treat its own mutations as self-mutating; never run
  DOM-dependent libraries off the page.

## Background worker (`src/background/`)

- **Responsibility**: job queue, deduplication, queue-capacity limits, auth, and routing between content
  script and offscreen document. One pipeline runs at a time; the popup's `concurrency` value sets how
  many jobs may wait in the queue.
- **Data flow**: receives runtime messages → validates the route (`target`, `source`, `request`) →
  forwards to offscreen → relays completion back to the tab.
- **Entry point**: `index.ts`; message contracts in `src/shared/types.ts`.

## Studio (`src/studio/`)

- **Responsibility**: non-destructive page editor. Clean plate + editable text objects, typesetting
  engine switching, export.
- **Data flow**: IndexedDB (`images`, `textBlocks`) → canvas render of the clean plate plus text
  objects → edits persist back to `textBlocks`; re-OCR of a crop goes through `StudioOcr`.
- **Entry point**: `Studio.tsx` → `canvas/StudioCanvas.tsx`; text painting in `canvas/TextRenderer.ts`.
- **Shared behaviour**: Studio uses the same page-text prefix (`analyzePageText`) and the same preserved
  artwork rule as the reader. Anything that changes either must be changed in `src/offscreen/`, not
  copied into Studio.

## What this doc intentionally omits

Component props, hook signatures, CSS tokens, and state-machine internals. Those are cheaper to read
from the components themselves and change too often to keep prose true.
