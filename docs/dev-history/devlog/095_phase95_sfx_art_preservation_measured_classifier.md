# Devlog 095: Sound-effect art — measured classifier, lexicon rule, and the optional-tier invariant

## 1. Metadata

- **Date:** 2026-11-11
- **Branch:** `feat/ocr-preserve-sfx-art` (not merged; `main` untouched)
- **Feature/Task:** Stop the pipeline from erasing and mistranslating sound-effect artwork, choosing the classifier by measurement rather than assumption.
- **Status:** Implemented behind a user setting with `preserve` as the default. Suite green (1,392 tests / 121 files), typecheck clean, lint unchanged.

## 2. Objective

A reported page showed art destroyed by transcription: `花，草` rendered as `ARRAY OF FLOWERS`, `茶` as `tea`, and brush lettering wiped by inpaint and replaced with small tidy text. The pipeline has three noise gates but all of them ask "is this junk?"; none asks "is this art?". The task was to find a classifier that answers that, with the constraint that a wrong answer must not cost a reader a sentence, and that it must work with `BubbleDetectionMode = 'off'` — the product default.

## 3. What was measured, and what failed

Nine pages (the reported page, four manga fixtures, a textbook page, three synthetic label/UI pages), 100 OCR blocks, six candidate rules. Body baseline was the character-weighted median glyph size, so dialogue dominates it and SFX cannot inflate its own reference.

| Rule | False positives on manga pages |
|---|---|
| fixed `1.6×` median + ≤12 chars | 0, but restored 1 of 10 blocks |
| `1.35×` body baseline | 1 — a real dialogue line |
| 1-D k-means (k=2) cut | 2, including a whole sentence |
| largest-gap cut | 2; fired on 12 blocks of a label page |
| `≤3 chars` only | 4 (`可恶…`, `老师ー`, `莲实！`) |
| not-in-bubble + `≥1.2×` + ≤12 chars | 0 — but requires a bubble tier |

Two conclusions:

1. **Geometry cannot do this.** Size and ink density overlap completely between SFX and dialogue. Unsupervised adaptive cuts are worse than a constant: on `image4` (four dialogue blocks, no SFX) k-means cut at 0.92 and largest-gap at 0.90, splitting a homogeneous dialogue population and skipping `重要なのは実用性だね。`.
2. **The only clean geometric rule borrowed an opt-in tier.** `BubbleDetectionMode` is `'off' | 'heuristic' | 'neural'`; using `HeuristicBubbleEngine` inside an experiment is legitimate, but shipping a feature that needs it while the mode is `'off'` would make the default pipeline depend on a feature the user never enabled.

## 4. What worked: the text itself

The blocks that must be preserved (`ピクン`, `くうっ`, `ぐちゃ`, `おぽっフ`) are dictionary onomatopoeia. The blocks a length rule wrongly killed (`可恶…`, `莲实！`) are sentences. That distinction is in the OCR text, so it needs no tier and no model.

The classifier is a lexicon match over the J-Ono dataset (MIT, 557 entries after trimming to kana forms plus English equivalents), with kana folding (katakana→hiragana) and tolerance for one OCR glyph of drift. Measured over the same 100 blocks:

| Page | Hits | Verdict |
|---|---|---|
| Reported page | 4/17 — `ピクン`, `くうっ`, `おぽっフ`, `ぐちゃ` | all genuine SFX |
| `image1` (textbook) | 1/12 — `はあはあ` | panting sound; borderline on a textbook page |
| `image4`, `image6`, `image7`, `image8` (dialogue) | 0 | no dialogue touched |
| `image2`, `image3`, `image5` | 0 | — |

Recall is 4 of 10 SFX-ish blocks on the reported page: the misses (`IM一`, `之`, `ブナ`, `茶`, `いうあん`) are kanji fragments and OCR noise that no Japanese kana dictionary covers. Zero false positives on every page that contains real dialogue. That trade is the intended one — a missed SFX stays as art, a false positive would delete a sentence.

## 5. Implementation

- `src/shared/sfx/onomatopoeiaLexicon.ts` — generated catalog (557 entries, 48 KB) with inline provenance; `ATTRIBUTION.md` carries the required MIT notice.
- `src/shared/sfx/SoundEffectClassifier.ts` — `ISoundEffectClassifier` contract plus `LexiconSoundEffectClassifier`. The contract exists so a model-backed classifier (the COO detector+recognizer pair the Koharu donor uses) can be dropped in without editing any service.
- `src/shared/sfx/sfxPolicy.ts` — `SFX_POLICIES` catalog, `isSfxPolicyId` guard, and `SFX_POLICY_STRATEGIES` keyed by the derived identifier union, so a catalogued policy cannot exist without behaviour and services never branch on identifier strings.
- `OcrManager` — classifier injected through the constructor (default: the shared lexicon instance); `sfxIndices` filled from it plus the existing CJK shout detector; SFX masks dropped from `rawPolygons` only when the resolved strategy preserves artwork.
- `PipelineOrchestrator` — resolves the strategy once and gates the overlay skip on it, instead of comparing policy strings.
- `SettingsView` — a "Sound Effects" select rendered from `SFX_POLICIES`.
- Storage boundary normalizes `sfxPolicy` like every other enum, defaulting to `preserve`.

Verified against the reported page: 4 blocks marked (`ピクン`, `くうっ`, `おぽっフ`, `ぐちゃ`), their four raw quads (`14, 18, 19, 20`) excluded from the erase set, and all 13 dialogue/caption blocks still translated with their 17 quads inpainted.

## 5b. Follow-up: brush strokes read as text (artwork roles)

A second reported page exposed the limit of the lexicon alone. OCR read a 716x349 region of brush lettering as `こブンャっー`; the lexicon had no entry, so the block was translated and inpainted, erasing 249,884 px² — 10.8% of the page from a single box, 21.2% of the page in total. The same page carried single-glyph readings (`糸`, `名0`, `房`, `市上`) that were translated literally into `SILK`, `NAME`, `FATE`, `MARKET`, `GUN`.

`sfxIndices` became an artwork role list with three kinds:

| Kind | Rule | Policy |
|---|---|---|
| `sound-effect` | kana lexicon hit, or a CJK/Hangul shout | user policy |
| `display-lettering` | glyph size ≥ 2.0× the page's body baseline | user policy |
| `fragment` | ≤ 2 glyphs, at least one CJK, no sentence punctuation | always preserved |

The 2.0 ratio is measured, not chosen: on that page the brush block scored 5.63× and a 138px glyph scored 2.23×, while the largest genuine line scored 1.52×. The fragment rule excludes any block carrying punctuation, which is what keeps `可恶…`, `老师ー`, `莲实！`, `唔…`, `お？` translatable. The limit stayed at two glyphs deliberately: three-glyph real speech exists (`ごめん`, `だめだ`), so three would start deleting dialogue.

Measured effect on the reported page: erased area 21.2% → **7.6%** under the default policy (12 fragments plus the 716x349 block preserved), 17.9% under `translate-plainly` (fragments are still never erased). On the earlier page, 7 blocks are now preserved instead of 4 — `之`, `ブナ`, `茶` joined the four kana sound effects.

## 6. What is deliberately not done

- **No SFX rendering.** `translate-plainly` erases and prints in the normal display font, which is visibly unlike hand lettering. A matching SFX style, and a lexicon with Chinese coverage, are prerequisites for a proper replacement.
- **No tier-based refinement yet.** When a bubble tier is enabled, "outside every bubble" adds reliable evidence and can raise recall above 4/10. It stays out of the default path by construction.
- **No model.** The COO detector/recognizer remains the strongest long-term option, deferred on download size and licence review.

## 7. Invariants recorded

- `docs/decisions/ADR-012-pure-code-invariants-and-optional-tier-independence.md` — the 90% bar for pure-code ports, derived thresholds, the damage-direction rule, and the ban on depending on opt-in tiers.
- `AGENTS.md` §3.2 points at that ADR rather than restating it.
