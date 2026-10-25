# Devlog 068: Tier 2 CPU Pipeline Smoke Test Matrix & CI Workflow

### 1. Metadata
* **Date:** 2026-10-25
* **Feature/Task:** Tier 2 Pipeline Integration Smoke Test Matrix, Headless Assertions, and GitHub Actions CI Workflow
* **Status:** Completed
* **Branch:** `feat/pipeline-smoke-ci`

---

### 2. Objective
Introduce a dedicated Tier 2 CPU Pipeline Integration Smoke Test running end-to-end translation pipelines (CPU PaddleOCR + Inpainting + Bubble Detection + Manga Colorization + Typesetting) across representative architectural combinations in under 1 minute, triggered automatically on pushes to `main` and PRs touching `src/offscreen/**`.

---

### 3. Architecture & Test Matrix

1. **Representative Tier Combinations (`src/test/pipelineSmokeMatrix.ts`)**:
   - **Combo 1 (Baseline Fast)**:
     `v6-small` OCR + `simple` dominant inpainting + `bubble off` + `color none` + default diamond typesetting on `image1.jpg` and `image8.png`.
   - **Combo 2 (Advanced Inpaint & Carrier Extraction)**:
     `v6-small` OCR + `telea` FMM inpaint (~213ms) + `heuristic` bubble carrier extraction + balloon typesetting on `image1.jpg`.
   - **Combo 3 (Neural Curvature & Two-Phase DP Ellipse)**:
     `v6-small` OCR + `simple` inpaint + `bubble neural` + two-phase DP ellipse solver (`wrapTextEllipse`) on `image1.jpg`.
   - **Combo 4 (Neural Manga Colorization)**:
     `v6-small` OCR + `manga-colorization-v2` neural FP16 U-Net with CIELAB $L^*$ linework fusion (~6.7s on CPU) + `simple` inpaint on colorized buffer + vector typesetting on `image1.jpg`.

2. **Quality Gates & Assertions**:
   - Verifies OCR extracted text blocks (`texts.length > 0`).
   - Verifies inpainting returns valid, non-empty PNG buffer (`byteLength > 5000`).
   - Verifies translation array length matches OCR blocks.
   - Verifies typesetting renders valid text blocks (`rendered.length > 0`).
   - Verifies final composite PNG is written to `src/test/result/pipeline_smoke/` with non-trivial file size (> 15 KB).
   - Exits with `0` on complete success; exits `1` with explicit fatal logs on failure.

3. **Existing Script Hardening**:
   - Updated `src/test/pipelineVisualTest.ts` and `src/test/pipelineVisualBubbleTest.ts` to export their runner functions and exit nonzero (`process.exit(1)`) on fatal errors instead of silently swallowing exceptions in CI.
   - Added on-demand HuggingFace download helper in `src/test/pipelineVisualColorTest.ts` and `src/test/pipelineSmokeMatrix.ts`.

4. **CI Workflow Configuration (`.github/workflows/pipeline-smoke.yml`)**:
   - Paths filter: `src/offscreen/**`, `src/shared/**`, `src/test/**`.
   - Caches `src/test/models` via `actions/cache@v4`.
   - Uploads baked result PNGs as GitHub Actions artifact (`pipeline-smoke-results`) for direct visual verification from run logs.

---

### 4. Verification
* **Local Smoke Run**: `npm run test:pipeline:smoke` completed all 4 combinations in ~20s, generating 5 baked PNG files (330KB–559KB).
* **Unit Test Suite**: All 93 test files and 1017 tests passed (`npm test`).
* **Production Build**: Built cleanly in 1.95s (`npm run build`).
