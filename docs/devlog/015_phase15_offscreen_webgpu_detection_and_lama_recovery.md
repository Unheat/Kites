### Date: 2026-09-08

* **Feature/Task:** Offscreen WebGPU Capability Detection and LaMa WASM Recovery
* **Commit:** `d41af6b`
* **Status:** Completed

### Objective

Restore fast `lama-manga` inpainting after the extension began selecting ONNX Runtime Web's WASM execution provider even when GPU acceleration was enabled. Preserve the mandatory high-performance adapter request that previously prevented LaMa from freezing on an unsuitable low-power or software adapter. Add deterministic WASM recovery when WebGPU fails during session creation or inference.

### User-Visible Incident

A translated page logged:

```text
[PaddleOcrEngine] WebGPU Available: false. Initializing service...
[PaddleOcrEngine] Active ONNX Execution Providers: ["wasm"]
[LamaBaseInpaintEngine] Hardware checks complete. Selected provider: wasm
[LamaBaseInpaintEngine] Starting Phase 1 inference for 1 patches using unknown...
[PipelineOrchestrator] Full Pipeline finished in 28828.40ms.
```

The page contained one clustered 512×512 LaMa inference patch. Patch construction had not multiplied the workload. The slowdown came from that patch running on CPU WASM instead of WebGPU. Earlier `lama-manga` tests completed in roughly 7–8 seconds for the full pipeline; the regression increased this run to approximately 28.8 seconds.

Checking out older Git branches did not restore performance because two independent state paths survived code changes: persisted popup preferences in `chrome.storage.local`, and a cached LaMa engine/session inside the still-running offscreen document. Chrome extension storage and an existing offscreen document can both survive source checkouts and ordinary rebuilds/reloads.

### Root Cause

`checkWebGPUAvailability()` was imported and executed directly by `popup.html`. The popup and `offscreen.html` are separate browser execution contexts and do not necessarily receive the same WebGPU capability or adapter allocation. A transient popup capability failure wrote:

```text
hardware_webgpu_supported: false
```

into shared `chrome.storage.local`.

The offscreen document later read that persisted value and returned `false` before requesting its own adapter. OCR and LaMa therefore selected WASM without testing WebGPU in the document that performs inference.

The Settings **Re-check** action called the ordinary cached check instead of clearing the cached value, so it repeatedly returned the same persisted `false`.

A race also existed between popup-state hydration and the fresh capability result. If both requests ran concurrently, persisted `PopupState.webgpuSupported` could overwrite the newer offscreen result. Popup storage writes were read-modify-write operations without serialization, so rapid updates could also complete out of order and restore stale fields or incomplete legacy nested overrides.

Finally, `InpaintManager` cached the initialized LaMa engine only by tier. Changing Image Cleaning GPU preference changed the requested provider but reused the old WebGPU/WASM session. Provider selection therefore had to participate in the cache reuse decision; capability probing alone could not switch an already-created engine.

Offscreen RPC messages also lacked an explicit owner. Because `chrome.runtime.sendMessage` broadcasts to extension contexts, background and offscreen listeners could both observe popup requests and compete to answer. Requests now carry minimal `target`, `source`, and `request` markers: popup/dashboard target background, background retargets offscreen, and offscreen ignores every message not explicitly forwarded by background.

### Why Unrelated Features Appeared to Break at Once

No single macOS update or new LaMa algorithm change caused the incident. Several dormant defects shared the popup/background/offscreen boundary and were hidden while Chrome retained a healthy runtime state.

The previously working state included a complete persisted popup object, an already-created WebGPU LaMa session, cached models, and extension contexts whose first responding message listener happened to be the intended one. A source rebuild, extension reload, storage reset, popup remount, or offscreen recreation changed initialization order and exercised the broken paths together:

1. Popup React state began from `DEFAULT_POPUP_STATE`, so the UI displayed WebGPU support and enabled switches.
2. Background could return a sparse historical `popupState`; offscreen interpreted a missing `webgpuMaster` as false because its condition requires the value to be exactly `true`.
3. Unserialized popup writes could persist older snapshots after newer ones, widening the difference between visible React state and background state.
4. LaMa initialized once with WASM and `InpaintManager` cached that tier-only engine, so later WebGPU rechecks did not replace the existing session.
5. Large single-threaded WASM inference consumed enough extension renderer/CPU resources to make the popup appear frozen.
6. Unaddressed runtime messages let background and offscreen listeners compete to respond, causing closed ports and unrelated controls such as authentication or status queries to fail when a context reloaded mid-request.
7. A fresh WebLLM model exposed a separate HTML bug: its visible download icon was a descendant of the disabled model-selection button, so Chrome suppressed the click before any message or log existed.

This explains the misleading observation that old branches, an extension reinstall, and a macOS restart retained the failure. Git changes source files but not the exact historical combination of Chrome profile storage, IndexedDB/model cache, extension IDs, popup lifetime, offscreen lifetime, service-worker lifetime, or the previously compiled WebGPU session. Restarting recreated the same deterministic application paths and therefore reproduced the same bugs.

### WebLLM Download Control Failure

Uninstalled WebLLM rows are intentionally not selectable until their model is downloaded. The old markup placed the download action inside that disabled native row button. Disabled buttons suppress activation for their descendant subtree, so the icon was visible but its handler never ran:

```text
click download icon
  -> browser suppresses event at disabled ancestor
  -> no START_MODEL_DOWNLOAD
  -> no background log
  -> no error response
  -> UI appears dead
```

The model-selection button and download button are now siblings. Downloads use an explicit background-targeted request, await offscreen acknowledgement, show `Queued` immediately, prevent duplicate clicks, and expose a visible failed status when registration fails.

### Explicit Runtime Message Ownership

Chrome documents that `runtime.sendMessage()` delivers a message to extension listeners and, when multiple `onMessage` listeners respond, only the first response affects the sender while the other listeners still run. Kites previously treated this broadcast as a point-to-point RPC:

```text
popup broadcasts request
  -> background receives it
  -> existing offscreen document may also receive it
  -> background rebroadcasts unchanged request
  -> listeners compete to answer
```

Kites now adds minimal routing metadata. Popup/dashboard control requests target background. Background is the single public request owner and retargets a new message to offscreen. Offscreen accepts requests only when `target === 'offscreen'`, `source === 'background'`, and `request === true`. These guards are required architecture, not decorative metadata.

### Mandatory High-Performance Adapter Constraint

Keep this adapter request:

```typescript
navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
```

Do not replace it with an unqualified `requestAdapter()` call and do not add an unqualified adapter fallback. Earlier live testing found that Chrome could assign an unsuitable low-power or software adapter to the extension offscreen document when the preference was omitted. LaMa would then freeze rather than provide useful acceleration.

The capability probe and ONNX Runtime Web configuration must both retain `powerPreference: 'high-performance'`.

### Implemented Architecture

#### 1. Offscreen-Owned Capability Detection

The popup sends `CHECK_WEBGPU_SUPPORT` to the background service worker. Background ensures the offscreen document exists and forwards the request. Only `offscreen.html` calls `navigator.gpu.requestAdapter()`.

The popup no longer imports the offscreen hardware utility directly. Its status badge now reports the capability of the context that runs OCR and inpainting.

On popup startup, normalized popup state is loaded first. The offscreen capability request runs afterward so a stale persisted status cannot overwrite the fresh result.

#### 2. Successful Capability Cache Only

`checkWebGPUAvailability()`:

1. Requests only a high-performance adapter.
2. Calls `adapter.requestDevice()` to verify that a logical device can actually be allocated.
3. Destroys the temporary probe device.
4. Caches and persists only verified `true`.
5. Removes and ignores historical persisted `false` values.
6. Returns `false` for a failed attempt without permanently storing it.

A transient GPU process failure, restricted caller context, or temporary allocation failure can therefore be checked again after reload or through **Re-check**.

#### 3. Exact Inpainting Toggle Semantics

LaMa reads the normalized popup state before probing hardware.

```typescript
const gpuEnabled = popupState.webgpuMaster === true &&
  popupState.webgpuOverrides?.inpaint !== false;
```

Behavior:

- Global GPU off: create WASM session directly; do not probe or initialize WebGPU.
- Image Cleaning GPU off: create WASM session directly; do not probe or initialize WebGPU.
- Both switches on and offscreen probe succeeds: create WebGPU session.
- Both switches on but probe fails: create WASM session.

The user preference controls whether WebGPU may be attempted. Hardware capability does not override an explicit disabled switch.

#### 4. WebGPU Session-Creation Recovery

ONNX Runtime Web can receive a valid adapter and still fail while compiling the LaMa graph. When the requested provider is WebGPU:

1. Try creating a WebGPU session.
2. Log the original failure if creation throws.
3. Create a new WASM session from the already cached model buffers.
4. Propagate the error only if WASM session creation also fails.

The code uses explicit session recreation rather than relying on a mixed provider array, making the selected provider and failure path deterministic.

#### 5. WebGPU Runtime Recovery

A WebGPU session can initialize successfully and lose its device during `session.run()`. LaMa now tracks its active provider explicitly.

When a patch fails on WebGPU:

1. Release the failed WebGPU session.
2. Create one WASM replacement session.
3. Retry the failed patch once.
4. Run all remaining patches through WASM.

A WASM failure is propagated immediately. No repeated provider transitions or infinite retry loop are allowed.

Provider logs now use the tracked value (`webgpu`, `wasm`, or `cpu`) rather than reading unavailable session options and printing `unknown`.

### LaMa Patch Processing Kept Unchanged

This incident did not justify changing the inpainting algorithm. Kites continues to:

1. Build a polygon mask.
2. Cluster nearby text boxes.
3. Produce padded square source crops.
4. Resize each crop and mask to fixed 512×512 tensors.
5. Run patches sequentially with batch size 1.
6. Dispose input and output tensors after each inference.
7. Composite masked output into the original-resolution page.

This remains appropriate for browser WebGPU. Fixed tensor shapes avoid repeated WGSL pipeline compilation and buffer churn. Sequential execution avoids ONNX Runtime Web's `Session already started` failure. Explicit disposal prevents VRAM accumulation across manga pages.

XianScan's native Rust implementation also processes patches sequentially, but its dynamic native-size tensors run through native ONNX Runtime providers such as CUDA, CoreML, or DirectML. Copying those dynamic shapes directly into ONNX Runtime Web would introduce different compilation and memory behavior. Cotrans's single full-page downscale/inpaint/upscale approach would also reduce untouched high-resolution artwork quality. Neither approach was ported as part of this repair.

### Regression Guards

Tests cover:

- Historical persisted `false` is removed and a fresh high-performance probe runs.
- Failed capability validation is not persisted.
- Verified `true` is reused without another adapter request.
- WebGPU patch failure releases the GPU session, creates a WASM session, and retries once.
- WASM patch failure propagates without another fallback.

Verification after implementation:

```text
Test Files  29 passed (29)
Tests       180 passed (180)
```

`npm run build` also completed successfully with the existing Vite plugin deprecation and large-chunk warnings only.

### Future Maintenance Rules

1. Never probe WebGPU directly from `popup.html` for inference decisions.
2. Never persist WebGPU capability `false` as permanent hardware truth.
3. Never remove `powerPreference: 'high-performance'` from the offscreen adapter probe or LaMa ONNX Runtime configuration without a real Chrome extension test proving the freeze no longer occurs.
4. Never let persisted popup state overwrite a newer offscreen capability result.
5. When Image Cleaning GPU is disabled, do not probe or initialize WebGPU for LaMa.
6. When enabled, try WebGPU first and retain the explicit one-way WASM recovery.
7. Keep fixed 512×512 sequential inference and explicit tensor disposal unless ONNX Runtime Web behavior is revalidated with multi-page stress testing.
8. Do not infer the active provider from undocumented session internals; maintain explicit provider state and log it.
9. Never return sparse stored popup state to a consumer; always normalize over `DEFAULT_POPUP_STATE` with a deep `webgpuOverrides` merge.
10. Keep popup storage writes in one serialized chain; never restore independent async read-modify-write persistence.
11. Every offscreen RPC must carry `target`/`source`/`request` markers; never remove the background or offscreen listener guards.
12. Keep model download controls as siblings of disabled selection rows; never nest an interactive control inside a disabled `<button>`.
13. `InpaintManager` cache keys must account for the requested provider; never reuse a LaMa session whose provider differs from the current setting.
14. When GPU capability, provider selection, or message routing changes, record the reasoning here and in `AGENTS.md` before editing code.
