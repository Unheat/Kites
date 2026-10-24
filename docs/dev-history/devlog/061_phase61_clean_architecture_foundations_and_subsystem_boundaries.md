# Devlog 061: Phase 61 - Clean Architecture Foundations & Subsystem Boundaries

### 1. Metadata
* **Date:** 2026-10-24
* **Feature/Task:** Clean Architecture Refactoring & Subsystem Boundary Enforcement
* **Branch:** `refactor/clean-architecture-foundations`
* **Status:** Completed

---

### 2. The Objective
Eliminate structural object-oriented anti-patterns identified during the architectural audit—specifically leaky UI state dependencies, LSP violations through `instanceof` downcasting, inheritance for code reuse between disparate ML architectures, and monolithic God files—while strictly preserving all browser library workarounds and numerical invariants locked in `docs/development/workarounds.md`.

---

### 3. Current Workflow & Implementation Steps

#### A. Decouple `IBubbleEngine` from Extension UI State (Interface Segregation)
1. **Defined `BubbleEngineOptions`**: Replaced `PopupState` in `IBubbleEngine.init()` and `IBubbleEngine.detect()` with a focused options bag (`preferGpu?: boolean; mode?: 'box' | 'mask'`).
2. **Boundary Translation in `BubbleManager`**: In `src/offscreen/services/BubbleManager.ts`, added `resolveEngineOptions(mode, popupState)` to translate extension preferences into pure geometric/runtime options at the service boundary.
3. **Engine Isolation**: `BaseBubbleEngine.ts`, `NeuralBubbleEngine.ts`, and `HeuristicBubbleEngine.ts` no longer import `PopupState`.

#### B. Polymorphic Provider Cache Invalidation (LSP Compliance)
1. **Declared Capability on Interface**: Added optional `isProviderCurrent?(): Promise<boolean>` to `IInpaintEngine`.
2. **Polymorphic Implementation**: `LamaBaseInpaintEngine` implements `isProviderCurrent()` by comparing its active provider with current hardware/storage intent.
3. **Eliminated Downcasting**: In `InpaintManager.canReuseActiveEngine()`, replaced `instanceof LamaBaseInpaintEngine` with `if (typeof this.activeEngine.isProviderCurrent === 'function')`. Removed unnecessary `LamaBaseInpaintEngine` import from `InpaintManager.ts`.

#### C. Composition over Inheritance (`OnnxInpaintRuntime`)
1. **Extracted `OnnxInpaintRuntime`**: Created `src/offscreen/engines/inpaint/OnnxInpaintRuntime.ts` to manage ONNX Runtime session lifecycle, model buffer resolution, WebGPU initialization with WASM fallback, and one-way runtime retry on WASM in `runPatch()`.
2. **Extracted Canvas Utilities**: Created `src/offscreen/utils/inpaintCanvasUtils.ts` (`createInpaintCanvas`, `inpaintCanvasToArrayBuffer`).
3. **Decoupled `AotInpaintEngine`**: Removed `extends LamaBaseInpaintEngine`. `AotInpaintEngine` now directly implements `IInpaintEngine` and composes `OnnxInpaintRuntime`. All dynamic 64px bucket snapping, 128px minimum patch size, 4px round stroke expansion, and 3 scratch canvas pooling remain 100% identical.

#### D. Constructor Dependency Injection in `PipelineOrchestrator`
1. **Defined `PipelineServices`**: Grouped `ocrManager`, `inpaintManager`, `translationManager`, and `bubbleManager` into an injectable services record.
2. **Constructor Injection**: `PipelineOrchestrator` accepts `services?: Partial<PipelineServices>`, defaulting to existing singletons/instances. Added unit tests for isolated mock injection.

#### E. Leaf Extraction of `imageReplacer.ts` from `content/index.tsx`
1. **Extracted `src/content/imageReplacer.ts`**: Encapsulated Workaround 3 (SPA responsive image replacement, `srcset` clearing, same-origin Blob URLs, MutationObserver reversion shield with `isSelfMutating` tick guard, and background suppression).
2. **Streamlined `content/index.tsx`**: Kept React application mounting, scanning, and UI overlay while importing tested replacement helpers.

---

### 4. Roadblocks & Decisions
* **Decision on `instanceof` Cache Invalidation**: Rather than introducing heavy DI frameworks, used an optional capability method (`isProviderCurrent`) on `IInpaintEngine`. Engines without dynamic hardware providers (e.g. `SimpleInpaintEngine`, `TeleaInpaintEngine`) do not implement it, maintaining simplicity without type pollution.
* **Preserving Test Spies in `AotInpaintEngine`**: Existing unit tests in `AotInpaintEngine.test.ts` cast the engine `as any` and spy on `runPatch` and `createCanvas`. Maintained delegating helper methods on `AotInpaintEngine` so existing test suites pass without requiring brittle test rewrites.

---

### 5. Key Takeaways & Verification
* **Test Suite Verification**: All 86 test files and 916 unit/integration tests passed (`npm test -- --run`).
* **Build Verification**: `npm run build` compiled cleanly without TypeScript or Vite bundler errors.
* **Workaround Stability**: Devlog 015 (WebGPU fallback), Workaround 3 (SPA reversion shields), and Workaround 4 (dynamic 64px patch buckets) verified intact.
