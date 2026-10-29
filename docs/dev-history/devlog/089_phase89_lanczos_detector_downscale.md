# Devlog 089: Explicit Lanczos3 Detector Downscale

### 1. Metadata
* **Date:** 2026-10-29
* **Feature/Task:** Replace the high-smoothing drawImage downscale with a deterministic pure-JS Lanczos3 filter for OCR detection preprocessing
* **Branch:** `fix/lanczos-detector-downscale`
* **Status:** Completed (unit-verified; page-level recall A/B still pending the user's raw pair)

---

### 2. The Objective
The 请老师相信我! region remained undetected at full resolution even after the `imageSmoothingQuality: 'high'` adapter (Devlog 088), while the site-preview (sharper, externally resized) version of the same page detects. Request: find the best downscale for PaddleOCR specifically, keeping padding and normalization unchanged.

### 3. Research Result
* PaddleOCR's own detection preprocess (`DetResizeForTest`) uses unfiltered `cv2.INTER_LINEAR` — an aliased, stroke-preserving scale, not a smooth mipmap.
* Published consensus for shrinking small text: area/box or Lanczos3; Lanczos preserves stroke sharpness best. No published DBNet benchmark compares kernels — the gap is real, so the choice is principled, not proven.
* Mechanism consistent with the evidence: Chrome's `drawImage` downscale is mipmap/trilinear, which at 0.53× blurs 1–2px manga strokes into gray before DBNet's 0.3 probability threshold; a sharper kernel keeps the stroke contrast the model was trained on.

### 4. Implementation
`DetectionResize.ts` now performs the downscale itself with a separable Lanczos3 RGBA resampler (`resampleLanczos3Rgba`): for downscaling the kernel support scales with the ratio (support = 3/scale), so each destination pixel integrates the source area (anti-aliasing) while the sinc's negative lobes restore edge contrast; edge clamping and weight normalization are explicit; a float horizontal pass feeds the vertical pass. The result is written through `putImageData` at the dependency's exact unpadded target size — its internal draw stays 1:1 and padding/normalization/32px rounding are untouched. If pixel access is unavailable, the explicit high-smoothing `drawImage` path remains as a logged fallback. Resize formula, ratio restoration, and pass-through within the limit are unchanged.

### 5. Testing & Verification
* Pure-math suite: constant passthrough exactness; mass conservation (2:1 black/white split averages near half intensity); edge-contrast preservation where box averaging would flatten (adjacent dst pixels keep > 40 levels of difference); determinism and dimension validation.
* Adapter suite: Lanczos path writes the full target image (680×960 for the reported 1280×1808 page), within-limit pass-through, and fallback behavior.
* Full suite/typecheck/build/lint green. **Page-level detection recall is not yet benchmarked** — the decisive test remains the user's raw full-resolution page through the extension with this filter, ideally alongside a Lanczos-vs-default A/B.

### 6. Next Steps / Key Takeaways
1. User retests the failing page; if still missed, next levers are a higher det limit (960→1216) or crop upscaling — kernel choice alone cannot preserve strokes that drop below ~1px.
2. Key lesson: `imageSmoothingQuality` is a hint, not a kernel; only an explicit filter gives cross-browser deterministic OCR input.
