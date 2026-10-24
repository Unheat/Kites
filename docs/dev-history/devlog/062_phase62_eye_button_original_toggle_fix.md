# Phase 62: Hover Eye Button Original/Translated Toggle Fix

### 1. Metadata
* **Date:** 2026-10-24
* **Feature/Task:** Fix eye button original/translated image toggle state synchronization
* **Status:** Completed

---

### 2. The Objective
The hover control bar's eye button (`data-kites-toggle-btn`) failed to restore the translated image upon a second click. While the first click successfully displayed the original artwork, subsequent clicks failed to toggle back to the translated presentation. The goal was to restore seamless, repeatable two-way toggling between the original image and the translated rendering across both button clicks and keyboard shortcuts ('F').

---

### 3. Current Workflow & Implementation Steps

#### Root Cause Analysis
1. **Unpassed Translation Record in Toggle Handlers:**
   - In `TranslateButton.handleToggleOriginal` and shortcut `actions.toggleOriginal`, `toggleImageDisplay(target, nextShowOriginal)` was invoked without passing the registry `record`.
   - Consequently, `record.showOriginal` in `translatedRegistry` remained permanently `false`.
2. **Nullish Coalescing Masking DOM Attribute in MutationObserver:**
   - In `TranslateButton.useEffect`, the attribute `MutationObserver` on `anchorElement` invoked `update()` upon DOM attribute modifications.
   - Inside `update()`, the state reconciliation was written as:
     `setShowOriginal(reg?.showOriginal ?? (anchorElement.getAttribute('data-kites-show-original') === 'true'))`.
   - Because `reg.showOriginal` was initialized to `false`, JavaScript's nullish coalescing operator (`??`) never evaluated the right-hand operand (`false ?? true === false`).
   - As soon as the first click set `data-kites-show-original="true"` on the DOM element, the observer immediately reset React's `showOriginal` state back to `false`.
   - On the second click, `!showOriginal` evaluated to `!false = true` again, so the button repeatedly attempted to display the original image instead of the translated version.
3. **Incomplete Target Image Attribute Synchronization:**
   - In `imageReplacer.ts`, `toggleImageDisplay` modified `data-kites-show-original` on `sourceElement` and `surfaceElement`, but omitted setting or removing it directly on `targetImg`.
   - When restoring the translated view (`showOriginal = false`), `appliedSrc` was only looked up from `sourceElement.getAttribute('data-kites-applied-src') || record?.translatedUrl`, which could fail if `targetImg` was detached from `sourceElement` or if `record` was omitted.

#### Implementation
1. **Synchronize Record State Across Registry and Handlers:**
   - In `TranslateButton.handleToggleOriginal` (`src/content/index.tsx`), fetch `record = translatedRegistry.get(srcUrl)`, update `record.showOriginal = nextShowOriginal`, and pass `record` to `toggleImageDisplay(target, nextShowOriginal, record)`.
   - Added robust target fallback in `handleToggleOriginal` using `createMediaTarget(anchorElement)` if `resolveTargetMedia(srcUrl)` returns null.
   - In `readingShortcutActions.toggleOriginal` (`src/content/index.tsx`), fetch `record`, invert `record.showOriginal`, and pass `record` to `toggleImageDisplay`.
2. **Reconcile Observer State Correctly:**
   - Updated `update()` in `TranslateButton` to evaluate:
     `const domShowOriginal = anchorElement.getAttribute('data-kites-show-original') === 'true' || (anchorElement instanceof HTMLImageElement ? false : anchorElement.querySelector('img')?.getAttribute('data-kites-show-original') === 'true');`
     `setShowOriginal(reg ? Boolean(reg.showOriginal) : domShowOriginal);`
   - Updated `IMAGE_DISPLAY_CHANGED_EVENT` listener to normalize URLs when matching `srcUrl`.
3. **Leaf Module State Synchronization (`src/content/imageReplacer.ts`):**
   - In `toggleImageDisplay`:
     - When `showOriginal = true`: set `data-kites-show-original = 'true'` on `targetImg` as well as `sourceElement` and `surfaceElement`.
     - When `showOriginal = false`: remove `data-kites-show-original` from `targetImg`, `sourceElement`, and `surfaceElement`.
     - Retrieve `appliedSrc` across `sourceElement`, `targetImg`, `surfaceElement`, and `record?.translatedUrl`.
     - Restore `reapplyMediaTargetStyles(targetImg, surfaceElement)` and `suppressParentBackgroundImage(targetImg, surfaceElement)` upon returning to translated view.
   - In `attachReversionShield`: check both `img` and `surfaceElement` for `data-kites-show-original === 'true'` before treating source mutations as host SPA resets.

---

### 4. Roadblocks & Decisions
* **Nullish Coalescing on Booleans:** The `??` operator only falls back when the left operand is `null` or `undefined`. When an object holds a boolean field initialized to `false`, `booleanField ?? fallback` will never trigger the fallback. The fix explicit checks `reg ? Boolean(reg.showOriginal) : domShowOriginal`.
* **Testing Coverage:** Existing integration tests mocked `MutationObserver` with a no-op class, which masked the observer feedback loop during automated runs. We created `src/content/imageReplacer.test.ts` with real DOM elements and expanded `src/content/readingIntegration.test.tsx` to test repeated toggle clicks.

---

### 5. Key Takeaways & Next Steps
* Toggle controls must always update both in-memory registries and DOM state synchronously to prevent observer feedback cancellation.
* All 922 unit tests pass and the production bundle builds cleanly.
