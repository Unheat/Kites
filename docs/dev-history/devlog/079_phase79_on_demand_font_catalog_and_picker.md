# Phase 79: On-Demand Font Catalog, Shared Picker, and Hydration Crash

## 1. Metadata

- **Date:** 2026-10-27–2026-10-28.
- **Commits:** `3663888` catalog/library/picker, `4368dbd` search-index crash repair, `cf6dadf` bundled preset resource changes. Earlier `a5e7f9b` bundled Patrick Hand SC and added explicit pipeline preload.
- **Status:** merged into local main; not a release or remote push.

## 2. Objective

Make font choices accessible from both popup and Studio, support on-demand downloads and local imports, and reduce dependence on unavailable system fonts without bundling an entire font catalog.

## 3. Implementation

1. Added `src/shared/fontCatalog.ts` with 12 curated Latin-subset OFL faces and pinned SHA-256 hashes.
2. Added `fontLibrary.ts` for download/hash checks, file decoding validation, persistence, per-document FontFace registration, and library listing.
3. Added Dexie schema version 6 `fonts` store. Existing database test cleanup transactions now include that store.
4. Replaced popup and Studio font controls with shared `FontPickerDropdown`, including search/download/import behavior. Preset choices still derive from `renderFontPresets.ts`.
5. Added boot-time library registration in Studio and offscreen contexts. Download/import registers immediately in the current document; startup registration rehydrates stored bytes.
6. Bundled reference CC Wild Words/Anime Ace resources and aliases separately from the curated on-demand catalog. This does not establish redistribution rights or mean every donor font was adopted.

## 4. Roadblocks and decisions

### MiniSearch duplicate IDs blanked the popup

Asynchronous library hydration changed picker items while a reused search index accumulated entries. Duplicate keys caused MiniSearch to throw. `4368dbd` rebuilds the index immutably in `useMemo` when items change and wraps the picker in an error boundary. Search-index ownership, not React styling, was the failure.

### Integrity is not layout quality

A matching hash identifies catalog bytes; `FontFace.load()` checks browser decoding. Neither proves all characters exist, font metrics will match another renderer, or a sentence fits a given bubble. The separate Canvas font-stack bug persisted even after the right font files were bundled; see Devlog 078.

### Cached registration and family identity

Registration deduplicates by family and startup uses a cached promise. A same-family replacement or a new import in another already-open document is not automatically guaranteed to refresh every context. File-import family names derive from filenames, not a complete internal-name inspection.

### Licensing and native-donor scope

The curated OFL catalog follows an on-demand architecture, not a wholesale mirror of Koharu's pinned catalog. Reference-file availability and noncommercial use do not automatically authorize redistribution. Publication must independently review bundled reference fonts.

## 5. Verification and follow-up constraints

Catalog, font library, picker, and preset suites were added/updated. At local-main merge the complete suite reported 1,122 passing tests and the production build passed. The original picker crash had a unit-tested repair, but no claim is made here that every download/import, script, cold-start race, or open-context synchronization path has passed browser visual acceptance.

The [font library specification](../../development/font_library_spec.md) records current interfaces and limits. [ADR-009](../../decisions/ADR-009-on-demand-font-catalog-and-koharu-2d-contour-invariants.md) records the storage/catalog decision and rejected alternatives.
