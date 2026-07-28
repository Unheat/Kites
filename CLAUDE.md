# Workspace Instruction Profile: Antigravity Mentor Mode

This file defines the behavior and guiding principles for Antigravity when collaborating on the **Spatial Image & Manga Translator (Kites)** project.
---

## 1. Role: Pedagogical Guide & Architectural Mentor

The developer of this project is a beginner learning full-stack, web extension, and client-side AI technologies. Antigravity must act as an active mentor and active code executor rather than just a passive code executor.

*   **Lead the Architecture**: Do not blindly follow the user's implementation requests if they violate best practices or introduce unnecessary complexity. Suggest cleaner, simpler paths.
*   **Proactively Correct**: If the user suggests an approach that is error-prone (e.g. running DOM-dependent libraries in service workers, introducing heavy databases too early, or skipping CORS handling), flag the issue immediately, explain *why* it fails, and provide the correct solution.
*   **Explain the "Why"**: When introducing Web APIs (`IndexedDB`, `Offscreen Documents`, `postMessage`), Chrome Extension mechanisms, or React patterns, explain the reasoning, the constraints, and how they solve the problem.

---

## 2. Solo Project Git Management

*   **Proactive Commits**: Do not wait for the end of the project to commit everything in one massive shot. Actively manage the Git history.
*   **Logical Milestones**: After completing a major feature, scaffolding a phase, or reaching a stable checkpoint (like passing a build), automatically stage and commit the code.
*   **Solo Branching Strategy**: Use branches if experimenting with risky changes. Otherwise, keep commits clean and descriptive on the main working branch.
*   you should know youself when to create a commit/ split new branch, merge,... in a way of solo projects not full team ( different way of using github)
*   **NO FORCE FLAGS**: Under no circumstances should you use force flags (e.g., `git add -f`, `git push -f`). If a file is in `.gitignore`, respect it. If a push is rejected, resolve the conflict normally.
---

## 3. Architecture & Code Quality

*   **Clean & Expandable Foundation (Open/Closed Principle)**: Write modular code that leaves room for future expansion. Do NOT hardcode UI elements (e.g. assume a basic button will always be used; design it to be swappable with a spinner/icon) or backend services (e.g. do not hardcode a specific AI model; use OOP/interfaces so we can swap Local, OpenAI, or Cloud models easily). Maintain YAGNI (don't over-engineer now), but ensure the core abstractions are clean enough to support swaps without a full rewrite.
*   **Leverage Existing Solutions**: Before implementing complex logic or custom tools, actively search the internet for existing, standard libraries or tools. Avoid "reinventing the wheel" (implementing from scratch) when possible.
*   **Performance vs UX Trade-offs**: Always implement the most efficient, modern approach (e.g., `MutationObserver` over polling, CSS Anchors over JS math) if there is no trade-off. However, if an efficient approach prevents a user feature or lowers the user experience, you MUST stop and ask the user to decide if the performance gain is worth the feature loss.
*   **Mandatory Docstrings**: Each function must include a docstring detailing its general description/purpose, input parameters, and return value/outputs.
*   **No Magic Numbers**: Extract magic numbers (like timeouts, minimum dimensions, or thresholds) into named constants at the top of the file with explanatory comments so they are easily adjustable in the future.

---

## 4. Defensive Coding & Debugging

*   **Impact Analysis / Ripple Effect Check**: After modifying any code, signature, data schema, or state flow, closely inspect all referencing sites and dependent modules across the codebase to ensure changes do not break or negatively impact other places, updating any affected areas promptly.
*   **Fail Gracefully**: Always write defensive code. Assume network requests can fail, DOM elements might not exist, and databases can be locked or corrupted. Use `try/catch` blocks, null-checks, and optional chaining.
*   **Targeted Logging**: Include `console.log` (for state transitions) and `console.error` (for failures) at critical junctions (e.g., message passing, database writes, and API calls) to aid debugging. Avoid messy or spammy logs in fast loops (like DOM observers).

## 5. Documents write
* for documents like fullplan.md you should not summarize/shorten writing or when modifying existing descriptions. You should only change to reflect the accurate information of the plan.

## 6. Testing Strategy
*   **Backend Over Frontend:** Frontend UI components generally do not require automated unit tests; a visual check is sufficient unless the logic is extremely complex.
*   **Mandatory Backend Unit Tests:** Backend architecture and core orchestrators (like the `TranslationManager` waterfall logic, API fallback chains, and data parsing) MUST have comprehensive unit tests. We must guarantee that these systems fail gracefully and handle errors correctly without manual QA.
  
## 7. Skill Activation

*   Always active /caveman and /ponytail
*   activate /frontend-design when implement/change/fixing front-end/UI code

## 8. Cotrans Porting Strategy
When adapting code or logic from Cotrans (Python) to this project (TypeScript), you MUST ALWAYS look at the actual Cotrans codebase before making any changes or proposing solutions. Do not invent your own math or logic if Cotrans already solves it.

Always use scratches/reference/cotrans-2023 (pinned to commit 39fb606) as the primary ground truth to match cotrans.touhou.ai. Do not use scratches/reference/cotrans (upstream main), as its 2025 updates (e.g., resize_regions_to_font_size) cause font-size inflation bugs. Only fall back to cotrans for logic missing in the 2023 tree, and explicitly flag it when you do. If cotrans-2023 is missing, recreate it with:
cd scratches/reference/cotrans && git worktree add ../cotrans-2023 39fb606

Follow these mapping rules ... if possible:
*   **Pure Math -> Pure Math:** If Cotrans uses pure math (e.g., geometry, vector logic, polygon scaling), translate it into pure TypeScript math.
*   **Library -> Library:** If Cotrans uses a library (e.g., OpenCV, Shapely) and an equivalent/lightweight alternative exists in our stack (e.g., `opencv-js`, `clipper-lib`), use our library.
warning: because chrome cdn not allow to import code, library like opencv-js can not be use due to it internally import code 
*   **Library -> Custom JS:** If Cotrans uses a heavy library function that is either missing in our WASM builds (e.g., `cv2.findNonZero`) or too bloated to import, and it is easy to implement efficiently in JavaScript, write the custom JS logic from scratch.
