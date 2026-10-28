# ADR-009: Persist an On-Demand Font Library and Share Its Picker

## Status
Accepted for local implementation. Font redistribution review and full browser visual acceptance remain separate gates.

## Date
2026-10-28

## Context

A preset name alone did not identify dependable glyph metrics. Some presets relied on locally installed or substituted faces; Node visual scripts directly registered reference files unavailable to Chrome. Separately, users needed searchable choices and font imports in both popup and Studio. Duplicating font lists or storing font bytes in popup configuration would make validation and selection drift.

Koharu's native font system demonstrates lazy resource retrieval and persistent font metadata, but its catalog and native shaping stack cannot be treated as an automatically licensed, browser-equivalent font bundle.

## Decision

1. Keep preset metadata in `renderFontPresets.ts` and downloadable entries in the typed `fontCatalog.ts` catalog.
2. Use a curated 12-face OFL catalog with pinned SHA-256 hashes and versioned URLs. Do not mirror an unreviewed external catalog by default.
3. Store downloaded/imported bytes in a Dexie version 6 `fonts` store. Register faces separately in each document using `FontFace`.
4. Expose one searchable `FontPickerDropdown` in popup and Studio. Rebuild MiniSearch indexes from current items instead of mutating one long-lived index during asynchronous hydration.
5. Validate imported files by browser font loading before storage. Treat this as decoding validation, not proof of script coverage, safety against every malformed input, or fit quality.
6. Make font syntax, resource readiness, measurement, and painting explicit contracts. Do not compensate for broken measurement by introducing per-font layout heuristics.

## Alternatives Considered

### System-font presets only
Low download cost, but installed faces and fallback metrics vary between machines and contexts. Retained only where the preset intentionally represents a system/generic family.

### Bundle every font
Offline availability is attractive, but package size and redistribution review grow with the catalog. Keep the curated library on demand; bundled presets require their own license review.

### Separate popup and Studio libraries
Independent implementations would duplicate search, import, and selection semantics. Rejected in favor of a shared component and storage layer.

### Mirror the native donor catalog
Closer inventory coverage, but does not resolve licensing, font-format support, browser shaping, or script subset questions. Not adopted.

## Consequences

- Font bytes survive restart, while registration remains document-local.
- Hash failures are rejected before registration, preventing silent CDN byte changes.
- The cached registration promise and family-based deduplication can leave open documents stale after cross-document imports or same-family replacement; this is not a live synchronization guarantee.
- Bundling CC Wild Words/Anime Ace reference files does not itself establish redistribution rights.
- No claim of exact Koharu layout follows from this architecture. See [font specification](../development/font_library_spec.md) and [ADR-010](ADR-010-contour-layout-and-browser-validation.md).
