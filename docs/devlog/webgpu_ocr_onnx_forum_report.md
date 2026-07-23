# Issue: WebGPU `com.ms.internal.nhwc:Conv:1` Error with PaddleOCR in 1.27.0

## Description
I am running a Chrome Extension with an Offscreen Document utilizing `onnxruntime-web` for local machine learning. 

We recently upgraded `onnxruntime-web` to `1.27.0` to fix a JSEP `Add` precision bug when running LaMa (Inpainting) on WebGPU. The Inpainting model now works flawlessly on WebGPU.

However, the upgrade caused our **PaddleOCR** (`ch_PP-OCRv3_det` / `rec`) models to fail WebGPU initialization and fall back to WASM. The WebGPU Execution Provider throws a kernel registry error because it cannot find the `com.ms.internal.nhwc:Conv` operator.

## Environment
* **Platform:** Chrome Extension (Manifest V3) - Offscreen Document
* **Library:** `onnxruntime-web` version `1.27.0` (using `ort.webgpu.mjs`)
* **Execution Provider:** `webgpu` (with fallback to `wasm`)
* **Hardware:** Mac (M-series / Apple Silicon)
* **Model:** PaddleOCR v3 (v6-small)

## Error Logs
```text
[W:onnxruntime:, session_state.cc:1367 VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the preferred execution providers which may or may not have an negative impact on performance. e.g. ORT explicitly assigns shape related ops to CPU to improve perf.

web-ADXxxaQW.js:1 [PaddleOcrService] executionProviders=["webgpu","wasm"] failed (Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: /mnt/azure_nvme_temp/_work/1/s/onnxruntime/core/framework/kernel_registry.cc:70 bool onnxruntime::(anonymous namespace)::MatchKernelDefTypes(const Node &, const std::unordered_map<std::string, std::vector<MLDataType>> &, const IKernelTypeStrResolver &, std::string &) [ONNXRuntimeError] : 1 : FAIL : kernel_type_str_resolver.cc:46 ResolveKernelTypeStr Failed to find op_id: com.ms.internal.nhwc:Conv:1
); falling back to ["wasm"].
```

## Troubleshooting Steps Attempted
1. **Disabled Graph Optimizations:** We suspected the ORT 1.27.0 WebGPU compiler was aggressively injecting `com.ms.internal.nhwc:Conv` layout optimizations at runtime. We explicitly set the session options to:
   ```javascript
   session: {
     executionProviders: [{ name: 'webgpu', powerPreference: 'high-performance' }, 'wasm'],
     graphOptimizationLevel: 'basic' // (Also tried 'none')
   }
   ```
   **Result:** The exact same error occurred. This suggests the `com.ms.internal.nhwc:Conv` operator is already baked into our exported `.onnx` model (likely optimized previously for CPU/WASM via `onnxruntime-tools`), rather than being injected at runtime by the browser.

## Questions for the Community / Maintainers
1. **Is `com.ms.internal.nhwc:Conv` explicitly unsupported in the WebGPU EP for `1.27.0`?** 
2. **Is there a session configuration flag** (e.g., a specific WebGPU layout optimization toggle) we can pass to `InferenceSession.create` to force the WebGPU EP to accept or auto-convert this node back to a standard format?
3. If this requires re-exporting the PaddleOCR model, what specific optimizer flags should be avoided during the Python ONNX export to ensure maximum compatibility with the `1.27.0` WebGPU Execution Provider?

We cannot downgrade `onnxruntime-web` because `1.27.0` fixed critical crashes for our heavy WebGPU inpainting models. Any guidance on getting these NHWC-optimized OCR models running natively on WebGPU would be highly appreciated!
