# How to write a devlog

A devlog is the dated, append-only record of a shipped change: what was broken, why, what was
measured, and what was rejected. It is not a tutorial and not a status report — the next engineer
reads it to avoid re-litigating a decision or re-diagnosing a bug. Current behaviour lives in
[`docs/architecture/`](../../architecture/); a devlog describes the state at the time it was written.

## File and numbering

- Path: `docs/dev-history/devlog/NNN_phaseNNN_topic.md`, next free number (`ls | tail`).
  Older entries reuse some numbers (e.g. two files numbered 023, 032, 039, 059, 060, 063, 074);
  never renumber a merged file, because links and devlogs point at those paths.
- Devlogs are append-only: fix a wrong link or a stale path, never rewrite what was measured or
  claimed. Corrections go in a newer entry.
- Dated audits, plans and research do not belong here — use
  [`../audits/`](../audits/), [`../plans/`](../plans/), [`../research/`](../research/).

## Sections

Same order every time, so a reader can skim:

1. **Title** — `Devlog NNN: <what changed>`, then metadata bullets: `Date`, `Feature/Task`,
   `Status` (with the branch or `main`).
2. **Objective** — one or two sentences: the behaviour that had to become true.
3. **Root causes** — the actual mechanism, not the symptom. Cite the file and function that
   misbehaved. If the cause was assumed rather than proven, say so.
4. **Implementation** — a numbered list of the changes, each pointing at the file that carries it.
   Mention donor lineage when code was ported, and state what was *not* copied.
5. **Evidence** — the commands that ran and their result: test counts, build exit codes,
   `docs:check` violations, artifact paths, screenshots inspected. Distinguish "unit test proves the
   contract" from "I opened the image and it looked right".
6. **Decision** — the durable rule the change establishes, in one paragraph, so future work can cite
   it instead of rediscovering it.

Add **Roadblocks** only when something was tried and rejected; that is the most valuable part of the
log and the part a summary drops.

## Writing rules

- **Numbers with their source.** "1,484 tests in 126 files" beats "all tests pass". Name the
  measurement host or run date if it can drift.
- **Never overstate.** A green run is not visual parity; a browser script exit is not acceptance.
  Say what the evidence covers and what it does not.
- **Do not paste code.** Keep one line or one config fragment, and link the file for the rest.
- **Confidentiality.** Never name commercial extensions, products, sites or authors. Use neutral
  descriptors such as "commercial web-reader pattern" (AGENTS.md §11).
- **Keep it short.** 60–110 lines is the house range; the structured sections, not length, make it
  readable.

## Example

See [Devlog 106](106_phase106_per_image_reader_controls.md) for a complete entry: per-image overlay
state, the three root causes, five implementation points, the evidence list and the resulting rule.
