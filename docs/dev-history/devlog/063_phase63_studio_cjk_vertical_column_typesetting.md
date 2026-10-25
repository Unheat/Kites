# Devlog 063: Studio CJK Vertical Column Typesetting & RTL Layout

### 1. Metadata
* **Date:** 2026-10-24
* **Feature/Task:** Studio CJK Vertical Layout & Centered Column Typesetting
* **Status:** Completed

---

### 2. Objective
Fix Studio visual layout breakage when "CJK Vertical Layout" is enabled. Previously, the horizontal layout engine wrapped lines based on container width and passed them to `renderVertical`, which treated horizontal wrap lines as vertical columns. This caused single-character horizontal blowout across bubbles. The goal was to implement true vertical column wrapping based on height, center right-to-left column progression inside bounding boxes, and expand vertical Unicode punctuation mapping.

---

### 3. Implementation Steps

1. **Vertical Wrapping Engine (`src/studio/canvas/studioTypeset.ts`)**:
   - Implemented `wrapVerticalColumns`: measures vertical advance capacity per column based on height and line spacing:
     $$\text{charsPerCol} = \max\left(1, \left\lfloor\frac{\text{height} - 8}{\text{fontSize} \times \text{lineSpacing}}\right\rfloor\right)$$
   - Implemented `wrapVerticalTypeset`: in `'balloon'` mode, dynamically fits font size so all wrapped columns fit within container bounds; in `'simple'` mode, wraps columns at the user's fixed font size.
   - Script Gating: `recalculateBlockTypeset` checks `style.isVertical && CJK_CHARACTER_REGEX.test(text)`. Latin-only text (English, Vietnamese) safely falls back to standard horizontal layout, preserving 100% behavior parity for non-CJK text.

2. **Centered RTL Column Renderer (`src/studio/canvas/TextRenderer.ts`)**:
   - Replaced fixed right-edge calculation with centered column group alignment:
     $$\text{startX} = \frac{\text{obj.width} + \text{totalColsWidth}}{2} - \frac{\text{colWidth}}{2}$$
   - Steps columns leftward ($\text{colX} = \text{startX} - i \times \text{colWidth}$) and centers characters vertically within container height.
   - Expanded `VERTICAL_ROTATION_MAP` with complete Unicode vertical presentation forms (`\ufe31`, `\ufe19`, `\ufe41`, `\ufe42`, `\ufe12`, `\ufe11`, `\ufe15`, `\ufe16`).

3. **In-Place Editor Overlay (`src/studio/canvas/StudioCanvas.tsx`)**:
   - Updated the textarea `value` in vertical mode to use raw `editingObj.text` instead of `lines.join('\n')`, avoiding baking temporary column line breaks into the underlying dialogue model.

4. **Testing & Verification**:
   - Added unit test suite in `studioTypeset.test.ts` verifying height wrapping, CJK script gating, font-size fitting, and manual column breaks.
   - Added unit test suite in `TextRenderer.test.ts` verifying centered RTL column coordinates and vertical Unicode punctuation mapping.
   - Ran complete repository test suite (929 passing tests) and verified production bundle build.

---

### 4. Roadblocks & Decisions
* **Horizontal Wrapper Mismatch**: Early implementations relied on horizontal line breaks to populate vertical columns. Following donor patterns (Torii & Koharu), wrapping must be driven by the inline progression axis (height in vertical layout).
* **Script Gating Rule**: Retained Koharu's script-gating principle: when a user enables vertical layout but the text contains only Latin alphabet, force horizontal layout. Stacking Latin letters vertically down narrow columns produces unreadable scanlation dialogue.

---

### 5. Next Steps / Key Takeaways
* Vertical CJK typesetting now behaves symmetrically to horizontal typesetting in Studio, automatically fitting font size and centering columns.
* Worktree branch `feat/studio-cjk-vertical-layout` is clean and ready for user inspection or pull request.
