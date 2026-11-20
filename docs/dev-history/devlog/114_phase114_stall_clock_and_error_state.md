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
67 s is exactly 60 s of genuine silence after the pipeline logged its last line, i.e. the lost
response of cause 4, not the global stamp.

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
- `respectsFinishedJob` — a stall report is dropped when the stored status is already `completed`.

## Measurements

Real browser, packed extension, local fixture page, jobs driven through the same
`TRANSLATE_IMAGE` → queue → `PROCESS_JOB` path the content script uses, results read from IndexedDB:

| Run | Job 1 | 62 s idle | Job 2 |
| --- | --- | --- | --- |
| fixed | completed, 5.97 s | yes | completed, 4.50 s |
| fixed (repeat) | completed, 4.50 s | yes | completed, 3.52 s |

This run shows the cascade does not happen; it is not proof of cause 4, which needs a lost channel.

Tests, and what each one actually pins:

| Claim | Test | Fails before the fix |
| --- | --- | --- |
| Cause 1: a wait cannot be aged by earlier silence | `queueResilience.test.ts` › does not inherit the silence before it as its own stall | yes — `made no progress for 300s` |
| Cause 1: activity is per job, not shared | `queueResilience.test.ts` › keeps another job's progress out of this job's wait | yes — job B's chatter would keep job A alive until the ceiling |
| Cause 1: a job that reports progress is not killed | `queueResilience.test.ts` › keeps a job alive for as long as it reports its own progress | yes |
| Cause 1: the call site passes the per-job reader | `jobWaitBudget.test.ts` (3 cases) | the wiring now has one shape; a shared timestamp no longer type-checks into it |
| Cause 3: no `completed` over a stored `error` | `PipelineOrchestrator.test.ts` › does not mark a job complete after the background already failed it | yes |
| Cause 4: which failures defer to a finished job | `finishedJobRecovery.test.ts` (3 cases) | yes |

Reviewed by reading, not by a test: the catch-path guard that calls `respectsFinishedJob` and delivers
the stored image, the offscreen `JOB_PROGRESS` emission and its interval clearing, and the
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
- A recovered job delivers its stored image and the tab's spinner clears, but the registry has to
  treat a second `IMAGE_TRANSLATED` for the same URL as idempotent. That path is new and unexercised
  end to end: the browser runs above never lost a response, so they never entered it.
- The heartbeat is cleared when the pipeline settles. A pipeline stage that never settles leaves the
  interval running, which costs one tiny message every 20 s but keeps the job visible rather than
  killing it.
