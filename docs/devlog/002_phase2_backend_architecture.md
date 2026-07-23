### Date: 2026-07-13

* **Feature/Task:** Phase 2: Orchestrator Service Worker & Offscreen Document
* **Ticket/Issue Link:** #PHASE-2
* **Status:** Completed

### Objective

Build the robust backend message routing required to bypass Chrome Manifest V3's Service Worker limitations (30-second termination limit, memory constraints, and lack of DOM access). Implement an Offscreen Document to host the heavy WebAssembly/ONNX processing logic.

### Workflow & Implementation Steps

1. **Shared Contracts:** Created `src/shared/types.ts` to strictly define the TypeScript message payloads (`ProcessProjectMessage`, `TranslateImageMessage`) between the isolated browser contexts.
2. **Offscreen Boilerplate:** Configured `manifest.json` with the `offscreen` permission and updated `vite.config.ts` (Rollup inputs) to build a hidden `offscreen.html` entry point.
3. **The Router:** Updated the Background Service Worker (`src/background/index.ts`) to manage the lifecycle of the Offscreen document, ensuring it boots up via `chrome.offscreen.createDocument()` before sending processing requests.
4. **Mock Processing:** Implemented `src/offscreen/index.ts` to receive processing requests, simulate a 3-second heavy ONNX delay, and generate a mock `TextBlock` array of translated text.

### Roadblocks & Decisions

* **The Problem (Memory Crashes):** Passing 10MB Base64 manga strings through Chrome's native message passing `chrome.runtime.sendMessage` causes massive memory spikes and frequent extension crashes.
* **The Solution (Zero-Copy Bus):** We bypassed Chrome's message serialization entirely. The Background Worker fetches the image and saves the Blob directly to IndexedDB (Dexie). It then sends a tiny integer (`projectId`) to the Offscreen Document.
* **Reasoning:** The Offscreen Document reads the Blob directly from the local disk database. This is a "Zero-Copy" architecture, keeping the memory footprint incredibly low and stable.

### Next Steps / Key Takeaways

* **Takeaway:** IndexedDB is an incredibly powerful tool not just for persistent storage, but as a high-performance message bus for circumventing Chrome Extension constraints.
* **Next Action:** Build a concurrent queue system in the background worker to handle the upcoming "Auto-Translate" feature without overwhelming the Offscreen Document, and then begin the Phase 2.5 Dashboard Canvas UI.
