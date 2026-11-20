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
background still failed it 67 s later. Job 110, enqueued seconds before, was reported as silent for
**231 s**. Neither number is the job's age, so the arithmetic behind the stall check was measuring
something other than the job.

## Root causes

### 1. The activity clock was global and outlived the wait that read it

`awaitJobResponse` compared `Date.now()` against `lastOffscreenActivityAt`, a single module-level
timestamp bumped by any message from the offscreen document. A wait that began during a quiet period
therefore inherited that quiet period as if it were its own silence: the first 5 s slice measured a
job that had just started as 300 s idle. Every later job inherited the same stale stamp, which is why
the failures arrived 3–4 s after the click, one after another.

### 2. A running job reported no progress at all

The only offscreen→background events were model-initialisation notices. OCR, inpainting, translation
and typesetting emitted nothing, so the background's only liveness signal for a normal job was
accidental: an unrelated message refreshing the global stamp. A genuinely slow page was one silent
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
- `respectsFinishedJob` — a stall report is dropped when the stored status is already `completed`.

## Measurements

Real browser, packed extension, local fixture page, jobs driven through the same
`TRANSLATE_IMAGE` → queue → `PROCESS_JOB` path the content script uses, results read from IndexedDB:

| Run | Job 1 | 62 s idle | Job 2 |
| --- | --- | --- | --- |
| fixed | completed, 5.97 s | yes | completed, 3.78 s |
| fixed (repeat) | completed, 4.50 s | yes | completed, 3.52 s |

Unit reproducer for root cause 1: a wait whose activity stamp is five minutes old, answered after 6 s,
rejected with `made no progress for 300s (stall limit 60s)` before the fix and resolves after it.

`npm test` 1598 passed / 137 files. `docs:check` 880, delta +0. `lint` 0 errors. `build` clean.
smoke 6/6.

## What could not be reproduced

The exact lost-response race did not reproduce here: the reported page served normally on the first
attempt and then presented a Cloudflare challenge, so the third-party page could not be used as a
fixture, and the local harness cannot force a message channel to close mid-job. Cause 4 is therefore
covered by its decision logic alone (`respectsFinishedJob`, three cases) and by the guard in the
error path, not by an end-to-end reproduction. Causes 1–3 are each reproduced or directly observed.

Causes 2 and 3 also explain the second half of the report without needing the lost response: a job
whose pipeline had quietly finished 60 s earlier trips cause 1, and cause 3 then hides the error.

## Known limits

- The wait is still bounded (60 s of silence, `MAX_JOB_WAIT_MS` overall); a pipeline stage that
  genuinely blocks for more than a minute now depends on the heartbeat, not on the wait's patience.
- Jobs abandoned by the background are not cancelled in the offscreen document; they run to
  completion and their output is kept, which is what makes causes 3 and 4 recoverable at all.
