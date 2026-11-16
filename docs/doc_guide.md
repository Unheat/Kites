# Documentation guide

The single rulebook for documentation in this repository. `AGENTS.md` covers coding conventions;
this file covers what to write, where it goes, and what "done" means. If a rule here conflicts with a
habit or an older doc, this file wins.

## The five kinds of documentation

Each kind answers a different question. Writing the wrong kind is the usual reason docs rot.

| Kind | Answers | Lives in | Written by |
|---|---|---|---|
| **Guide** | "How do I build/run/test/deploy this?" | `docs/development/`, `README.md` | whoever changes the process |
| **Architecture** | "How does this subsystem work, and why is it shaped this way?" | `docs/architecture/` | whoever changes the subsystem |
| **Reference** | "What does this symbol take, return, and guarantee?" | `docs/api/` (generated) + `docs/architecture/*-pipeline.md` and route/contract pages (hand-written) | TSDoc comments in code |
| **Decision (ADR)** | "Why did we choose this over the alternatives?" | `docs/decisions/` | whoever makes the decision |
| **History (devlog)** | "What did we change, what did we measure, what broke?" | `docs/dev-history/` | whoever ships the change |

Rules that follow from the table:

- A **reference** entry never explains implementation. Purpose, inputs, outputs, guarantees, failure
  modes. If a reader needs the algorithm, that belongs in an architecture doc or the code.
- A **contract** page (route behaviour, font readiness, parity limits) is reference, not a plan: it
  describes what the code does today and lives in `docs/architecture/`. A file called a
  "specification" that still describes intentions belongs in `docs/dev-history/plans/` instead.
- An **ADR** is written before or during the decision, not after shipping, and never edited to match
  the outcome. Supersede it with a new ADR instead.
- A **devlog** is dated and append-only. It records measurements and rejected alternatives so the next
  person does not re-litigate them.

## Repository layout

```
docs/
  doc_guide.md            ← this file; the rulebook
  README.md               ← index and reading order
  architecture/           ← narrative subsystem docs plus contract/reference pages
  api/                    ← TypeDoc output, generated, not hand-edited
  decisions/              ← ADRs (ADR-NNN-title.md)
  dev-history/
    devlog/               ← chronological NNN_phaseNNN_topic.md (append-only)
    plans/                ← finished or superseded implementation plans
    audits/               ← dated audits and coverage snapshots
    research/             ← donor/upstream research and flow maps
    receipts/             ← generated validation receipts and screenshots
  development/            ← guides only: setup, testing, CI, standards, workarounds
  fullplan.md             ← project scope and phase roadmap (living)
  kites-workflow.json     ← source for the interactive map
  workflow.html           ← generated interactive map artifact (also deployed to site/pipeline)
  api-undocumented-baseline.json ← coverage ratchet input for npm run docs:check
```

The split inside `dev-history/` exists so the archive stays findable: a plan is not an audit, and a
receipt is not research. Anything dated goes there; anything describing the current code stays in
`architecture/`.

`docs/api/` is generated: never edit it by hand, and do not commit changes to it as if they were
source. Regenerate with `npm run docs:api`.

## Depth by area

The codebase has three layers with different documentation depth. Match the depth to the layer.

| Layer | Paths | Depth | Where |
|---|---|---|---|
| **Engine and utilities** | `src/offscreen/**`, `src/shared/**` | Full | TSDoc on every exported symbol, generated reference, plus an architecture doc per subsystem |
| **Frontend** | `src/popup/**`, `src/studio/**`, `src/content/**`, `src/background/**` | Brief | One short architecture doc each: responsibilities, data flow, entry points. No per-symbol docs required |
| **Scripts and tests** | `src/test/**`, `scripts/**` | Minimal | A header comment stating purpose and usage; assertions are the spec |

Why the split: engine symbols are consumed across the offscreen, Studio and test flows and a wrong
contract is expensive to discover late. Frontend layers change shape with the UI and are covered by
screenshots and manual checks, so prose there has a short half-life.

## Writing rules

- **Docstrings explain the contract, not the code.** State purpose, inputs, outputs, invariants,
  failure behaviour. Never restate the implementation line by line.
- **Every exported symbol in the full-depth layer gets a TSDoc comment** with `@param` for each
  parameter and `@returns`. Constructors that take no parameters may omit them.
- **Comment shape is enforced by `npm run docs:check`** (it runs `check-docstrings.mjs` after the
  coverage count). The rules, so TypeDoc output stays consistent:
  1. no `@file` block tag — start with a summary line instead;
  2. `@param` names must match the signature exactly (a rename that misses the docstring fails);
  3. if a function documents any parameter, it documents all of them;
  4. the comment starts with a summary line, not a block tag;
  5. no orphan doc blocks — a comment with no declaration after it is a defect.
- **Comments on non-obvious decisions are expected** (`WORKAROUND`, `HACK`, donor deviations). Those
  keep their upstream issue link or the devlog that explains them.
- **No commented-out code, no TODO graffiti.** Use an issue or a devlog entry instead.
- **Prose review before commit:** every number, threshold, path and command must be checkable against
  the code. Prefer the measured value with its source over an adjective.

## Update rules (the part that keeps docs true)

A change is not finished until the docs it invalidates are updated in the **same commit**:

| If you… | You must update |
|---|---|
| change a subsystem's behaviour or data flow | `docs/architecture/<subsystem>.md` |
| add or change an exported symbol in `offscreen/` or `shared/` | its TSDoc (the generated reference follows) |
| add a new exported symbol in `offscreen/` or `shared/` | TSDoc is mandatory; the ratchet gate fails otherwise |
| make or reverse an architectural decision | new ADR in `docs/decisions/` |
| ship a feature or fix that needed investigation | devlog in `docs/dev-history/devlog/` |
| change build/test/deploy commands | `docs/development/` (setup/testing/CI) and the verification gate in `CONTRIBUTING.md` |
| change a user-visible behaviour | the relevant architecture doc, and the changelog if one is maintained |

The devlog and the architecture doc are not substitutes: the devlog records **what happened and what
was measured**, the architecture doc records **how it works now**.

## Verification

```bash
npm run docs:check   # gate: coverage ratchet + TSDoc shape (run it like npm test)
npm run docs:api     # regenerate the reference; must emit zero warnings
```

CI runs both in `.github/workflows/ci.yml`, before the extension build.

`docs:check` runs two gates: the coverage ratchet described below, then the comment-shape check. The engine and shared layers
carry a historical backlog (880 symbols, baseline recorded 2026-11-14), so the gate does not demand zero: it
fails when the count increases. New code has to be documented; the backlog can only shrink. Update the
baseline (`npm run docs:check -- --update`) only when the backlog genuinely grew, and say why in the
commit message.

## Session checklist

At the end of a work session:

1. Any exported symbol you added in `offscreen/` or `shared/` has TSDoc.
2. Any subsystem behaviour you changed is reflected in its architecture doc.
3. Any decision you took is an ADR; any investigation is a devlog with numbers.
4. Any new document is in the folder that matches its kind (see [Repository layout](#repository-layout)):
   a plan or audit never stays in `docs/development/` or at the `docs/` root.
5. `npm run docs:api && npm run docs:check` passes.
6. `docs/README.md` still points at everything a newcomer needs, in reading order.
