# Devlog 039: WebLLM 0.2.86 & ONNX Runtime 1.30 Upgrade

### 1. Metadata
* **Date:** 2026-10-14
* **Feature/Task:** Dependency Upgrade: `@mlc-ai/web-llm` to 0.2.86 and `onnxruntime-web` to 1.30.0
* **Branch:** `feat/bump-webllm-0.2.86` (PR #18 merged at `01c5a28`)
* **Status:** Completed

---

### 2. The Objective
1. **Upstream WebGPU Shader & Engine Fixes:** Upgrade `@mlc-ai/web-llm` from 0.2.84 to 0.2.86 to incorporate latest MLC WebGPU pipeline optimizations, improved buffer recycling, and enhanced support for recent Qwen and Llama weight formats.
2. **ONNX Runtime Alignment:** Bump `onnxruntime-web` to `^1.30.0` ensuring JSEP compatibility and parity between node tests (`onnxruntime-node`) and browser offscreen execution.

---

### 3. Workflow & Implementation Steps

#### A. Dependency Bumps & Lockfile Reconciliation
1. **Package Manifest Update:**
   - Updated `@mlc-ai/web-llm` to `^0.2.86`.
   - Updated `onnxruntime-web` to `^1.30.0`.
2. **Merge Conflict Resolution:**
   - Sibling PR #17 introduced `jszip` into `package.json` while PR #18 touched WebLLM dependencies.
   - Cleanly rebased on merged `main`, re-ran `npm install --package-lock-only`, and resolved lockfile merge markers.

#### B. Runtime Compatibility Verification
1. **WebLLMEngine Validation:**
   - Ran automated WebLLM contract verification: validated `CreateMLCEngine` instantiation, `resetChat()` transaction boundaries, Keyed JSON schema generation, and watchdog timeout handling.
2. **ONNX JSEP & WASM Parity Check:**
   - Verified that PaddleOCR v6 small/medium sessions load cleanly with updated execution provider configs.
   - Verified LaMa Manga and AOT-GAN patch inpainting engines against 64px bucket alignment under ORT 1.30.

---

### 4. Roadblocks & Decisions

* **Issue:** Concurrent lockfile modifications across parallel branches resulted in git conflict markers inside `package-lock.json`.
  * **Solution:** Used `npm install --package-lock-only` on the reconciled `main` branch to deterministically recalculate tree hashes rather than manually editing JSON lines.

---

### 5. Verification
* All 69 Vitest test suites (692 tests) passed.
* `npm run build` completed with zero bundling warnings.
