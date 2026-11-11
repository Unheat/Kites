# ADR-012: Pure-Code Invariants, Derived Thresholds, and Optional-Tier Independence

## Status
Accepted

## Date
2026-11-02

## Context

Kites ports detection and layout behaviour from donor projects (Cotrans, XianScan Rust, Koharu). Koharu and some XianScan stages solve problems with trained models (Torch/ONNX classifiers, role models), but the extension cannot run most of them: Manifest V3 forbids dynamic code loading, so `opencv-js`, Torch bindings, and similar are out of reach. We therefore reimplement donor logic in pure TypeScript.

That substitution has repeatedly produced two failure modes:

1. **Silent divergence.** A pure-code approximation looks right on one page and is wrong on the next, because the invariant it was supposed to preserve was never written down or tested.
2. **Hidden coupling.** `BubbleDetectionMode` is `'off' | 'heuristic' | 'neural'` with `'off'` as the default. `HeuristicBubbleEngine` and the neural YOLO detector are opt-in tiers. Code that reaches for a tier engine "because the signal is already there" makes the default mode depend on a feature the user did not enable, and hides that dependency from the user-facing configuration.

Both were observed while evaluating a sound-effect preservation rule for OCR boxes. Geometry was measured across 9 fixture pages (1 reported manga page, 3 manga fixture pages, 1 textbook page, 3 synthetic label/UI pages):

| Candidate rule | False positives on manga pages | Note |
|---|---|---|
| `1.35×` page body size + ≤12 chars | 1 real dialogue line | fixed constant |
| k-means (k=2) split on size ratio | 2 (one whole sentence) | invents a split on a page with no SFX |
| largest-gap split on size ratio | 2 | worst: fired on 12 blocks of a label page |
| `≤3 chars` only | 4 (`可恶…`, `老师ー`, `莲实！`) | kills short real dialogue |
| not-in-bubble + `≥1.2×` + ≤12 chars | 0 | **required `HeuristicBubbleEngine` (a tier) — unusable in the default mode** |

The last row is the instructive one: the only geometrically clean rule was clean *because* it borrowed an opt-in tier. Under the default `'off'` mode no bubble rule exists at all, so it cannot be the basis of a default-path feature.

## Decision

### 1. The 90% bar
A pure-code reproduction of donor ML is acceptable when it preserves the output invariant in roughly 90% or more of measured cases **and** its failure mode is mild and recoverable. It is never acceptable when the failure mode destroys user content (erased artwork, lost speech, corrupted layout).

### 2. Prove it, don't assert it
Every pure-code substitute ships with tests against real fixture pages. An unverified approximation is a guess, not a workaround. If pure code cannot reach the bar, the feature waits for a compatible model instead of shipping as a heuristic.

### 3. Thresholds are derived, never guessed
Numeric cutoffs must come from a measured distribution over real fixtures. A per-page adaptive baseline (median, character-weighted median) is preferred over one global constant. Unsupervised adaptive cuts (k-means, largest-gap) must be gated by an absolute floor: measured, they always invent a split even on a page containing nothing to separate.

### 4. Optional tiers are never a dependency
`'off'` is the default `BubbleDetectionMode` and the pipeline must remain fully functional in it. No feature may require, call, or silently fall back to `HeuristicBubbleEngine` or the neural detector while the mode is `'off'`. Tier output may *add* refinement when a tier is enabled; it may never be the thing that makes a default-mode feature work. Using a tier engine inside an offline experiment is a measurement, not a design.

### 5. Measure the damage direction
Count false positives — cases where the rule suppresses something the user needed — before trusting any recall number. Damage is asymmetric: a missed translation is recoverable by the reader, destroyed artwork is not.

## Alternatives Considered

### Approximate donor ML with untested heuristics
Rejected. Measured above: every bubble-free geometric rule produced false positives on real dialogue, and the adaptive ones produced them at a rate that would damage ordinary manga pages.

### Require a bubble tier so the clean rule becomes available
Rejected. It inverts the product default: users who never enabled a bubble tier would silently receive a different pipeline, and the tested path would not be the shipped path. See Decision 4.

### Ship the geometry rule anyway with a conservative threshold
Rejected for now. The `≥1.2×` non-bubble rule had zero false positives on the manga fixtures but restored only 3 of 10 preserved blocks on the reported page, and it needs a tier. A rule that both depends on an opt-in feature and fixes a minority of cases is not worth a user-facing switch.

### Neural SFX detector (COO detector + recognizer, as Koharu does)
Deferred, not rejected. It is the correct long-term answer, but it is two additional model downloads and a licence review, and it cannot run while `BubbleDetectionMode` is `'off'` either. The cheaper signal to evaluate first is lexical: the blocks that must be preserved (`くうっ`, `ぐちゃ`, `ピクン`, `ブナ`) are dictionary onomatopoeia words, while the blocks a length rule wrongly kills (`可恶…`, `莲实！`) are sentences. That check needs no tier and no model.

## Consequences

### Positive
- The default `'off'` bubble mode stays a complete pipeline, not a degraded one.
- Threshold debates end with a measurement instead of an argument.
- Donor porting has a written acceptance bar, so a port that misses it is visibly a gap rather than a silent regression.

### Trade-offs
- Measurement harnesses cost time before any code is written, and some features legitimately stay unimplemented until a compatible model exists.
- Adaptive baselines are more code than a constant, and still require a floor to be safe.

## References
- [ADR-006](ADR-006-hybrid-bubble-detection-and-conservative-subchamber-partitioning.md) — hybrid bubble detection; free-floating text and sound effects deliberately take the bottom-up route, independent of the bubble tiers.
- [workarounds.md](../development/workarounds.md) — concrete upstream-library mitigations that this ADR governs.
