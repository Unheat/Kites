# Devlog 115: A per-block stage audit, because "the translator dropped a line" was unanswerable

- **Date:** 2026-11-19
- **Feature/Task:** Diagnosing blocks that survive a page run untranslated
- **Status:** Shipped on `main`
- **Reports:** Cloudflare run where several Chinese boxes stayed on the page while WebLLM "translated the same image fine"

## Objective

A page came back with large dialogue boxes still in Chinese. The engine had answered everything it was
asked (one request, no omitted or echoed slots logged, five lines drawn), so the loss happened
somewhere else — and no single log line named the block, the stage, or the reason.

Four stages can stop a block:

1. OCR filters (noise, high tilt, furigana) — logged per line, but not per final block.
2. Preserve classification (`sound-effect`, `display-lettering`, `fragment`) — logged as one long line
   listing indices, with no score, box, or direction.
3. The translation input — preserved blocks are excluded before the engine, so they never appear in
   any engine log at all.
4. Layout — a translated block the renderer rejects disappears from the baked page silently.

## What was added

`src/offscreen/services/pipelineAudit.ts`, printed once per page when enabled:

```
[PipelineAudit] job 114 #12 preserved    display-lettering 83x319 v score=0.41 "瓣新同烟棵麒射戏如养拜的谁我"
[PipelineAudit] job 114 #26 translated   dialogue          73x473 v score=0.93 "玩法可多着呢" out="There are plenty of ways to play"
[PipelineAudit] job 114 #30 empty-answer dialogue          55x135 v score=0.88 "ハ？"
[PipelineAudit] job 114 #31 echoed       dialogue          40x102 v score=0.90 "我们这边" out="我们这边"
```

Each line answers one question: preserved (never reached a model), not-sent, empty-answer (engine
dropped it), echoed (engine returned the source), or translated with the returned text.

## How to turn it on

Development builds always audit. A packaged build audits after:

```js
chrome.storage.local.set({ kites_debug_pipeline_audit: true })
```

`STORAGE_KEYS.DEBUG_PIPELINE_AUDIT` holds the key; it is off by default because the log is one line per
OCR block.

## Verification

- `pipelineAudit.test.ts` (3 cases): stage classification for all five outcomes, the storage gate in a
  packaged build, and a storage failure leaving the audit off rather than breaking the pipeline.
- `PipelineOrchestrator.test.ts` › audits every block, naming the stage that stopped it — drives the
  real pipeline and asserts the call with two blocks; fails when the call site is removed
  (stash-verified).
- `npm test` 1607 / 139 files, `docs:check` 880 delta +0, lint clean, build clean, smoke 6/6.

## Limits

- The offscreen document's console is not reachable from Playwright (it is a `background_page` target,
  not a page, and its child CDP session cannot be addressed through the Playwright API), so the audit
  text itself is verified by unit tests rather than by scraping a browser run. The stage it describes
  is exercised by every pipeline run.
- Layout rejection still prints its own `accepted=false` lines with the region index; the audit says
  what the engine returned, not whether the renderer kept it.
