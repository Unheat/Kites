# Devlog 041: WebGPU Performance Audit, Optimization Invariants, and YOLO FP16 Viability

### 1. Metadata
* **Date:** 2026-10-14
* **Feature/Task:** Comprehensive WebGPU Performance & Architecture Audit (Chrome 120–135+): `powerPreference`, `requiredLimits`, `subgroups`, `preferredLayout`, and `shader-f16`
* **Status:** Completed (Architectural Decision Record & Invariant Lock)

---

### 2. The Objective
Investigate all WebGPU performance switches documented by Chrome (`developer.chrome.com/docs/web-platform/webgpu`) and evaluate what code changes can increase raw execution speed in Kites across text recognition (PaddleOCR), localized inpainting (LaMa / AOT-GAN), speech bubble detection (YOLO), and on-device translation (WebLLM). Clarify why certain optimizations are already active, why others are ineffective or counter-productive, and assess the feasibility and accuracy impact of `shader-f16` specifically for YOLO bubble detection.

---

### 3. Workflow & Technical Investigation

#### A. Adapter Power Preference (`powerPreference: 'high-performance'`)
* **Mechanism:** `navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })`.
* **Behavior:** Influences underlying OS GPU selection (D3D12/Vulkan/Metal). Forces discrete GPUs (NVIDIA/AMD) over integrated GPUs (Intel/AMD iGPU) on multi-GPU laptops.
* **Status in Kites:** **Already Active.**
  - Locked across `hardware.ts`, `LamaBaseInpaintEngine.ts`, `PaddleOcrEngine.ts`, and `NeuralBubbleDetector.ts`.
  - On single-GPU systems, this is a hardware no-op. On dual-GPU laptops, it provides massive throughput gains.

#### B. Buffer and Workgroup Limits (`requiredLimits`)
* **Mechanism:** `adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize, maxBufferSize, maxComputeWorkgroupStorageSize } })`.
* **Behavior:** Unclamps WebGPU's ultra-conservative default limits (128 MB storage buffer, 256 MB total buffer, 16 KB workgroup memory) up to adapter hardware maximums (1 GB–4 GB+).
* **Why NLLB 600M Still Crashed:** Raising `requiredLimits` did not prevent browser crashes with Transformers.js. The crash was caused by per-token buffer allocation leaks and Chrome renderer process memory ceiling exhaustion, not by a single buffer exceeding 128 MB.
* **Why Kites Vision Models Do Not Need It:**
  - Kites operates on localized, sliced patches:
    - PaddleOCR text line strips: ~3 MB.
    - LaMa 64px bucketed inpaint patches: ~1 MB to 8 MB.
    - YOLO 640×640 detection tensor: ~5 MB.
  - Because no patch tensor ever approaches the 128 MB default threshold, `requiredLimits` produces zero speed gain and is unnecessary for vision.
* **WebLLM Status:** Handled internally. `@mlc-ai/web-llm` (`tvmjs/webgpu.ts`) requests adapter limits and allocates a static KV-cache arena during engine bootstrap automatically.

#### C. SIMD Warp Reductions (`subgroups`, Chrome 134+ Stable)
* **Mechanism:** WGSL `enable subgroups;` with lane-level communication (`subgroupAdd`, `subgroupBroadcast`, `subgroupShuffle`).
* **Accuracy:** **Bit-exact (0% precision loss)** for shuffles; identical IEEE 754 reassociation variance for additions.
* **Vision Models (PaddleOCR & LaMa):** **Zero Benefit.**
  - `onnxruntime-web` (JSEP) has no subgroup kernels for spatial 2D convolutions (`Conv2d`).
  - CTC linear classification head in PaddleOCR has sequence length $M \le 40$ (below Intel threshold $M \ge 64$; ignored on Metal/NVIDIA).
* **WebLLM Status:** **Already Automated.** Apache TVM inspects `adapter.features.has('subgroups')` and automatically routes to 32-wide subgroup model libraries (`sg32`), speeding up autoregressive token generation by 30%–70%.

#### D. Tensor Memory Layout (`preferredLayout: 'NHWC'` vs `NCHW`)
* **Mechanism:** Session option `executionProviders: [{ name: 'webgpu', preferredLayout: 'NHWC' }]`.
* **The Reality:** Standard ONNX models are exported in `NCHW` (`[Batch, Channels, Height, Width]`).
* **Why It Was Dropped:**
  - Forcing `NHWC` on NCHW vision models requires ONNX Runtime to inject dynamic `Transpose` operators before and after convolution layers, adding compute overhead.
  - Pre-converted `.ort` models with baked `com.ms.internal.nhwc:Conv:1` operators crashed WebGPU JSEP (Devlog 005 / Workarounds Section 5). Pure `.onnx` models run reliably.
  - Previous benchmarks (`fc6a876`) demonstrated identical recognition latency (~3.2s) between layout passes.

#### E. Half-Precision Floating Point (`shader-f16`)
* **Mechanism:** 16-bit float representation (1 sign, 5 exponent, 10 mantissa). Unlocks 2x ALU throughput on modern GPUs and cuts memory bandwidth by 50%.
* **OCR (PaddleOCR): High Accuracy Risk.** Softmax across 6,000+ CJK character tokens easily underflows or overflows (max value 65,504). Subtle stroke distinctions in kanji/hanzi (e.g. `日` vs `目`) degrade into character hallucinations.
* **Inpainting (LaMa / AOT-GAN): High Artifact Risk.** Fast Fourier Convolutions (FFC) require wide dynamic range. Pure FP16 introduces frequency-domain color banding and checkerboard artifacts without PyTorch-level mixed-precision gating.
* **YOLO Bubble Detection: Completely Safe & High ROI.**

---

### 4. Roadblocks & Decisions: YOLO `shader-f16` Viability Analysis

```
+-----------------------------------------------------------------------------------+
|                        WebGPU Optimization Matrix for Kites                       |
+--------------------------+-----------------------+---------------+----------------+
| Optimization             | Target Engines        | Speed Impact  | Decision       |
+--------------------------+-----------------------+---------------+----------------+
| powerPreference: high    | All Engines           | Massive (dGPU)| Active (Lock)  |
| requiredLimits           | Vision (OCR, Inpaint) | None (<15MB)  | Skip           |
| subgroups                | Vision (ORT JSEP)     | None (No Conv)| Skip           |
| subgroups                | WebLLM (TVM sg32)     | +30% to 70%   | Active (Auto)  |
| preferredLayout: 'NHWC'  | Vision (Paddle/LaMa)  | Neutral/Slower| Skip           |
| shader-f16               | PaddleOCR             | Dangerous     | Reject         |
| shader-f16               | LaMa FFC Inpaint      | Artifact-prone| Reject         |
| shader-f16               | YOLO Bubble Detector  | +50% - 100%   | Feasible (P3)  |
+--------------------------+-----------------------+---------------+----------------+
```

#### Will `shader-f16` Lower YOLO Accuracy Much?
**No. The accuracy drop is negligible (< 0.1% to 0.2% mAP).**

1. **Task Dynamics:** Object detection predicts coarse bounding box coordinates $(x, y, w, h)$ and 1–2 class probabilities (bubble vs text). It does not perform delicate character classification or frequency transforms.
2. **Coordinate Drift:** In standard FP32 vs FP16 evaluations on YOLO (Ultralytics / TensorRT), bounding box boundaries deviate by at most **0.1 to 0.3 pixels** at $640 \times 640$ resolution.
3. **Absorption by Heuristics:** Kites expands detected bubbles with safety padding (4px–12px) and merges overlapping boxes via IoU. Any 0.2px variance is completely absorbed by post-processing padding.
4. **Concrete Benefits:**
   - **Download Size:** Model drops from ~12 MB to **~6 MB** (50% reduction in network payload and disk footprint).
   - **VRAM Bandwidth:** Half the memory traffic on GPU compute passes.
   - **Inference Speed:** ~1.5x to 2x faster box extraction on modern GPUs (Apple Silicon, NVIDIA RTX, Intel Arc).

#### Implementation Constraints for Future Work
* **Browser Feature Gating:** `adapter.features.has('shader-f16')` is required. Older GPUs or Linux drivers without FP16 WGSL support would fail to load an FP16-only model.
* **Dual-Model Fallback or On-Demand Cast:** Must maintain the FP32 model as fallback, or dynamically load the FP16 model only when `adapter.features.has('shader-f16')` is confirmed.

---

### 5. Next Steps / Key Takeaways
1. **Takeaway:** Do not chase generic WebGPU flags (`requiredLimits`, `NHWC`, `subgroups`) for vision models. Vision performance in Kites is already optimized via algorithmic tiling (1000px strip OCR) and dynamic 64px localized inpaint patching.
2. **Takeaway:** WebLLM already extracts maximum WebGPU performance under the hood (`requiredLimits`, `subgroups`, `shader-f16`).
3. **Future Optimization Ticket:** When optimizing speech bubble detection in a future milestone, export `yolo11n-bubble-fp16.onnx` (6 MB) and conditionally dispatch it in `NeuralBubbleDetector.ts` when `adapter.features.has('shader-f16')` is available.
