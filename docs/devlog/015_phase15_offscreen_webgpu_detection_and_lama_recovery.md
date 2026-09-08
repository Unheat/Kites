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

Checking out older Git branches did not restore performance because the incorrect capability result lived in `chrome.storage.local`, outside the Git working tree. Chrome extension storage survives source checkouts, rebuilds, and ordinary extension reloads.

### Root Cause

`checkWebGPUAvailability()` was imported and executed directly by `popup.html`. The popup and `offscreen.html` are separate browser execution contexts and do not necessarily receive the same WebGPU capability or adapter allocation. A transient popup capability failure wrote:

```text
hardware_webgpu_supported: false
```

into shared `chrome.storage.local`.

The offscreen document later read that persisted value and returned `false` before requesting its own adapter. OCR and LaMa therefore selected WASM without testing WebGPU in the document that performs inference.

The Settings **Re-check** action called the ordinary cached check instead of clearing the cached value, so it repeatedly returned the same persisted `false`.

A race also existed between popup-state hydration and the fresh capability result. If both requests ran concurrently, persisted `PopupState.webgpuSupported` could overwrite the newer offscreen result.

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
