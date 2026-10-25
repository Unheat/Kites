# Devlog 060: 2-Tier Custom Prompt and Calibrated Dynamic Sliding Window Pipeline

### 1. Metadata
* **Date:** 2026-10-25
* **Feature/Task:** 2-Tier Custom Prompt Architecture, Language-Aware Relevant Glossary Filtering, and Calibrated Multilingual Sliding Window
* **Status:** Completed
* **Branch:** `fix/verbatim-typeset-casing-sentence-case`

### 2. The Objective (The "Why")
Previously, three architectural weaknesses affected the LLM translation pipeline:
1. **Unconditional Glossary Injection**: All saved glossary entries (up to 100 entries) were dumped into every prompt chunk, even when zero glossary words appeared on the page. In WebLLM's strict 1024-token WebGPU context window, this consumed 150–600+ tokens unnecessarily, causing context exhaustion and small-model hallucination.
2. **Static Chunker Overhead & Crude Token Ratios**: `partitionIntoChunks()` used a hardcoded 75-token static overhead and a crude `cjk * 1.8 + nonCjk * 0.35` formula. This overestimated CJK tokens by 250% (fracturing batches into 1-bubble micro-chunks) while severely underestimating Thai, Cyrillic, and Indic scripts.
3. **No User Custom Prompt Support**: Users had no mechanism to guide character tone, slang, or honorifics. Allowing custom prompts without context awareness risked crashing WebLLM on local WebGPU or crippling high-context remote APIs (Claude, GPT-4o, Ollama).

The objective was to:
1. Implement a 2-tier custom prompt system: a concise global prompt in Popup Settings (`PopupState.customPrompt`, max 250 chars) safely gated to 80 tokens on WebLLM, plus an optional per-API override in `CustomApiConfig` (max 4,000 chars) for high-context external models.
2. Implement language-aware glossary filtering (`filterRelevantGlossary`) using case-insensitive CJK substring search and Unicode word boundaries (`(^|[^\p{L}\p{N}])term($|[^\p{L}\p{N}])`) for Western/spaced languages. When zero terms match, omit all glossary prompt rules and payloads.
3. Deploy an $O(N)$ calibrated multilingual codepoint token estimator and link dynamic prompt overhead directly to sliding window bubble budgets and completion caps (`input + output <= 1024`).
4. Upgrade the system prompt from vague schema requirements to Declarative Structural Mirroring linking directly to `SOURCE` keys.

### 3. Current Workflow & Implementation Steps (The "How")

1. **Shared Types & Custom API Normalization (`src/shared/types.ts`, `customApi.ts`, `background/index.ts`)**:
   - Added `customPrompt?: string` to `CustomApiConfig` (capped at 4,000 chars) and `PopupState` (capped at 250 chars).
   - Updated `normalizeCustomApiConfig()` and `normalizePopupState()` to safely validate and normalize custom prompts at storage boundaries.

2. **Language-Aware Relevant Glossary Matching (`src/shared/glossary.ts`)**:
   - Implemented `compileGlossaryMatchers()` and `filterRelevantGlossary()`.
   - Continuous CJK scripts (Hanzi, Kanji, Kana, Hangul) match via substring containment.
   - Alphabetic/spaced scripts match via Unicode character class regex with the `'iu'` flag to prevent false-positive substring collisions (e.g. "cat" matching "caterpillar" or "scattering").
   - When no terms match, returns an empty array, completely suppressing `GLOSSARY_PROMPT_RULES` and `GLOSSARY_JSON`.

3. **Calibrated Multilingual Token Estimator (`estimateTokenCount`)**:
   - Deployed single-pass $O(N)$ codepoint scanner modeling empirical token fertility:
     - Basic Latin ASCII: 0.30 tok/char
     - Vietnamese Latin Extended: 0.35 tok/char
     - Cyrillic: 0.42 tok/char
     - Arabic / Hebrew: 0.45 tok/char
     - Thai: 0.60 tok/char
     - Devanagari: 1.00 tok/char
     - CJK Hanzi / Kanji: 0.90 tok/char
     - CJK Kana / SFX: 1.05 tok/char
     - Hangul: 0.85 tok/char
     - Digits: 0.60 tok/char
     - Whitespace: 0.20 tok/char
     - Emojis / Astral planes: 2.50 tok/char
     - Punctuation / Brackets: 0.90 tok/char

4. **Dynamic Sliding Window & Context Clamping (`BaseLlmTranslationEngine.ts`)**:
   - Replaced static overhead with dynamic calculation: `systemPrompt + userWrapper + ChatML framing (16 tokens)`.
   - Scaled bubble budget: `maxBubbleTokens = Math.max(64, maxInputTokens - dynamicOverhead)`.
   - Clamped output tokens: `maxTokens = Math.min(rawMaxTokens, maxContextWindow - inputTokens - 16)`.
   - Structural mirroring prompt: `Return only one JSON object with the exact same keys as SOURCE, mapping each key to its translated text.`

5. **Engine Adapter Overrides (`WebLLMEngine.ts`, `CustomApiEngine.ts`, `TranslationManager.ts`)**:
   - `WebLLMEngine`: configured `maxContextWindow = 1024` and overrode `resolveCustomPrompt()` with an 80-token safety ceiling. Prompts exceeding 80 tokens are safely bypassed with a console warning.
   - `CustomApiEngine`: configured `maxContextWindow = 8192` and overrode `resolveCustomPrompt()` giving precedence to per-API `config.customPrompt` over global settings.
   - `TranslationManager`: memoized frozen request options and resolved per-engine custom prompt overrides seamlessly across the waterfall chain.

6. **UI Components (`CustomPromptPanel.tsx`, `SettingsView.tsx`, `AddApiForm.tsx`)**:
   - Built `CustomPromptPanel.tsx` (< 170 lines) featuring preset quick chips (`[+ Keep Honorifics]`, `[+ Casual Slang]`, `[+ Literal Accuracy]`), character counter (`0 / 250`), WebLLM compatibility badge, and clear button.
   - Mounted "Custom Prompt" button in `SettingsView.tsx` under Advanced & Integrations.
   - Added expandable "Custom Prompt Override (Optional)" section with 4,000-char counter in `AddApiForm.tsx`.

### 4. Roadblocks & Decisions (The Pivot Points)

* **JavaScript Unicode Word Boundary Regex (`'iu'` flag)**:
  An initial implementation of `new RegExp('(^|[^\\p{L}\\p{N}])term($|[^\\p{L}\\p{N}])', 'i')` matched "cat" inside "caterpillar" because without the `'u'` flag, `\p{L}` is treated as literal `p` and `{L}`, causing non-Unicode letters to match. Adding the `'u'` flag (`'iu'`) properly enforced Unicode letter/number boundaries across Latin, Cyrillic, and Vietnamese text.

* **Waterfall Options Identity Preservation**:
  `TranslationManager.test.ts` asserts referential identity (`expect(mocks.translateArguments[1][3]).toBe(options)`) across engine waterfall retries. Constructing `options` inside the loop broke referential equality. Created a frozen `baseOptions` before the engine loop and reused it unless a custom API provided its own distinct profile override.

### 5. Verification & Test Suite
* **Unit Tests**: Full suite passed **1,012 / 1,012 tests** across **93 test files** (`npm test`).
  - `glossary.test.ts`: 19/19 tests passing.
  - `BaseLlmTranslationEngine.test.ts`: 32/32 tests passing.
  - `WebLLMEngine.test.ts`: 9/9 tests passing.
  - `CustomApiEngine.test.ts`: 17/17 tests passing.
  - `CustomPromptPanel.test.tsx`: 5/5 tests passing.
  - `normalizePopupState.test.ts`: 24/24 tests passing.
* **Production Build**: Production build succeeded in 6.62s with zero errors (`npm run build`).
