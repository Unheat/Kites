# Devlog: XianScan-Style Studio Dashboard & Reactive Image Workspace

* **Date:** 2026-09-05
* **Feature/Task:** Phase 11: Interactive Studio Dashboard with Pan/Zoom Canvas and Dexie Reactive History
* **Ticket/Issue Link:** N/A
* **Status:** Completed

---

## Objective

Build a full-screen, local-first interactive editor and image workspace (`src/App.tsx`) replacing the basic mock dashboard. Provide users with an elegant editorial UI for reviewing translations across original, cleaned, and final rendered states, editing text blocks in real time with immediate Dexie persistence, uploading raw images directly from disk, and exporting production-quality translated PNGs.

---

## Workflow & Implementation Steps

1. **Editorial Studio UI Scaffold (`src/App.tsx`):**
   * Designed a three-pane layout featuring an editorial theme (paper/vellum/ink/editorial color scheme) with dark and light mode toggle.
   * Constructed a left sidebar listing all historical `TranslationJob` records sorted in reverse chronological order with relative status badges (`queued`, `processing`, `completed`, `error`).
   * Built an interactive center viewport supporting smooth mouse-wheel zoom (clamped between 20% and 500%) and mouse-drag panning with a one-click reset control.
2. **View Mode Switching & SVG Overlay Layer:**
   * Implemented a segmented control switching the base image layer between:
     * `final`: Cleaned image with rendered SVG/HTML speech bubbles and bounding box highlights.
     * `cleaned`: Pure text-free inpainted background.
     * `original`: Raw source image directly from the user or webpage.
   * Rendered interactive SVG polygon overlays for every detected text block, highlighting active and hovered blocks.
3. **Reactive State & Live Dexie Persistence:**
   * Connected the active job to `db.images` and `db.textBlocks` via Dexie reactive hooks.
   * Wired real-time text input listeners in the right inspector panel so that modifying translated text immediately updates the local IndexedDB record (`db.textBlocks.update`).
4. **Local File Import (`fileInputRef`):**
   * Implemented a direct image file upload pipeline from disk.
   * Uploading creates a new `TranslationJob` in Dexie, persists the raw image `Blob`, marks the status as `processing`, and sends a `PROCESS_JOB` runtime message to the Offscreen Pipeline Orchestrator.
5. **Baked PNG Image Export (`handleExportPng`):**
   * Built a client-side Canvas compositor that loads the clean inpainted blob, scales to natural image dimensions, renders all translated text lines with black bold lettering and white stroke outlines, and triggers a direct browser PNG download.

---

## Roadblocks & Decisions

### Preserving Aspect Ratio and Pixel Coordinates on Resized Displays

* **The Problem:** The interactive viewport dynamically scales and translates with pan/zoom, making standard CSS absolute coordinate positioning drift away from actual image pixels.
* **The Solution:** Bound all coordinates to an intrinsic SVG viewBox equal to the image's `naturalWidth` and `naturalHeight`. Both the background image and the interactive SVG polygon overlays share this coordinate space, ensuring bounding boxes track pixel-perfect regardless of viewport zoom level.

### Offline/Local Image Ingestion Without Webpage Context

* **The Problem:** Previously, translations only began from content scripts running on web pages. Users needed a way to translate locally stored manga scans or OS snips.
* **The Solution:** Integrated an `Import` button using standard HTML file inputs. The raw file `Blob` is written straight to Dexie's `images` table and piped into `PipelineOrchestrator.runPipeline(jobId)` via background message passing.

---

## Verification

* Verified full interactive panning, zooming, and resetting across various image resolutions.
* Tested live text editing: verified that edits survive page refresh and persist in IndexedDB.
* Verified that exporting translated images generates a clean PNG containing properly centered text and stroke outlines matching the on-screen preview.

---

## Next Steps / Key Takeaways

* **Key Takeaway:** Using SVG coordinate viewBoxes for canvas overlays eliminates complex manual trigonometry when syncing DOM elements with zoomed image rasters.
* **Next Action:** Add keyboard shortcuts (Cmd+Plus, Cmd+Minus, Spacebar pan) to enhance the desktop editing workflow.
