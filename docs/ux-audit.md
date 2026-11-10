# Kites — UX Audit

Scope: the Chrome extension popup (`src/popup`), the Edit Studio dashboard + editor
(`src/studio`, `src/App.tsx`), and the marketing site with its interactive demo
(`site/`). Visual/design findings live separately in `docs/ui-audit.md`; this
document is about usability only.

Method: Impeccable `critique` heuristics (working-memory load, state visibility,
error prevention, recovery) supplemented by `harden` (state coverage) and
`clarify` (copy). Every finding was reproduced against the built extension
(`npm run build:dev`, headless Chrome, 320px popup viewport / 1440px studio) or
read out of the shipped code. Findings are ordered by severity.

Severity: **S1** blocks a task or hides a feature · **S2** causes hesitation or a
wrong assumption · **S3** friction/polish.

---

## S1 — "Open Edit Studio" is unreachable while the extension is off or the site is paused

**Affected:** popup, all tabs, the `OFF` / `PAUSED` states.

**Evidence:** `src/popup/index.tsx` wraps both the tab content *and* the studio
footer button in one wrapper:

```tsx
{/* Main Content Area (Dims when disabled) */}
<div className={`flex-1 flex flex-col transition-opacity duration-300 ${
  (!state.isExtensionEnabled || isCurrentDomainDisabled) ? 'opacity-40 pointer-events-none grayscale' : ''
}`}>
  <div className="flex-1 flex flex-col px-3.5 pb-3.5"> … tabs … </div>
  {/* Footer Action: ONLY Open Edit Studio lives through all panels */}
  <div className="px-3.5 pb-3.5 flex flex-col gap-2"> … Open Edit Studio … </div>
</div>
```

The comment claims the footer "lives through all panels", and it does — but it
lives inside the inert wrapper. `pointer-events-none` kills the click target and
`opacity-40 grayscale` makes it look disabled.

**Why it is confusing:** the Studio is a standalone editor that needs neither a
live tab nor the content script. Turning Kites off for one site currently locks
the user out of an unrelated product surface, with no explanation — the button
just stops responding. Reproduced: toggling the power icon off renders the button
greyed and unclickable.

**Minimal fix:** move the footer out of the dimming wrapper so only the
per-site tab content is dimmed. One `</div>` relocation, no new state.

---

## S1 — Muted helper text is unreadable (~2:1 contrast)

**Affected:** popup, every tab. Studio uses `slate-500` on the same dark values
and has the same problem in places.

**Evidence:** `--color-dust` is doing two jobs — border colour *and* body text:

```css
--color-dust: #A19F9A;          /* light */      contrast on #E4E0D9 ≈ 2.0:1
.dark { --color-dust: #4A4A4A; } /* dark  */      contrast on #121212 ≈ 2.1:1
```

It is used as text 116 times (`text-[var(--color-dust)]`), e.g. the
Auto-Translate subtitle "Requires manual activation", the manual-mode helper
"translate button appears when hovering over images", the VRAM estimates inside
GPU Acceleration, and every "No models found"-class message. WCAG AA needs
4.5:1 for this size.

**Why it is confusing:** these strings are the only place that explains what a
control does. Users skip them because they are visually indistinguishable from a
disabled label and physically hard to read at 11–12px.

**Minimal fix:** introduce a dedicated `--color-muted` text token
(dark `#8B90A0` ≈ 5.9:1, light `#5F646F` ≈ 4.6:1), keep `--color-dust` for
borders and the switch track, and swap the 116 text usages. Mechanical, no
markup change.

---

## S2 — The GPU capability badge is clipped

**Affected:** popup → Settings → Advanced & Integrations → GPU Acceleration.

**Evidence:** rebuilt popup at 320px, dark theme:

> `[ Unsupported✗` — the badge border cuts through the last glyph.

`src/popup/components/GpuAccelerationPanel.tsx` puts the badge in a
`flex items-center gap-2` row next to the `Re-check` button with no shrink
protection:

```tsx
<span className={`text-[11px] px-2 py-0.5 rounded-md font-medium flex items-center justify-center …`}>
```

**Why it is confusing:** this badge is the single signal for whether local
WebGPU inference is available, and the broken glyph reads as a rendering bug, so
users discount the whole panel. It also collides with `Re-check` at exactly the
320px popup width Chrome uses.

**Minimal fix:** `whitespace-nowrap shrink-0` on the badge. Two utility classes.

---

## S2 — Disabled primary buttons render as muddy pink, not "unavailable"

**Affected:** popup → Batch tab ("Select Pages to Translate", "Open Reader (0)",
"Export ZIP (0)"); Studio → dashboard Actions (Open/Export).

**Evidence:** `src/popup/components/BatchScanPanel.tsx:741`

```tsx
className="w-full py-2 bg-[var(--color-editorial)] text-white … disabled:opacity-50 …"
```

`opacity-50`, not a colour change, is applied to the whole button: on a dark
surface a 50%-opacity saturated pink becomes a dirty maroon, and 50%-opacity white
label drops to ~2:1. In the Studio dashboard the same pattern makes
`Open`/`Export` look *broken* rather than *not-yet-applicable* (the only clue is
the tiny "Select a project" caption).

**Why it is confusing:** the button keeps its primary, "click me" weight while
being unusable, so the empty state reads as a defect instead of "nothing selected
yet".

**Minimal fix:** replace opacity with explicit tokens —
`disabled:bg-[var(--color-vellum)] disabled:text-[var(--color-muted)] disabled:shadow-none disabled:cursor-not-allowed`.
No layout change.

---

## S2 — "Requires manual activation" describes an absence

**Affected:** popup → Home → Auto-Translate card.

**Evidence:** `src/popup/components/AutoTranslateControl.tsx`

```tsx
{state.isAuto ? 'Translates visible images automatically' : 'Requires manual activation'}
```

**Why it is confusing:** the two branches are not parallel. The "on" text says
what happens; the "off" text says what is required, which reads as a missing
prerequisite ("do I need to activate something first?") rather than the actual
state ("off — you translate images yourself"). Users hunt for an activation
control that does not exist.

**Minimal fix:** copy only, e.g. `'Off — translate images when you ask'`.

---

## S2 — No mobile navigation on the website

**Affected:** `site/index.html` under 860px.

**Evidence:** `site/css/styles.css`

```css
@media (max-width: 860px) {
  .nav-links .nav-link { display: none; }
}
```

At 390px the header shows only the logo and a circular store CTA. Showcase,
Features & UI, Architecture, Install, Pipeline Map, Privacy and GitHub all
disappear; the only remaining route to those sections is scrolling the page or
the footer.

**Why it is confusing:** the demo and the feature sections are the primary
argument on a phone, and there is no affordance that they exist.

**Minimal fix:** do not add a menu. Below 860px let `.nav-links` become a
single-row horizontally scrollable strip (`overflow-x: auto`, `scrollbar-width:
none`, `flex-shrink: 0` on links). Roughly 8 lines of CSS, no JS, keeps the
existing markup and DOM order.

---

## S3 — Engine/model selection is invisible from the popup's default tab

**Affected:** popup → Home.

**Evidence:** `EngineDropdown` renders only `LanguageSelector` +
`AutoTranslateControl`. `EngineSelectionPanel` (translation engine, cleaning
engine, colorization, OCR, bubble mode, font) is only mounted inside
`SettingsView`. The tab is called "Home" and occupies the whole first screen with
four controls.

**Why it is confusing:** the single most impactful setting (which model
translates) is two clicks away behind a gear icon, while the home tab looks
complete. Users report "wrong translation quality" or "model is still
downloading" with no on-home signal of what is active.

**Recommendation (not implemented):** a read-only status row on Home — current
engine name + download/loading state — that links to Settings. Deliberately left
out of this pass to keep the change set small; it needs a product decision about
whether Home should grow.

---

## S3 — Studio dashboard's *thumbnail size* slider looks like canvas zoom

**Affected:** Studio → Projects dashboard, bottom-left bar.

**Evidence:** `src/studio/projects/ProjectsGrid.tsx` renders `ZoomOut` / `ZoomIn`
icons around a range input that actually sets `tileSizeRem`:

```tsx
<ZoomOut className="w-3.5 h-3.5 text-slate-500" />
<input type="range" min={MIN_TILE_SIZE_REM} … onChange={e => setTileSizeRem(…)} />
<ZoomIn className="w-3.5 h-3.5 text-slate-500" />
```

**Why it is confusing:** the editor's real zoom control sits in the same spatial
position (bottom-right cluster, top bar), so dashboard users assume this resizes
the page canvas, and nothing they expect happens to the artwork.

**Minimal fix:** label it — `title`/`aria-label="Thumbnail size"` on the input.
If a stronger signal is wanted later, swap the icons for a grid-density icon.

---

## S3 — Duplicate "Global Edit Mode" affordances in Studio

**Affected:** Studio → editor sidebar.

**Evidence:** the empty inspector card contains an "Enable Global Edit Mode"
button, and the sidebar footer contains a "GLOBAL EDITING (OFF)" bar for the same
state. Both toggle the same flag; the in-card one looks like the canonical CTA
while the footer one looks like a status readout.

**Why it is confusing:** two controls, one state, no indication they are the same
thing.

**Recommendation:** keep the footer bar (always visible, real status) and reduce
the in-card button to a plain link, or drop it. Not implemented here because it
touches inspector layout.

---

## S3 — Batch scan toolbar is over-packed for a 320px popup

**Affected:** popup → Batch tab, top toolbar.

**Evidence:** one row holds a select-all checkbox, `0 / 0 pages`, a refresh icon
button and a `Fast Scan` button. At 320px the refresh control is nearly invisible
and the row has no breathing room; the "Fast Scan" call to action competes with
the (disabled) pink `Select Pages to Translate` directly below it.

**Why it is confusing:** the empty state tells users to "run Fast Scan", but the
button is the least prominent element in a crowded row.

**Recommendation:** give Fast Scan a persistent primary style when the page
count is 0, and demote the refresh button to a labelled item. Deferred; it is a
layout decision rather than a bug.

---

## Verified as working (no action)

- **Model availability in modes.** `EngineSelectionPanel` gates correctly and
  explains why: `[Sign In Required]` with a help tooltip for the community pool,
  `[WEBGPU · GPU OFF]` for models blocked by the GPU toggle, and a
  sibling download button for uninstalled models (with the documented
  disabled-ancestor workaround). No "silently greyed out" controls found here.
- **`EngineDropdown` GPU warning** reactively offers both recovery actions
  (Enable GPU / switch to Google Translate) instead of only stating the problem.
- **Website demo.** `site/js/main.js` respects `prefers-reduced-motion`, the
  comparison is keyboard operable through a labelled native range input, the page
  picker exposes `aria-pressed`, and images are preloaded/decoded before swapping.
- **State coverage in the popup data path.** Optimistic updates are serialized and
  a failed storage write is logged rather than swallowed.

## Priority for this pass

| # | Finding | Severity | Implemented |
|---|---|---|---|
| 1 | Studio button trapped in disabled wrapper | S1 | yes |
| 2 | Muted text at 2:1 contrast | S1 | yes |
| 3 | Clipped GPU badge | S2 | yes |
| 4 | Muddy disabled primaries | S2 | yes |
| 5 | Auto-Translate off-copy | S2 | yes |
| 6 | No mobile website nav | S2 | yes |
| 7 | Dashboard tile-size slider unlabelled | S3 | yes |
| 8 | Engine status missing from Home | S3 | no — needs a product decision |
| 9 | Duplicate Global Edit Mode | S3 | no — inspector layout |
| 10 | Batch toolbar packing | S3 | no — layout decision |
