# Devlog 060: Translation Models Dropdown Hierarchy & Tier Ordering

### 1. Metadata
* **Date:** 2026-10-24
* **Feature/Task:** Hierarchical Dropdown Ordering for Translation Engines (Cloud -> Best-of-Size -> Other Models)
* **Status:** Completed
* **Branch:** `feat/translation-models-dropdown-tier-ordering`

### 2. The Objective (The "Why")
Previously, uninstalled WebLLM models in the popup engine selection dropdown were sorted strictly alphabetically by model name (`left.name.localeCompare(right.name)`). Consequently, older Google Gemma models starting with 'g' (`gemma-2-2b...`) occupied the top slots right below Cloud Shared Pool, while state-of-the-art models like Qwen 3.5 were buried at the bottom under 'Q'. Users had to scroll through dozens of models or type into search just to find the recommended model for their machine size.

The objective was to structure the translation dropdown in a clear, intuitive hierarchy:
`Google Translate -> Cloud Shared Pool -> Custom APIs -> [Best of Each Size] (Smallest to Highest) -> [Other Models]`,
while keeping full search functionality intact via MiniSearch.

### 3. Current Workflow & Implementation Steps (The "How")

1. **Canonical Best-of-Size Model Tier Registry (`RECOMMENDED_TRANSLATION_MODELS`)**:
   In `src/popup/components/EngineSelectionPanel.tsx`, defined the benchmark-verified top model for each size tier, ordered from smallest to highest parameter count:
   ```ts
   export const RECOMMENDED_TRANSLATION_MODELS = [
     'Qwen3.5-0.8B-q4f16_1-MLC',        // Sub-1B (~0.8B)
     'Qwen3.5-2B-q4f16_1-MLC',          // 1B - 2B (~2B)
     'Qwen3.5-4B-q4f16_1-MLC',          // 3B - 4B (~4B)
     'Qwen3.5-9B-q4f16_1-MLC',          // 7B - 9B (~9B)
     'Llama-3.1-70B-Instruct-q3f16_1-MLC', // 70B Flagship
   ] as const;
   ```

2. **Hierarchical Catalog Ordering (`orderChangedCatalog`)**:
   Updated `orderChangedCatalog` for translation (`defaultId === 'gg-translate'`):
   - **Tier 1 (Priority 0)**: `gg-translate` (Google Translate) pinned first.
   - **Tier 2 (Priority 1)**: `cloudflare-translate` (Cloud Shared Pool) pinned second.
   - **Tier 3 (Priority 2)**: Custom APIs (`type === 'custom'`) pinned third.
   - **Tier 4 (Priority 3)**: Best-of-size recommended models in ascending size order (`0.8B -> 2B -> 4B -> 9B -> 70B`).
   - **Tier 5 (Priority 4)**: All remaining WebLLM models (downloaded models prioritized first, followed by alphabetical order).
   - Preserved existing generic sort behavior for Inpaint (`simple`), OCR (`v6-small`), and test fixtures.

3. **Expanded Dropdown Viewport Slice (`displayedEngines`)**:
   Increased initial display slice from 50 to 100 to ensure all 59+ registered models are visible in the scrollable view without truncation when no search filter is applied.

4. **Preserved Full Search Flexibility**:
   `MiniSearch` continues to index all models across `name`, `id`, `hardware`, and `type`. Typing any query (e.g. "gemma", "qwen", "llama") immediately filters and ranks matching models dynamically.

### 4. Roadblocks & Decisions (The Pivot Points)

* **Separation of Translation vs Inpaint/OCR Sorting**:
  `orderChangedCatalog` is shared by Inpaint (`defaultId = 'simple'`) and OCR (`defaultId = 'v6-small'`). Modifying the general comparator would have disrupted Inpaint and OCR catalogs. By gating the hierarchical translation logic on `defaultId === 'gg-translate'`, Inpaint, OCR, and existing test fixtures remain 100% backward-compatible.

### 5. Next Steps / Key Takeaways

* **Test Suite**: Added unit test in `EngineSelectionPanel.test.tsx` verifying exact hierarchical sorting order: Google Translate -> Cloudflare -> Custom APIs -> Qwen3.5 (0.8B, 2B, 4B, 9B) -> Llama 70B -> Other models.
* **Full Suite**: 914/914 tests passing across 86 test files (`npm test`).
* **Build**: Production build clean in 1.53s (`npm run build`).
