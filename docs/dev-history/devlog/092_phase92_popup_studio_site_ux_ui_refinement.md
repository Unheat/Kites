# Devlog 092: Popup, Studio, and Website UX/UI Audit and Refinement

## 1. Metadata

- **Date:** 2026-11-10
- **Branch:** `design/ux-ui-audit-refinement`
- **Feature/Task:** Audited the extension popup, the Edit Studio, and the marketing
  site for usability and interface quality; shipped the highest-ROI fixes.
- **Status:** Completed, build green, 1,330 tests passing.

## 2. Objective

Add a durable UX and UI record of the three shipped surfaces, then fix the small
number of correctness and cohesion defects found, without redesigning anything.
The pink + near-black identity stays; the pink gets quieter and the three
surfaces stop looking like three different products.

## 3. Workflow and Implementation

1. **Reproduced all three surfaces.** The built extension was rendered in headless
   Chrome (320px popup for Home/Settings/Batch/light/disabled, 1440px Studio
   editor and Projects dashboard, 1440px and 390px site). The Studio needed a
   seeded `KitesDatabase` (job + image + text blocks) so the editor could render
   without running a real translation.
2. **Wrote `docs/ux-audit.md`** (usability only) and **`docs/ui-audit.md`**
   (visual/system only), each with code evidence, measured contrast, and a
   minimal recommended fix.
3. **Fixed the popup's dead Studio entry point.** `Open Edit Studio` sat inside
   the `opacity-40 pointer-events-none grayscale` wrapper, so turning the
   extension off or pausing a site made the editor unreachable. The footer moved
   outside the dimming wrapper; only per-site tab content dims now.
4. **Split the text token from the border token.** `--color-dust` was used as
   body text 116 times at ~2:1 contrast. Added `--color-muted` (dark `#8B90A0`
   ≈ 5.9:1, light `#5F646F` ≈ 4.6:1) and swapped the text usages; `--color-dust`
   keeps borders, dividers, and the switch track.
5. **Split the accent into two roles.** `--color-editorial` is now text/border
   accent (`#E85C82` dark, `#B82A52` light) and the new `--color-accent-fill`
   (`#D23360` dark) carries white labels at 4.8:1. Fifteen filled surfaces moved
   to the fill token; the light theme no longer switches the brand to vermillion.
6. **Moved the popup onto the navy ramp** shared by the site and Studio
   (`#0F1117` / `#151822` / `#1A1E29` instead of `#121212` / `#1A1A1A` /
   `#1E1E1E`).
7. **Collapsed the Studio's second pink.** 271 literal `#f4446d` occurrences
   (plus `#e0355e` and `#e0335c`, two spellings of the same hover) became
   `#E85C82` for accents and `#D23360` for fills. Off-brand `indigo-*` /
   `purple-*` accents in `App.tsx` and the Studio tools became the same rose.
8. **Quietened the site.** Three 4-stop neon gradients became the flat accent
   fill; the ambient glow dropped from α .14 to .09 with a wider blur; the demo
   seam is now the only glowing element; the `FREE` badge darkens instead of
   lightening (white label was 3.6:1, now ≥5:1); the store-button eyebrow moved
   from 10px to 11px and lost the `.85` opacity that cost it 1:1 of contrast.
9. **Repaired small state defects.** `Unsupported✗` badge clipped at 320px
   (`whitespace-nowrap shrink-0`); disabled primaries in the popup batch panel and
   the Studio dashboard now change colour instead of fading to muddy pink; the
   Auto-Translate off-state copy describes the state instead of implying a missing
   prerequisite; the dashboard tile-size slider is labelled.
10. **Restored mobile navigation.** Section links were `display: none` below
    860px. They are now a single masked, horizontally scrollable strip, and the
    store CTA was moved out of `<nav>` so it stays visible (it had been scrolled
    off-screen by the new strip).

## 4. Roadblocks and Decisions

- **Could the extension be loaded for screenshots?** No. Chrome 157 rejects
  `--load-extension` in headless and headed automation on this machine, and the
  `DisableLoadExtensionCommandLineCommandLineSwitch` override had no effect. The
  popup and Studio were rendered from `dist/` over a local HTTP server with a
  minimal `chrome.*` stub injected before page scripts; IndexedDB was seeded
  through the raw API at Dexie version 6 so the Studio's own `db.ts` opened it
  without an upgrade.
- **Tokenise the Studio or sed it?** Introducing a Tailwind theme token and
  rewriting 271 arbitrary-value classes is a much larger diff with the same visual
  result. Two-pass literal replacement was chosen, with fills and accents split so
  white labels stay readable. The Studio's nine near-black neutrals were left
  alone and documented as follow-up.
- **`--color-dust` semantics.** Renaming the border token and re-pointing ~100
  border usages would have brightened every hairline. Keeping `--color-dust` for
  borders and adding a text-only token is the smaller, safer change.
- **Deliberately not implemented:** an engine-status row on the popup Home tab,
  removing the duplicate "Global Edit Mode" affordance, and repacking the batch
  toolbar. Each needs a layout or product decision, so they are recommendations in
  `docs/ux-audit.md` rather than edits.
- **Kept:** the gradient hero headline (the one accent gradient that is identity,
  not decoration) and the demo card's white ring.

## 5. Verification and Next Steps

- Extension suite: **1,330 tests / 117 files passed** (`npx vitest run src/`).
- Lint: no errors (72 pre-existing warnings) via `npm run lint`.
- Build: clean `npm run build:dev`.
- Impeccable detector: 0 findings on the popup, Studio, and token files. The site
  keeps 3 identity-level findings (gradient headline, kicker-above-heading,
  nested reveal cards) that are documented rather than changed. All low-contrast
  findings were resolved.
- Visual: before/after captures at 1440×900 and 390×844 (site), 320px (popup
  Home/Settings/Batch/light/disabled), and 1440×900 (Studio editor/dashboard).
- Next: consider whether the Studio should adopt the shared `--color-*` tokens
  instead of literals, and collapse its nine near-black hexes to three.
