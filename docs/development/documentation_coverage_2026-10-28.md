# Documentation Coverage: Local Main Catch-up, 2026-10-28

## Scope and status

Audit baseline is local `origin/main` through local `main` at `656d720`, including the earlier Koharu merge `709998f` and the font branch fast-forward. This covers cumulative changes, not only the final browser font bug. `origin/main` is the locally available tracking ref, not a fresh remote synchronization. No release, deployment, or remote push is implied.

Runtime changes were already merged at the user's request. This catch-up changes documentation only. Historical commit subjects and devlogs are retained; stronger claims in them are qualified by current specifications.

## Coverage map

| Change family | Implementation references | Documentation |
| --- | --- | --- |
| Project retention/upload identity | `03f8ff1`, `db.ts`, `studioUpload.ts` | Devlog 080; architecture overview; fullplan current-state note |
| Translation parser, numeric text, CJK glossary boundaries | `c7c5601`, translation engine, casing and glossary helpers | Devlog 080 with remaining numeric-prefix limitation |
| PSD text bounds/invalidation | `3e6b0aa`, `psdExport.ts`, undo/store paths | Devlog 080; Studio architecture |
| Color lightness LUT/buffers, inference serialization, lazy export | `a99f1b2`, runtimes/managers, batch export | Devlog 080; pipeline and runtime architecture |
| Studio color/page information wiring | `63a951d`, color/page-info controls, bridge/store | Devlog 080; Studio architecture |
| Earlier three-route and per-bubble color work | `7e163d4` through `8b757fe`, color clustering `9cff823` | Existing devlogs 069–074; updated route specs and pipeline architecture |
| Neck decomposition, mask extraction, scale axes, shared chambers | `e077db5` through `a22c647` | Existing devlogs 073–076; current Koharu/Kites contract |
| Hyphen marker recovery, Studio carrier crash, contour bridge/DB, skip flags | `a7a64ee`, `830165f` | Devlog 077; current renderer/Studio contract |
| Probe-loop optimization, shared original raster, dead-code removal, mode/message cleanup | `e080f37`, `e131097`, `5010cf8` | Devlog 077; route specs; pipeline architecture |
| Exact line placements and first-open preservation | `b510c16` | Current renderer and Studio architecture; ADR-010 |
| Dead neural-mask normalization and page-switch result guards | `371dd33` | Devlog 080; current limitations noted |
| Patrick Hand preset readiness | `a5e7f9b` | Devlog 079; font library spec |
| Catalog, imports, schema v6, shared picker, duplicate-index crash | `3663888`, `4368dbd` | Devlog 079; ADR-009; font library spec |
| Chrome probe, font aliases/assets, outlines, resize/reset | `b84af75`, `6a3b878`, `cf6dadf`, `ef1361e` | Devlog 078; current Studio/pipeline specs; ADR-010 |
| Legacy ellipse cleanup and saved geometry fallback | `ee09b0d` | Current mode contract; ADR-010; documented routing gaps |
| Canvas font syntax, coordinate probe, local caps and threshold changes | `843db0b`, `656d720` | Devlog 078; workarounds section 15; current spec and test guide |

## Updated navigation and graphs

- `docs/README.md` links current specs, ADR-009/010, and devlogs 078–080.
- `docs/architecture/` has current pipeline, model/font-runtime, persistence, and Studio lifecycle descriptions.
- `docs/dev-history/kites_flow.md` preserves its older snapshot with a current-state overlay.
- `docs/fullplan.md` retains its detailed plan and adds a current-state correction rather than shortening history.
- The interactive graph source/output status is described in the documentation hub; generated diagrams are not implementation or visual-parity evidence.

## Corrections to earlier claims

1. The CSS font-stack defect is an application integration bug. Chrome retains the previous valid font after invalid assignment; it need not remain at 10px on a reused context.
2. Node's hardcoded family stack and transcription were not the same as the live browser inputs. No controlled whole-page parity assertion exists.
3. Koharu's 24px maximum applies to nonbubble text. Kites word-count ceilings 18/20/24px and geometry ratios are custom tuning, not an exact donor port.
4. A blue contour outline proves stored geometry exists, not that the displayed mode or baked solver used it.
5. Original contour baselines are currently transient Studio metadata; Reset does not restore original position/rotation across reload.
6. A successful build or 1,122 passing unit tests is not a visual quality gate. The final inspected browser image still had an unsatisfactory central narrow-text region.
7. Font integrity/decoding checks are not redistribution licenses or coverage guarantees.

## Verification record

- Prior runtime merge verification in this session: `npm test` and `npm run build` succeeded on local main.
- Ancillary-change audit independently ran 194 tests across 15 files successfully.
- Documentation checks cover local links, Markdown fences, JSON/graph references, diff whitespace, and code-path references where applicable. Any generated diagram render status is reported separately; no browser parity run is being claimed for this documentation-only commit.
