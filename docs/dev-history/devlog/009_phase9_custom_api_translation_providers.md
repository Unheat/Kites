# Devlog: Custom API Providers & Dynamic Fallback Config

* **Date:** 2026-09-02
* **Feature/Task:** Phase 9: Custom Remote Translation APIs and Dynamic Waterfall Fallback
* **Ticket/Issue Link:** N/A
* **Status:** Completed

---

## Objective

Enable users to connect custom remote AI translation providers (OpenAI, Anthropic Claude, Google Gemini, and OpenAI-compatible endpoints like OpenRouter, DeepSeek, Groq, Ollama) while maintaining strict batch translation isolation, schema validation, and fallback persistence across browser restarts.

---

## Workflow & Implementation Steps

1. **Schema & Configuration (`src/shared/customApi.ts`, `src/shared/types.ts`):** Defined `CustomApiConfig` schema with provider types (`openai`, `anthropic`, `gemini`, `openai-compatible`), base URL overrides, and credential validation.
2. **Engine Implementation (`src/offscreen/engines/translation/CustomApiEngine.ts`):** Built delimited prompt tagging (`<|1|> text`) allowing batch translation of up to 30 text segments in a single network request while enforcing positional mapping.
3. **Provider Adapters:** Implemented payload formats and headers for Anthropic (`messages` API with version headers), Gemini (`generateContent` with part filtering), and OpenAI-compatible (`/chat/completions`).
4. **Settings UI (`src/popup/components/AddApiForm.tsx`, `ApiManagerPanel.tsx`, `FallbackConfigPanel.tsx`):** Added responsive dialogs for entering API keys, validating endpoint connectivity, and ordering custom engines into the waterfall fallback list.
5. **Waterfall Integration (`src/offscreen/services/TranslationManager.ts`):** Connected custom engines to the background translation factory, automatically spinning up and disposing engine instances during fallback traversal.

---

## Roadblocks & Decisions

### Delimiter Line Tagging vs Structured JSON Schema

* **The Problem:** Many smaller OpenAI-compatible models (e.g. 7B/8B open-weights on Groq or OpenRouter) frequently fail JSON mode or wrap responses in markdown formatting, corrupting array indices.
* **The Solution:** Adopted `<|index|>` delimiter line tagging with regex matching and 1:1 fallback preservation if any tag is missing.
* **Reasoning:** Line tagging works reliably across all model classes without requiring provider-specific JSON grammar enforcement.

---

## Verification

* Unit tests in `CustomApiEngine.test.ts` and `customApi.test.ts` verified endpoint construction, header generation, error propagation, and delimiter parsing across all 4 provider formats.
* Build and packaging completed cleanly under Vite.

---

## Next Steps / Key Takeaways

* **Key Takeaway:** Multi-segment translation batching must remain robust against provider response drift. Isolating translation behind `ITranslationEngine` ensures the rest of the pipeline remains agnostic to whether translation occurred locally or via remote API.
* **Next Action:** Provide an out-of-the-box shared cloud pool for users without personal API keys.
