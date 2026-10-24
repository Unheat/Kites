# Devlog 059: LLM Prompt Optimization and Dual-Budget Sliding Window

### 1. Metadata
* **Date:** 2026-10-24
* **Feature/Task:** Compact System Prompt Optimization and Dual-Budget (Count + Token) Sliding Window
* **Status:** Completed
* **Branch:** `feat/llm-prompt-and-dual-budget-window`

### 2. The Objective (The "Why")
Previously, `BaseLlmTranslationEngine` generated a bloated ~135-token system prompt containing 9 repetitive bullet points (repeating JSON requirements 3 times and key preservation twice). In small models (0.5B–1.5B) with a 1,024-token WebGPU context window (such as WebLLM's Qwen2.5 and SmolLM2), verbose instructions dilute attention and consume scarce context tokens, leaving insufficient headroom for completion generation.

Furthermore, batching was strictly count-based (`offset += batchSize`, fixed at 15 bubbles), with zero awareness of input token length. When translating dense dialogue pages (e.g. detective or supernatural manga where each bubble contains 50–80 kanji), 15 bubbles produced over 1,200 input tokens, instantly blowing past WebLLM's 1,024 context window and causing WebGPU buffer truncation.

The objective was to:
1. Streamline the system prompt to a high-signal ~55-token template that works synergistically with WebLLM's logit-level XGrammar constrained decoding while continuing to protect remote APIs without XGrammar.
2. Implement script-aware dual-budget batching that splits on `bubbleCount >= batchSize` OR `estimatedInputTokens > maxInputTokens` (whichever hits first), guaranteeing that WebLLM never exceeds 550 input tokens.

### 3. Current Workflow & Implementation Steps (The "How")

1. **System Prompt Optimization (`buildSystemPrompt`)**:
   - Extracted `protected buildSystemPrompt(sourceLang, targetLang, glossary)` on `BaseLlmTranslationEngine`.
   - Tightened rules to 4 essential directives:
     - Sentence capitalization rule.
     - Exact key mapping (`e.g. b0, b1`).
     - Surrounding lines context and tone rule.
     - Punctuation / untranslatable passthrough rule.
     - Clean JSON output without markdown fences or commentary.
   - Reduced prompt size from ~135 tokens to **~55 tokens** (~60% token reduction).

2. **Script-Aware Multilingual Token Estimator (`estimateTokenCount`)**:
   - Accurately accounts for BPE tokenizer behavior:
     - CJK characters (Hanzi, Kanji, Kana, Hangul): $\approx 1.8 \text{ tokens/char}$.
     - Latin / Western / numeric characters: $\approx 0.35 \text{ tokens/char}$.
   - Accounts for JSON key/delimiter syntax overhead ($\approx 6 \text{ tokens/item}$).

3. **Dual-Budget Batch Partitioning (`partitionIntoChunks`)**:
   - Replaced naive `for (let offset = 0; offset < toTranslate.length; offset += this.batchSize)` loop with `this.partitionIntoChunks(toTranslate)`.
   - Evaluates:
     - Count limit: `chunk.length >= this.batchSize`.
     - Token limit: `currentTokens + itemTokens > this.maxInputTokens`.
   - Bounded by whichever limit hits first.
   - Fixed base overhead: 75 tokens for system prompt and prompt template wrappers.

4. **Engine-Specific Budget Configurations**:
   - `BaseLlmTranslationEngine`: `batchSize = 15`, `maxInputTokens = 4000` (generous for remote cloud APIs like Cloudflare and Custom APIs).
   - `WebLLMEngine`: `batchSize = 8` (prevents small-model attention degradation across too many parallel keys) and `maxInputTokens = 550` (strict safety ceiling leaving 450+ tokens for completion within the 1024 context limit).

### 4. Roadblocks & Decisions (The Pivot Points)

* **Why WebLLM Still Needs JSON in System Prompt despite XGrammar**:
  While WebLLM's embedded XGrammar enforces JSON syntax at the logit level via finite-state machine, omitting JSON from the prompt creates an adversarial clash: the model's unconstrained attention heads predict conversational prose, which XGrammar forcefully overrides, degrading translation quality in 0.5B–1.5B models. Retaining a crisp 1-sentence JSON directive keeps the model's latent predictions aligned with XGrammar's FSM.

* **Avoiding "..." in Prompt String**:
  An initial prompt phrasing `(b0, b1...)` accidentally matched a test assertion `expect(prompt).not.toContain('...')` designed to check that literal punctuation tokens were not passed to the LLM. Updated prompt phrasing to `(e.g. b0, b1)`, preserving both clarity and test compatibility.

### 5. Next Steps / Key Takeaways

* **Test Suite**: Added 3 new unit tests covering script-aware token estimation, token-budget chunking under dense text, and WebLLM configuration. Full suite: **913/913 tests passing across 86 test files**.
* **Build**: Production build succeeded in 1.46s with zero errors.
