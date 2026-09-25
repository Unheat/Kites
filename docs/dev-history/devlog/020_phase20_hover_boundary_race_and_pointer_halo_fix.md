### Date: 2026-09-25

* **Feature/Task:** Phase 20: Fix Speed-Dependent Hover Dismissal & Subpixel Boundary Halo Race
* **Ticket/Issue:** User reported flaky hover dismissal on images (fast cursor exits hid the translate button, but slow cursor exits left it stuck permanently).
* **Status:** Completed

---

### Objective

Eliminate intermittent "stuck" translate buttons when hovering off images at slow or moderate speeds, while preserving instantaneous button responsiveness and seamless scroll persistence on tall webtoon strips.

---

### Incident & Root Cause Analysis

1. **Chromium Event Coalescing:** Chrome does not emit continuous mouse events; it samples pointer coordinates roughly once per animation frame (~16ms).
2. **Subpixel Tolerance Halo:** Kites' hit-tester (`surfaceContainsPoint`) intentionally grants a `POINTER_TOLERANCE_PX = 3px` buffer so hovering an image's boundary pixel counts as an active target.
3. **The Race Condition:**
   * When exiting an image, the browser emits `mouseout` on the `<img>`, which arms a 150ms dismiss timer (`scheduleHide()`).
   * The cursor immediately enters the parent container element (`div.comic-image-container`), emitting `mouseover` on the container.
   * `resolveHoverMediaTarget` scans descendants (`querySelectorAll('img')`) to find eligible media. Because the pointer is just 1–2px outside the image border, `surfaceContainsPoint` evaluates `true` via the 3px halo!
   * The resolver returns the *same* image target that was just left, triggering `cancelHide()`.
   * **Why Speed Mattered:**
     * **Fast Exit:** The cursor moves $>10\text{px}$ across a single 16ms frame, bypassing the 3px halo before the next event. `cancelHide()` does not fire $\to$ button dismisses normally.
     * **Slow Exit:** The cursor lingers in the 1–3px halo zone across several sampled frames. Every frame emits `mouseover` on the container $\to$ `cancelHide()` repeatedly disarms the timer $\to$ button remains stuck forever.

---

### Implementation Steps

1. **Strict Geometric Leave Detection (`src/content/index.tsx`):**
   * In `handleMouseOver`, check whether the resolved media target matches the currently active surface.
   * If it matches the *same* surface but client coordinates fall strictly outside `element.getBoundingClientRect()` bounds (i.e. inside the 3px tolerance halo), do **not** call `cancelHide()`.
   * Allow the pending dismiss timer to proceed uninterrupted.
2. **Dual-Gate Timer Settlement:**
   * When `scheduleHide()` fires at 150ms, inspect the browser's live `:hover` pseudo-class chain (`surface.matches(':hover') || surface.querySelector(':hover') !== null`) and strict cursor bounds.
   * If the pointer is strictly outside, dismiss immediately (`setActiveImg(null)`).
   * If the browser reports the element is genuinely still hovered (e.g. cursor reversed direction), re-schedule rather than leaving stale state.
3. **Unit & E2E Verification (`src/content/mediaTargets.test.ts`):**
   * Added unit test for point-based resolution and tolerance boundaries.
   * Ran Playwright automated exit matrix at variable step counts (`steps: 4` fast exit, `steps: 60` slow exit, `steps: 60` micro-exit just 2px outside border). Verified both speeds consistently dismiss across multiple test cycles.

---

### Key Takeaways

* **Avoid using hit-test tolerance for exit decisions:** Padding/tolerance halos are helpful when acquiring targets (`mouseenter`/`mouseover`), but harmful when detecting departures (`mouseleave`/`mouseout`).
* **Hardware sampling artifacts can look like logic bugs:** When UI behavior fluctuates based on user gesture speed, look for event coalescing and sampling window races against debounce timers.
