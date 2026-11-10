# Kites — UI Audit

Scope: marketing site + interactive demo (`site/`), extension popup
(`src/popup`, tokens in `src/index.css`), Edit Studio (`src/studio`,
`src/App.tsx`). Usability findings are separate — see `docs/ux-audit.md`.

Method: Impeccable `audit` (technical quality: contrast, tokens, responsive) and
`critique` (hierarchy, noise, competing focal points), with `quieter` as the
refinement direction. Measurements come from the built artifacts rendered in
headless Chrome at the sizes they ship at (1440×900 and 390×844 for the site,
320px for the popup, 1440×900 for the Studio) plus a token/CSS census.

**Direction: quieter, not different.** Keep the pink + near-black identity. Make
the pink a rose rather than a neon, put all three surfaces on one navy-black
ramp, and delete decorative glow instead of adding anything.

---

## 1. Three unrelated dark systems

| Surface | Page bg | Card | Border |
|---|---|---|---|
| Site | `#090d16` | `#131b2e` | `rgba(255,255,255,.08)` |
| Studio | `#090a0f` | `#12141c` | `#262a3b` / `#282d3f` |
| Popup | `#121212` | `#1E1E1E` | `#4A4A4A` |

The site and Studio are blue-black; the popup is neutral grey. Opening the popup
next to the site is the most visible seam in the product — the popup reads as a
different, older app. The Studio alone uses nine near-black hexes
(`#090a0f`, `#12141c`, `#161924`, `#181a26`, `#1c1f2e`, `#202436`, `#141724`,
`#262a3b`, `#282d3f`); `#262a3b` and `#282d3f` are visually identical and used
interchangeably as the same border role.

**Recommendation:** keep the site ramp (it is the most resolved), move the popup
onto it, and stop adding new Studio neutrals. See the token table in §6.

## 2. Two different pinks, and both are neon

- Site / popup: `#ff2a6d` and `#ff2d75` (HSL 345°, **100%** saturation).
- Studio: `#f4446d` — a *different* hue on the same screens (HSL 350°), plus
  `#e0355e` and `#e0335c` as two spellings of the same hover state.

271 literal `#f4446d` occurrences across `src/studio`; nothing is tokenised, so
the Studio and the popup can never be tuned together. At full saturation a pink
this size stops reading as an accent and starts reading as an alarm — visible in
the Studio sidebar where *Add Text Box*, *Save to DB*, the active view toggle and
*Export* are all competing full-strength pinks.

**Recommendation:** one rose accent in two roles (bright for text/borders on
dark, deeper for filled buttons so white labels stay legible), used everywhere.

## 3. Off-brand indigo and purple in the Studio

`src/App.tsx` (empty state icon, upload button, upload progress),
`src/studio/tools/ImageLayerSettings.tsx`, `Studio.tsx`, `PageRail.tsx`,
`ProjectDetailsPane.tsx` all use `indigo-400/500/600` or `purple-400` — a cool
violet that appears nowhere else in the product. The first-run Studio screen is
therefore indigo, while the editor two clicks later is pink.

**Recommendation:** replace with the brand rose. 14 occurrences, mechanical.

## 4. The light theme changes the brand hue

```css
--color-editorial: #D9381E;   /* light: vermillion */
.dark { --color-editorial: #FF2A6D; }  /* dark: neon pink */
```

Toggling to light mode turns the wordmark and every accent orange-red. Two
accents for one product is a cohesion defect, not a theme.

**Recommendation:** one hue family. Light accent = deeper rose (`#B82A52`,
4.6:1 on the paper background) so contrast holds on the warm `#E4E0D9` paper.

## 5. Glow and gradient budget is spent on decoration

Site census: 13 gradients and 29 `box-shadow` declarations for a 1200px page.

- `.ambient-glow` paints a 1000×500 blurred radial at α `.14` behind the hero.
- `.btn-primary`, `.btn-nav-cta`, `.btn-store-hero` are three *different*
  4-stop gradients (`#be123c → #e11d48 → #ff2a6d → #ff6584`) with four separate
  glow shadows whose spread changes on hover.
- `.demo-seam` stacks a hard `#ff2a6d` line plus two glows.
- The hero card outline stacks a white ring, a pink ring, and two drop shadows.
- 24 `rgba(255, 42, 109, …)` tints, many of them nested (tinted pill inside a
  tinted card inside a tinted section).

Effect: everything on the page is outlined, which means nothing is emphasised.
The eye lands on the nav CTA and the hero button with equal weight, and the
sections below lose hierarchy entirely.

**Recommendation:** one flat fill for primary buttons with a single soft shadow;
one accent tint per surface level; the glow only where something is genuinely
active (the demo seam). The demo card keeps its white ring — it is the product
shot.

## 6. Proposed tokens

Dark surfaces (site ramp, reused by popup and Studio):

| Token | Value | Role | Measured |
|---|---|---|---|
| `--bg-base` | `#090d16` | page | — |
| `--bg-raised` | `#0f1117` | popup page, Studio panels | — |
| `--bg-card` | `#131b2e` | cards | — |
| `--border` | `rgba(255,255,255,.08)` | hairlines | — |
| `--text-primary` | `#E6E8EE` | body | 15.4:1 on `#0f1117` |
| `--text-muted` | `#8B90A0` | helper text | 5.9:1 on `#0f1117` |

Accent (one hue, two roles):

| Token | Value | Role | Measured |
|---|---|---|---|
| `--accent` | `#E85C82` | text, icons, borders, seam on dark | 5.7:1 on `#0f1117` |
| `--accent-soft` | `#F0819E` | accent text on a tinted surface | 7.7:1 on `#090d16` |
| `--accent-fill` | `#D23360` | filled primary buttons (white label) | 4.8:1 for white |
| `--accent-fill-hover` | `#BB2952` | hover | 5.3:1 for white |
| `--accent-tint` | `rgba(232, 92, 130, .10)` | tinted surfaces | — |

Do **not** use `--accent-fill` as text on dark (3.9:1) and do **not** put white
small text on `--accent` (3.3:1). That is exactly why the roles are split.

Light paper theme keeps its warm identity: `--color-paper: #E4E0D9` stays,
`--color-ink: #111111` (14.4:1) stays, accent becomes `#B82A52`.

Typography: `--font-display` and `--font-body` currently name *Cabinet Grotesk*,
*Satoshi*, *Clash Display* and *Inter* — none of which are bundled, `@font-face`d
or loaded from anywhere, so both fall through to bare `sans-serif` while the site
uses `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`. That is why the
popup and Studio do not match the site. Point the tokens at the same system stack
the site already uses (no new assets, no network request).

## 7. Contrast failures (measured, not estimated)

| Element | Pair | Ratio | Verdict |
|---|---|---|---|
| Popup helper text | `#4A4A4A` on `#121212` | 2.1:1 | fail AA |
| Popup helper text (light) | `#A19F9A` on `#E4E0D9` | 2.0:1 | fail AA |
| Disabled pink primary (50 % opacity) | white/`#ff2a6d`@50 % on dark | ≈2.2:1 | fail AA |
| Studio `slate-500` captions | `#64748b` on `#12141c` | 3.6:1 | fail AA (body) |
| Studio white label on `#f4446d` | — | 3.6:1 | fail AA |
| Site muted text | `#94a3b8` on `#090d16` | 7.0:1 | pass |
| Site body | `#f8fafc` on `#090d16` | 17.8:1 | pass |

The site's text scale is the good one; the popup is the failing one and the
Studio is in between.

## 8. Hierarchy and noise, per surface

**Site**

- Section eyebrows ("INTUITIVE EXPERIENCE", "UNDER THE HOOD") are 11px pink
  uppercase at ~0.14em tracking — the lowest-contrast element on the page while
  carrying the section's meaning.
- Cards inside cards inside tinted sections: `.hover-spotlight` (a bordered,
  gradient-filled panel) contains six `.mode-pill` cards, each with its own
  border and tint, while sitting on a `.section` that already has a tinted
  background.
- Two store CTAs in the first screen (nav CTA + hero store button) plus a
  secondary "Install Options" plus "GitHub" — four competing actions above the
  fold.
- Feature cards use emoji (`⚡ 📐 🎨 🔀 🔒 📖`) as icons; the rest of the product
  uses Lucide line icons.
- `#38bdf8` (sky), `#818cf8` (indigo) and `#10b981` (emerald) all appear as
  accents alongside the pink in the hint text and badges.

**Popup**

- Header has five icon buttons of equal weight in one 320px row with a hairline
  divider in the middle of them; the active tab is indicated only by a subtle
  `vellum` background, so the current location is hard to read.
- Every Advanced row ends with the same pink `Pencil` icon — five identical
  accents competing with the labels.
- Surfaces are `paper → vellum` with `dust` borders at 30 % opacity, so the card
  edges are barely there, then the GPU panel reintroduces `border-2` plus
  `shadow-sm` — mixed depth language in one column.

**Studio**

- Pink is used at full strength for three simultaneous primaries in the left rail
  (`+ Add Text Box`, `Save to DB`, and the active `Translated` view toggle) while
  `Export` is a fourth in the top bar.
- Eight unlabelled tool icons in a single row with no grouping or tooltip
  grouping; the selected one is the only pink square, so it reads as a button
  rather than a mode.
- The empty inspector is a bounded card containing centred body text and an
  indigo "Enable Global Edit Mode" button, ~470px of dead vertical space.
- The top bar mixes breadcrumb (`‹ Projects`), four view toggles, a truncated raw
  URL, canvas dimensions, five zoom controls, and `Export` — seven information
  types in 36px. The left cluster's flex children were all `shrink-0` and the
  cluster itself could not shrink, so at ~1300px and below it painted over the
  URL ("Hide Boxes" colliding with the document title) and pushed `Export` out
  of the bar entirely. Three of the zoom controls were unlabelled "fit" glyphs
  that read as duplicates of each other.

## 9. What is working (keep)

- The paper/light "Editor's Light Table" palette (`#E4E0D9`, `#EFECE6`,
  `#111111`) is distinctive and does not need to change.
- The site's `clamp()` type scale and 1024/860/640 breakpoint structure.
- `.dot-field` masked dot texture behind the hero card, and the demo's white ring
  — quiet, brand-specific, worth keeping.
- The popup's `kites-switch` component (one visual language for all toggles) and
  its focus-visible outline.
- Studio's navy ramp *direction* — it just needs to be shared, not reinvented.

## 10. Refinements applied in this pass

1. Popup dark neutrals moved onto the navy ramp; light and dark accents unified
   on the rose family.
2. One accent pair (`#E85C82` / `#D23360`) replacing `#ff2a6d`, `#ff2d75`,
   `#f4446d`, `#e0355e`, `#e0335c`, and the off-brand indigo/violet accents.
3. Site: three multi-stop neon gradients collapsed to the flat accent fill; the
   ambient glow and button glows reduced; 24 pink tints re-hued to the rose.
4. New `--color-muted` text token; `--color-dust` retained for borders only.
5. Type tokens pointed at the system stack the site already uses.
6. Studio canvas top bar: the left cluster is now shrinkable (`min-w-0
   overflow-hidden`) instead of painting over the document title, the project
   name / `Hide Boxes` label / `Canvas: W × H` readout degrade at 1280px and
   1536px before anything collides, and the three unlabelled fit-preset glyphs
   collapsed to the single best-fit button (Fit Width and Fit Height remain,
   labelled, in the zoom menu). Fit is now zero-overflow from 1100px up.
7. Deferred (documented, not changed): the Studio's nine-hex neutral census, the
   popup header's five-equal-weight icons, the Studio tool-icon row, and the
   site's emoji feature icons. Each is a layout/IA decision rather than a token
   fix, and none of them is a correctness problem.
