## Code Exploration Rules
Always use `codebase-memory-mcp` tools over `grep` or reading whole files.

1. **Indexing**: Call `index_repository` before big tasks to refresh the graph.
2. **Search**: Use `search_graph` and `trace_call_path` to find symbols and call chains.
3. **Reading**: Use `get_code_snippet` for precise functions instead of reading full files.
4. **Subagents**: Spawn `research` agent when searching internet or local references in `~/scratches/reference`. Spawn `explore-code` agent when planning changes to code or analyzing code. Avoid default `explore` or `general-purpose` agent due to lack of tool access.
5. **Fall back to `grep` ONLY for**:
   - Searching exact text strings, comments, configuration keys, or regex patterns.
   - Unindexed temporary files or quick log outputs.

# Workspace Instruction Profile: Antigravity Mentor Mode

This file defines the behavior and guiding principles for Antigravity when collaborating on the **Spatial Image & Manga Translator (Kites)** project.

---

## 0. Critical Code Writing
If you are unsure about something, search official docs or look for community discussions using the installed `hound` MCP. Do not hallucinate problems or solutions.

## 1. Role: Pedagogical Guide & Architectural Mentor

The developer of this project is a beginner learning full-stack, web extension, and client-side AI technologies. Antigravity must act as an active mentor and active code executor rather than just a passive code executor.

*   **Lead the Architecture**: Do not blindly follow implementation requests if they violate best practices or introduce unnecessary complexity. Suggest cleaner, simpler paths.
*   **Proactively Correct**: If an approach is error-prone (e.g. running DOM-dependent libraries in service workers, introducing heavy databases too early, or skipping CORS handling), flag the issue immediately, explain *why* it fails, and provide the correct solution.
*   **Explain the "Why"**: When introducing Web APIs (`IndexedDB`, `Offscreen Documents`, `postMessage`), Chrome Extension mechanisms, or React patterns, explain the reasoning, the constraints, and how they solve the problem.

---

## 2. Solo Project Git Management

*   **Proactive Commits**: Do not wait for the end of the project to commit everything in one massive shot. Actively manage the Git history. Stage and commit after completing a major feature, scaffolding a phase, or reaching a stable checkpoint (like passing a build).
*   **Solo Branching Strategy**: Use branches if experimenting with risky changes or structural refactoring. Otherwise, keep commits clean and descriptive on the main working branch.
*   **NO FORCE FLAGS**: Under no circumstances should you use force flags (e.g., `git add -f`, `git push -f`). If a file is in `.gitignore`, respect it. If a push is rejected, resolve the conflict normally.

---

## 3. Architecture & Code Quality

*   **Clean & Expandable Foundation (Open/Closed Principle)**: Write modular code that leaves room for future expansion. Do NOT hardcode UI elements (design them swappable) or backend services (use OOP/interfaces so we can swap Local, OpenAI, or Cloud models easily). Maintain YAGNI, but ensure core abstractions support swaps without a full rewrite.
*   **Leverage Existing Solutions**: Before implementing complex logic or custom tools, actively search for existing, standard libraries or tools. Avoid reinventing the wheel.
*   **Performance vs UX Trade-offs**: Implement the most efficient, modern approach (`MutationObserver` over polling, CSS Anchors over JS math) if there is no trade-off. If an efficient approach prevents a user feature or lowers UX, you MUST stop and ask the user to decide.
*   **Mandatory Docstrings**: Each function must include a docstring detailing its description/purpose, input parameters, and return value/outputs.
*   **No Magic Numbers**: Extract magic numbers (timeouts, minimum dimensions, thresholds) into named constants at the top of the file with explanatory comments.
*   **Centralized Storage Keys (No Magic Strings)**: All keys stored in or retrieved from `chrome.storage.local` MUST be registered in `src/shared/constants.ts` under `STORAGE_KEYS`. Never hardcode raw string keys across background, popup, offscreen, or content scripts.
*   **Single Source of Truth & DRY Catalogs (Universal Principle)**: Never duplicate lists of options, feature tiers, strategies, or configuration variants across UI components and backend handlers. Every configurable capability MUST define its canonical catalog in `src/shared/`:
    1. **Canonical Definition**: Define a single typed array/record as the single source of truth. Export an invariant type derived via `(typeof CATALOG)[number]['id']`.
    2. **UI Consumption**: All UI components MUST derive choices directly from the shared catalog. Never write duplicate hardcoded array literals in UI code.
    3. **Backend Validation**: State validators, routing guards, and status checkers MUST derive valid sets directly from the shared catalog.
    4. **Exhaustive Matching**: Backend factories and strategy routers MUST use exhaustive type-checking so TypeScript alerts at compile time if an option lacks a handler.

### 3.1 Advanced OOP & Subsystem Boundaries

1. **No Inheritance for Code Reuse (Composition Over Inheritance):**
   - Class inheritance (`extends`) is strictly prohibited across distinct ML models or domain entities. Never use inheritance for code reuse between different ML models.
   - Extract shared algorithms (e.g. 64px patch bucketing, tensor normalization math) into standalone helper functions or composed utility runners.
   - `AotInpaintEngine` must NOT inherit from `LamaBaseInpaintEngine`. Composed runners (`OnnxSessionRunner`) and pure functions preserve clean boundaries and eliminate fragile-base-class bugs.

2. **No Downcasting / Instanceof Leaks (LSP):**
   - Service managers must never check `instanceof ConcreteEngine` to call unexposed methods.
   - If a manager needs provider state or cache validation, declare that method directly on the engine interface or a capability interface.

3. **Decouple Engines from UI State (Interface Segregation):**
   - Core engines (`ITranslationEngine`, `IInpaintEngine`, `IBubbleEngine`) must NEVER import or receive `PopupState`.
   - Pass only the specific primitive settings or dedicated config objects required for inference.

4. **Decompose God Files (> 300 Lines):**
   - No new logic may be appended directly into `src/content/index.tsx` or `src/background/index.ts`.
   - When touching these files, extract distinct features (e.g., hover listeners, image replacement, message routing) into dedicated modules under 250 lines.

5. **Parse at the Boundary, Don't Mask with Optional Chaining:**
   - Validate messages and storage payloads once when entering the background/offscreen script.
   - Inside core pipeline services, do not use defensive `?.` or silent `try/catch` fallbacks that swallow corruption; allow unexpected errors to fail fast.

---

## 4. Defensive Coding & Error Boundaries

*   **Impact Analysis / Ripple Effect Check**: After modifying any code, signature, data schema, or state flow, inspect all referencing sites and dependent modules across the codebase to ensure changes do not break other places.
*   **Boundary vs Internal Error Handling**:
    - **Outer Boundaries** (DOM events, Chrome runtime messaging, user inputs, network requests, storage reads): Handle defensively with `try/catch`, null-checks, and graceful error messaging so the extension never crashes the host page.
    - **Internal Algorithmic Core** (geometry math, typesetting reflow, tensor formatting, pipeline orchestrators): Assert preconditions explicitly and fail fast. Never mask internal data corruption with silent empty fallbacks or swallowed errors.
*   **Targeted Logging**: Include `console.log` (for state transitions) and `console.error` (for failures) at critical junctions. Avoid spammy logs in fast loops (like DOM observers).

---

## 5. Documentation

*   For documents like `fullplan.md`, do not summarize or shorten writing; update only to reflect accurate plan information.
*   Check `docs/development/` and `docs/dev-history/` before implementing code to avoid repeating past mistakes. Always update or add devlogs and development docs after implementing new features, architectural shifts, or bug fixes.

---

## 6. Testing Strategy

*   **Backend Over Frontend:** Frontend UI components generally do not require automated unit tests; visual check is sufficient unless logic is complex.
*   **Mandatory Backend Unit Tests:** Backend architecture and core orchestrators (like `TranslationManager` waterfall logic, API fallback chains, and data parsing) MUST have comprehensive unit tests. We must guarantee these systems fail gracefully and handle errors correctly without manual QA.

---

## 7. Skill Activation

*   Always activate `/caveman` and `/ponytail`.
*   Activate `/frontend-design` when implementing, changing, or fixing frontend/UI code.

---

## 8. Cotrans / XianScan / Koharu Porting Strategy

When adapting code or logic from Cotrans (Python), XianScan (Rust), or Koharu to this project (TypeScript), ALWAYS look at the actual reference codebase first. Do not invent custom math or logic if Cotrans already solves it. Both donor repos live in `scratches/reference/`.

Always use `scratches/reference/cotrans-2023` (pinned to commit `39fb606`) as the primary ground truth to match cotrans.touhou.ai. Do not use `scratches/reference/cotrans` (upstream main), as its 2025 updates cause font-size inflation bugs. Only fall back to cotrans for logic missing in the 2023 tree, and explicitly flag it. If missing, recreate with:
`cd scratches/reference/cotrans && git worktree add ../cotrans-2023 39fb606`

Follow these mapping rules:
*   **Pure Math -> Pure Math:** If Cotrans uses pure math (geometry, vector logic, polygon scaling), translate it into pure TypeScript math.
*   **Library -> Library:** If Cotrans uses a library (OpenCV, Shapely) and an equivalent/lightweight alternative exists in our stack (`clipper-lib`), use our library. (Warning: Chrome extension CSP forbids dynamic code import, so libraries that import code dynamically like `opencv-js` cannot be used).
*   **Library -> Custom JS:** If Cotrans uses a heavy library function that is missing in our WASM builds or too bloated to import, and is easy to implement efficiently in JS, write custom JS logic from scratch.

---

## 9. Altering Existing Code & Workarounds

When altering, repositioning, or restructuring existing code, keep and migrate explanation docstrings and comments. Only delete docstrings and comments if removing a code block whose logic is completely retired.

### Workarounds & Upstream Library Mitigations
*   **Preserve Existing Workarounds:** Never refactor, simplify, or "clean up" non-standard patterns, weird type casts, or unconventional file handling marked with `WORKAROUND`, `HACK`, or upstream issue links. They exist to bypass library-level bugs.
*   **Reuse Established Workarounds:** When writing new code touching the same external library or function, apply existing workaround patterns instead of standard approaches known to fail.
*   **Documenting New Workarounds:** If a non-obvious workaround is required:
    1. Add inline comment: `# WORKAROUND: [Explain upstream failure] -> [Why this weird approach works]`.
    2. Document root cause and affected modules in `docs/development/workarounds.md` or corresponding devlog.

### Key Architectural Invariants & Reference Links
Complete technical documentation and rationale for all mitigations live in `docs/development/workarounds.md`:

*   **Vite 8 & CRXJS 2.7.1**: Keep `build.rollupOptions` (do not rename to `rolldownOptions`), retain explicit `optimizeDeps.entries`, exclude native packages (`ppu-paddle-ocr`, `canvas`, `onnxruntime-node`), and keep mode-aware minification. Specs: `docs/development/workarounds.md#1-vite-8--crxjs-271-build-configuration` · `vite.config.ts` · Devlog 013.
*   **Runtime Messaging & WebGPU**: Explicitly address offscreen RPCs (`target: 'background'`, `source`, `request: true`). Serialize popup writes sequentially and normalize at background boundary. Probe WebGPU only offscreen with high performance. Specs: `docs/development/workarounds.md#2-chrome-extension-runtime-messaging-popup-state-and-webgpu-invariants` · Devlog 015.
*   **SPA Image Replacement**: Always clear `srcset` when updating `src`, convert base64 to same-origin blob URLs, and attach reversion shields with `isSelfMutating` flag against SPA re-renders. Specs: `docs/development/workarounds.md#3-spa--responsive-image-replacement-strategy-xianscan-reference-pattern` · `src/content/index.tsx` · Devlog 014.
*   **Neural Inpainting Architecture**: Always inpaint localized patches snapped to 64px buckets; never run full canvas or squish to 512px. Expand polygon masks with $\ge 4$px round stroke (`UNCLIP_RATIO = 1.8`). Specs: `docs/development/workarounds.md#4-neural-inpainting-architecture-lama--xianscan-dynamic-patch-strategy` · `src/offscreen/engines/inpaint/LamaMangaInpaintEngine.ts` · Devlog 016.

---

## 10. Cloudflare Worker Pre-Deploy Testing

Never deploy directly to live production users without pre-verification:
1.  **Isolated Preview Version**: Run `npx wrangler versions upload --cwd worker` to get a private preview URL without affecting live users or production DB.
2.  **Staging Environment**: Use `npx wrangler deploy --env staging --cwd worker` for end-to-end tests against an isolated staging DO SQLite database.
3.  **Production Promotion**: Only after preview/staging passes and tests succeed (`npm --prefix worker test`), deploy to production (`npm --prefix worker run deploy` or `npx wrangler versions deploy`).

---

## 11. Strict Confidentiality & Clean-Room IP Rule

*   **NEVER mention, cite, or name commercial reference extensions, their product names, websites, authors, or external URLs in documentation, devlogs, commit messages, README files, or inline code comments.**
*   Naming commercial reference extensions creates copyright, DMCA, and intellectual property risks when studying public web extensions.
*   Always use neutral, generic technical descriptors instead (e.g. "commercial web extension donor pattern", "standard web reader layout reference", "established scanlation lettering workflows").
