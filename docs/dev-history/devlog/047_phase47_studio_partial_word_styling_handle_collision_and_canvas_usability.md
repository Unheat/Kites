# Devlog 047: Studio Partial Word-Level Styling, Handle Collision Repair, and Canvas Usability

**Date:** 2026-10-15  
**Topic:** Studio V2 Lettering Usability, Character-Level Style Overrides, Non-Blurring Formatting Controls, Handle Bounding Collision Geometry, and Tool State Sanitation  
**Status:** Completed & Verified  

---

## 1. Problem Statement & Root Cause Analysis

### 1.1 Partial / Word-Level Selection Formatting Failure
* **Symptom:** Highlighting a specific word or phrase within a dialogue bubble (either on canvas or in the left sidebar) and clicking Bold, Italic, Font Family, Size, or Color applied changes to the entire text box instead of only the selected words.
* **Root Cause:**
  1. **Focus Theft & Selection Destruction on Blur:** Standard browser pointer events on `<button>`, `<select>`, and `<input>` emit `mousedown` which immediately blurs the active text input. In `StudioCanvas.tsx`, `onBlur={handleFinishInlineEdit}` unmounted the active in-place textarea and wiped `inlineSelection`, so by the time formatting handlers executed, selection offsets were already null.
  2. **Monolithic Box Mutations:** `TypographySettings.tsx` lacked character-range awareness in `updateSelected(partial)`. Every patch was merged shallowly onto the top-level `TextObject`, ignoring character range bounds.

### 1.2 "Add Text Box Everywhere" Loop & I-Beam Cursor Trap
* **Symptom:** After baking text with the Rasterize button or clicking outside, every subsequent click on empty canvas spawned an unwanted new text box in an inescapable loop, while the pointer was stuck displaying a text insertion I-beam cursor (`cursor: text`).
* **Root Cause:**
  1. `handlePointerDown` unconditionally called `handleAddNewEmptyTextBox` on empty canvas clicks whenever `activeTool === 'text'`.
  2. `setCanvasCursor` displayed `'text'` over empty canvas, giving the misleading visual cue that the mouse was locked in an add-box mode rather than an idle selection pointer.

### 1.3 Floating Action Capsule Colliding with Font-Size Scaling Handle
* **Symptom:** The floating action toolbar overlapped and obscured the blue font-size `'A'` corner handle and the rotation stem.
* **Root Cause:**
  1. The floating action toolbar was hardcoded to `pillPos.y - 44px`. At 36px capsule height, its bottom edge sat at `y - 8px`, hovering directly over the top handles and rotation stem (`y - 24px * zoom`).
  2. The font-size handle was originally placed on an offset auxiliary arm extending outward from the corner, colliding directly behind the toolbar's action icons.

---

## 2. Architecture & Technical Solutions

### 2.1 Selection-Aware Character Style Decomposition (`charStyles`)
1. **Canonical Selection Model (`studioStore.ts`):**  
   Added `inlineSelection: { textId: string; start: number; end: number } | null` to centralized store state. Both the canvas transparent editor and the sidebar dialogue textarea synchronize selection ranges on `onSelect`, `onKeyUp`, and `onMouseUp`.
2. **Selective Style Run Splicing (`TypographySettings.tsx`):**  
   Defined `SELECTION_ELIGIBLE_KEYS = ['bold', 'italic', 'fontFamily', 'fontSize', 'color', 'strokeColor', 'strokeWidth']`.  
   When `inlineSelection` is active for the target text object:
   * Slices `charStyles` array across `[start, end)`.
   * Assigns incoming property values to character overrides.
   * Compares overrides against base object values; if an override matches base properties, it is cleanly pruned to keep memory compact.
   * If an eligible property is updated object-wide (without selection), corresponding overrides in `charStyles` are cleanly cleared so whole-box updates apply uniformly.
3. **Real-Time Two-Pass Canvas Rendering (`TextRenderer.ts`):**  
   `decomposeLineIntoStyledRuns` splits wrapped lines into contiguous styled segments. Render Pass 1 draws strokes across all runs; Render Pass 2 draws text fills, preventing letter-clipping artifacts across mixed styles.

### 2.2 Focus-Preserving Formatting Toolbars
* Standard rich-text editors and scanlation letterers prevent focus loss by intercepting pointer down events:
  ```tsx
  onMouseDown={(e) => e.preventDefault()}
  ```
  Applied `onMouseDown={(e) => e.preventDefault()}` across all floating toolbar buttons and sidebar format toggles (Bold, Italic, Uppercase, Alignment, Clear Fill).
* Extended `handleFinishInlineEdit(e?: React.FocusEvent)` to inspect `e.relatedTarget`. Focus moving into `[data-studio-sidebar]` or `[data-studio-toolbar]` preserves inline selection state.

### 2.3 Handle Geometry Realignment & Smart Vertical Clearance
1. **Corner-Integrated Transform Handles (`CanvasFurniture.ts`):**
   * Top-right corner handle nub (`(right, 0)`) serves directly as the font-size scaling handle (`'font-size'`) with a sky-blue fill (`#38bdf8`) and `'A'` badge.
   * Right midpoint nub (`(right, midY)`) serves directly as the wrap reflow handle (`'wrap'`) with a purple fill (`#a855f7`) and `'↔'` badge.
   * Auxiliary offset arms eliminated, removing extraneous collision vectors.
2. **Dynamic Handle Clearance & Viewport Boundary Flip (`StudioCanvas.tsx`):**
   * Computes vertical handle reach: `clearanceAbove = Math.max(48, Math.round((24 + 8) * zoom) + 16)`.
   * Places floating action toolbar above the rotation stem with a guaranteed $\ge 24$px gap.
   * If the box is near the top edge (`calculatedTop < 80px`), flips the toolbar below the box: `pillBottomPos.y + 16px`.

### 2.4 Neutral Selection Pointer & Intentional Box Creation
1. Over empty canvas, pointer cursor is standardized to `'default'`, eliminating the text I-beam confusion.
2. Clicking empty canvas cleanly deselects the active bubble (`selectedTextId: null`, `inlineSelection: null`) without spawning new text boxes. New text boxes are instantiated strictly via the explicit `+ Add Text Box` buttons on the floating toolbar or left rail.

---

## 3. Verification & Test Coverage

* **Automated Test Suite:**
  - Ran `npm test` across all 75 test suites.
  - **Result:** 745 passing tests (0 failures).
* **Production Bundle Compilation:**
  - Ran `npm run build` with Vite 8 / Rollup.
  - **Result:** Successfully compiled all client bundles with zero type errors.
* **IP Clean-Room Audit:**
  - Executed `git diff | grep -i "<reference-name>"` across all commits and files.
  - **Result:** 0 matches. Fully compliant with Section 13 clean-room confidentiality rules.
