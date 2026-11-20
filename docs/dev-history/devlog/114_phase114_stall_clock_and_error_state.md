# Devlog 114: A finished job reported as stalled, and the error state that never appeared

- **Date:** 2026-11-21
- **Feature/Task:** Background job wait bookkeeping after a first-run translation
- **Status:** Shipped on `fix/review-followups`
- **Reports:** user log, job 109 → 110

## Objective

Explain why a translation that finished in 11.5 s was reported as `PROCESS_JOB made no progress for
67s`, why the next job died `231s` into a wait it had just started, and why no error icon appeared.

## What the log proves

Job 109 logged `Full Pipeline finished in 11535.20ms` and `Pipeline complete for job 109`, and the
background still failed it 67 s later: a job known to be finished was failed for silence. Job 110,
enqueued seconds before, was reported as silent for **231 s**, which no wait of a job that new can
have observed — so the stamp it read belonged to something else.

The two numbers have different causes and this matters for the fix. 231 s can only be a stale stamp.
67 s is the measured idle reported by the check (the limit is 60 s, sampled in 5 s slices, so any value
from 60 s upward is "past the limit"): it is compatible with the pipeline having finished, its answer
being lost, and the job's own last signal being the one at pipeline end — cause 4, not the global
stamp. Both figures are consistent with the two causes; neither, on its own, separates them.

## Root causes

### 1. The activity clock was global and outlived the wait that read it

`awaitJobResponse` compared `Date.now()` against `lastOffscreenActivityAt`, a single module-level
timestamp bumped by any message from the offscreen document. A wait that began during a quiet period
therefore inherited that quiet period as if it were its own silence: the first 5 s slice measured a
job that had just started as 300 s idle. Every later job inherited the same stale stamp, which is why
the failures arrived 3–4 s after the click, one after another.

### 2. A running job reported no progress at all

No offscreen→background message during a job was about progress. Model-initialisation notices
carried a job id, but OCR, inpainting, translation and typesetting were silent, and the other
traffic on that channel (popup-state requests, download progress) is unrelated to the job in flight.
The background's only liveness signal was therefore accidental: some message refreshing the single
shared stamp. A genuinely slow page was one silent
minute away from being killed, and a fast page was safe only by luck.

### 3. The pipeline wrote `completed` over the `error` the background had stored

`PipelineOrchestrator` is not cancelled when the wait is abandoned — it keeps working and finishes by
writing `status: 'completed'`. That overwrote the `error` row the background had just written, so the
UI had no failure to show: the "red X" never appeared because the database said the job succeeded.

### 4. A lost response turned a finished job into a failure

If the response channel is gone when the pipeline answers, the wait reports a stall for a job that is
done. Nothing checked the stored status before declaring failure.

## Changes

- `awaitJobResponse` measures idleness from `max(readActivityAt(), startedAt)`: time that passed
  before a wait began is not evidence about that wait.
- Per-job progress timestamps (`noteJobActivity` / `jobActivityAtFor` / `forgetJobActivity`), recorded
  from any offscreen message that names a job, so one job's chatter cannot keep another alive.
- The offscreen document sends `JOB_PROGRESS` every 20 s (a third of the 60 s stall budget) while a
  job runs, cleared when the pipeline settles.
- `completeJobUnlessFailed` refuses to mark a job complete once the background has failed it.
- `respectsFinishedJob` — a stall report is dropped when the stored status is already `completed`,
  and the job's page is delivered in the same shape as a normal reply (`CAPTURE_TRANSLATED` for
  `kites-capture:` jobs, `IMAGE_TRANSLATED` otherwise).
- `ImageRecord.bakedImageBlob` stores the delivered page, separately from the inpainted plate the
  dashboard shows. Reusing the plate would have delivered a page with the text removed.

## Measurements

Real browser, packed extension, local fixture page, jobs driven through the same
`TRANSLATE_IMAGE` → queue → `PROCESS_JOB` path the content script uses, results read from IndexedDB:

| Run | Job 1 | 62 s idle | Job 2 |
| --- | --- | --- | --- |
| fixed | completed, 5.97 s | yes | completed, 4.50 s |
| fixed (repeat) | completed, 4.50 s | yes | completed, 3.52 s |

Then through the content script's own control (hover the image → click "Translate Image" → wait for the
page image to become a `blob:` URL), which is the path a user takes:

| Run | Job 1 | 62 s idle | Job 2 | Stall lines | Console errors |
| --- | --- | --- | --- | --- | --- |
| `node scripts/stall-e2e.mjs --idle-ms 62000` | translated, 4.28 s | yes | translated, 3.67 s | 0 | 0 |

These runs show the cascade does not happen; they are not proof of cause 4, which needs a lost
channel.

Tests, and what each one actually pins:

| Claim | Test | Behaviour on the pre-fix code |
| --- | --- | --- |
| Cause 1: a wait cannot be aged by earlier silence | `queueResilience.test.ts` › does not inherit the silence before it as its own stall | fails — `made no progress for 300s` |
| Cause 1: activity is per job, not shared | `queueResilience.test.ts` › keeps another job's progress out of this job's wait | `jobActivityAtFor` did not exist, so the test cannot even be written against the old code |
| Cause 1: a job that reports progress is not killed | `queueResilience.test.ts` › keeps a job alive for as long as it reports its own progress | same: it pins the new per-job reader, not a defect the old code had |
| Cause 1: the call site reads the per-job reader | `jobWaitBudget.test.ts` (3 cases) | helper + call site are both new; the test pins the helper's contract, the call site is read by eye |
| Cause 3: no `completed` over a stored `error` | `PipelineOrchestrator.test.ts` › does not mark a job complete after the background already failed it | fails — writes `completed` |
| Cause 4: which failures defer to a finished job | `finishedJobRecovery.test.ts` (3 cases) | module did not exist |

Reviewed by reading, not by a test: the catch-path guard that calls `respectsFinishedJob`,
`deliverRecoveredJob` and `readBakedImageDataUrl` (message shapes, the encoding loop, the
capture/no-tab branches), the offscreen `JOB_PROGRESS` emission and its interval clearing, and the
`noteJobActivity` listener wiring. All three sit behind `chrome.runtime`/`chrome.tabs` side effects on
a function that fetches an image first; no decision inside them is unexercised, but the plumbing is
verified in the browser run above rather than in vitest.

`npm test` 1598 passed / 137 files. `docs:check` 880, delta +0. `lint` 0 errors. `build` clean.
smoke 6/6.

## What could not be reproduced

The exact lost-response race did not reproduce here: the reported page served normally on the first
attempt and then presented a Cloudflare challenge, so the third-party page could not be used as a
fixture, and the local harness cannot force a message channel to close mid-job. Cause 4 therefore
rests on its decision predicate and on reading the guard, not on an end-to-end reproduction. Causes 1
and 3 are reproduced by the tests above, cause 2 is a missing signal whose absence is visible in the
pre-fix diff and whose presence is exercised only by the browser run.

Causes 2 and 3 also explain the second half of the report without needing the lost response: a job
whose pipeline had quietly finished 60 s earlier trips cause 1, and cause 3 then hides the error.

## Known limits

- The wait is still bounded (60 s of silence, `MAX_JOB_WAIT_MS` overall); a pipeline stage that
  genuinely blocks for more than a minute now depends on the heartbeat, not on the wait's patience.
- Jobs abandoned by the background are not cancelled in the offscreen document; they run to
  completion and their output is kept, which is what makes causes 3 and 4 recoverable at all.
- A recovered job delivers its page and the tab's spinner clears, but the path is new and unexercised
  end to end: the browser runs above never lost a response, so they never entered it. The receiving
  side is expected to accept a second `IMAGE_TRANSLATED` for the same URL, but that is an assumption
  about the registry rather than something this work exercised.
- Every job now stores a third full-page PNG (`rawImageBlob`, `translatedImageBlob`,
  `bakedImageBlob`), deleted only by retention cleanup. The fixture pages are ~60 KB, but a
  full-resolution scan is megabytes each, and nothing enforces a quota on page images.
- A job with no stored baked page reports a failure instead of delivering: nothing to show is better
  than showing a plate with empty bubbles.
- The heartbeat is cleared when the pipeline settles. A pipeline stage that never settles leaves the
  interval running, which costs one tiny message every 20 s but keeps the job visible rather than
  killing it.
