# Devlog: Archive Chrome Translator / Gemini Nano Tier

* **Date:** 2026-09-01
* **Feature/Task:** Phase 8: Archive Chrome Translator / Gemini Nano Tier
* **Ticket/Issue Link:** N/A
* **Status:** Completed

---

## Objective

Retire the Chrome native Translator API route that was labelled “Gemini Nano” in the popup. The API availability and compatibility path was not dependable enough for Kites, so the active translation set is reduced to Google Translate, WebLLM, and separately implemented external API engines.

---

## Workflow & Implementation Steps

1. Archived `ChromeTranslatorEngine`, its test, the Chrome `LanguageDetector` utility, and its test under `archive/chrome-translator-translation/` so they are outside TypeScript, Vite, and Vitest discovery.
2. Removed the `chrome-translator` runtime factory branch and popup catalog entry, eliminating the “Gemini Nano” selector and fallback choice.
3. Extended the existing persisted-state normalization boundary so saved Chrome selections become `gg-translate` and retired fallback entries are removed before popup, preload, or pipeline use.
4. Changed popup startup to load normalized state through `GET_POPUP_STATE`, avoiding a transient stale selection from direct storage reads.
5. Simplified `LanguageRegistry` to retain canonical IDs and display names for WebLLM, Google Translate, UI selection, and typesetting while removing Chrome-only BCP-47 mapping data.
6. Updated manager coverage, manual runner references, active architecture documents, and the Transformer archive README.

---

## Roadblocks & Decisions

### Decision: Archive the detector with the Chrome tier

`languageDetector.ts` included a general Unicode heuristic, but its only active production caller was the retired Chrome Translator engine. Keeping it active would preserve dead Chrome API probing and an unsupported automatic-source path without a consumer.

### Decision: Keep canonical language UI data

Language IDs and names remain required by WebLLM prompts, Google Translate settings, selector controls, and Cotrans-aligned typesetting orientation. Only Chrome-specific BCP-47 conversions were removed.

---

## Verification

The retained translation waterfall now covers Google Translate and WebLLM, including explicit rejection of both archived Transformer and Chrome translator IDs. Full test and production-build results are recorded with the implementation commit.

---

## Next Steps / Key Takeaways

* **Key Takeaway:** A native browser API tier must be removed from state migration, UI catalog, manager routing, tests, and documentation together; archiving the class alone leaves invalid persisted selections and broken preloads.
* **Next Action:** Add future translation providers only after their execution engines and failure handling are implemented end to end.
