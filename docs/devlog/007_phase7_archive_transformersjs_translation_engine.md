# Devlog: Archive Transformers.js Translation Engine

* **Date:** 2026-08-31
* **Feature/Task:** Phase 7: Archive Transformers.js Translation Engine
* **Ticket/Issue Link:** N/A
* **Status:** Completed

---

## Objective

Remove the non-working local Transformers.js translation route from the active Kites extension without touching working WebLLM, Google Translate, Chrome Translator, OCR, or inpainting. Preserve the implementation and its NLLB/Marian catalog outside the build so it can be reconsidered later without leaving selectable dead models in the popup.

---

## Workflow & Implementation Steps

1. **Archived the local Transformer implementation:** Moved `TransformersEngine.ts`, its focused unit test, the 111-model Transformer registry snapshot, and Transformer-only benchmark tooling to `archive/transformers-translation/`. The archive README records the reason, supported active engines, and the restoration boundary.
2. **Removed active model exposure:** Kept only `webllm` entries in `src/shared/models-registry.json`. `ModelRegistry` now returns Google Translate, Chrome Translator, and bundled WebLLM models; it no longer inspects `transformers-cache` or provides Xenova fallback models.
3. **Closed engine dispatch:** Removed `@huggingface/transformers`, its ONNX/WASM configuration, and `TransformersEngine` from `TranslationManager`. The manager now creates WebLLM only for a registry entry explicitly marked `webllm`; unknown or archived engine IDs fail clearly instead of being incorrectly passed to WebLLM.
4. **Migrated saved settings:** The background `GET_POPUP_STATE` boundary now replaces an archived or invalid active engine with `gg-translate` and strips invalid, duplicate, and primary-engine entries from the fallback chain before returning and saving the normalized state.
5. **Removed stale controls:** Deleted the inert “Import Local .onnx Model” popup button. It had no click handler, file picker, model validation, storage, protocol, or runtime path. OCR and inpainting ONNX downloads remain unchanged.
6. **Updated retained tooling:** Kept mixed Google/WebLLM diagnostic scripts active but removed their Transformer runs and Transformer fallback IDs. Removed the `@huggingface/transformers` package dependency while retaining both ONNX Runtime packages for OCR and inpainting.
7. **Updated current architecture documents:** Removed Transformers.js and NLLB from `docs/kites_flow.md` and `docs/fullplan.md`. Earlier devlogs remain historical records.

---

## Roadblocks & Decisions

### Roadblock 1: Unknown Engine IDs Fell Through to WebLLM

The old manager treated any ID not recognized as Chrome Translator, Google Translate, or a Transformer catalog model as WebLLM. That included old `Xenova/*` selections and unfinished custom API IDs. Removing Transformers without closing that branch would have transformed a clear unsupported configuration into a confusing WebLLM load error.

**Decision:** Use the static registry discriminator for WebLLM and reject unsupported IDs explicitly. The external API settings UI remains intact for later work; it no longer receives accidental WebLLM dispatch.

### Roadblock 2: ONNX Has Active Non-Translation Uses

Transformers.js used ONNX internally, but OCR and inpainting independently use ONNX Runtime and `.onnx` assets.

**Decision:** Remove only the translation-specific Hugging Face dependency and cache logic. Keep `onnxruntime-web`, `onnxruntime-node`, OCR model caching, and inpainting model caching unchanged.

### Decision: Archive Outside `src/`

Keeping dead source under `src/` would leave it within TypeScript and Vitest discovery boundaries.

**Decision:** Store the historical implementation under `archive/transformers-translation/`, outside the active build, with a clear restoration note.

---

## Verification

Focused translation coverage passed after the change:

- `TranslationManager` waterfall tests now cover Chrome Translator to Google Translate fallback and archived-ID rejection.
- WebLLM, Google Translate, and Chrome Translator engine tests passed.
- The focused test invocation completed with 12 test files and 78 tests passing.

The full test suite and production build are recorded separately in the final verification step for this change.

---

## Follow-up: WebLLM Cache Rehydration and Event-Only Ordering

The archive cleanup exposed a pre-existing WebLLM availability gap: the popup rebuilt every WebLLM row as unavailable after a remount because its completed cache was never queried. A follow-up now requests one batched status snapshot from the offscreen document. The offscreen owner uses WebLLM's public complete-cache validator and existing OCR/inpaint cache managers, preventing a large WebLLM runtime import or hundreds of popup message round trips.

Initial dropdown order remains unchanged. The popup reorders only after a model reaches `ready` or a custom API is added: the configured default stays first, downloaded entries move above pending entries, and each group is lexical. Search results retain MiniSearch relevance order.

---

## Next Steps / Key Takeaways

* **Key Takeaway:** Retiring an engine requires removing its runtime factory, catalog entries, persisted-state compatibility, cache UX, package dependency, and test/tooling references—not merely its implementation file.
* **Next Action:** Implement external API engine execution separately before re-enabling those saved API configurations as runnable translation engines.
