# Devlog 032: Distraction-Free Chapter Reader Mode

### 1. Metadata
* **Date:** 2026-10-13
* **Feature/Task:** Distraction-Free Chapter Reader Mode & Scrollbar Layout Fix
* **Branch:** `feat/chapter-reader-mode`
* **Status:** Completed

---

### 2. Objective
Provide a clean, distraction-free full-screen reading experience for translated manga and webtoon chapters, collecting all translated pages from the in-memory registry (`translatedRegistry`) into an in-page modal without ads, popups, or host site clutter. Additionally, resolve Chrome extension popup scrollbar track layout gaps when content exceeds 600px.

---

### 3. Architecture Decisions

#### 3.1 In-Page Modal vs New Extension Tab
- **Zero data transfer overhead**: Instead of serializing megabytes of images across IPC into a new extension tab, `ChapterReaderModal` mounts into `#kites-global-overlay` in the content script and renders same-origin blob URLs directly from `translatedRegistry`.
- **Scroll restoration & body lock**: Body overflow is locked (`document.body.style.overflow = 'hidden'`) while the reader is open and restored immediately on close, preserving the user's exact in-page reading position.

#### 3.2 View Modes & Reading Navigation
- **Webtoon (Continuous Vertical)**: Zero-gap vertical strip ideal for manhwa and webtoon stitched panels. Supports width presets (`md`: 672px, `lg`: 896px, `full`: 100vw).
- **Single Page**: Centered large panel with click-zone and keyboard arrow navigation.
- **Double Spread**: Side-by-side spread with Right-to-Left (RTL) manga reading order toggle.
- **Artwork Flip (`F` key)**: Flips all pages in the reader between translated output and raw original images.
- **Direct ZIP Download**: Triggers chapter ZIP export directly from the reader header bar.

#### 3.3 Three Independent Launch Channels
1. **Popup Footer**: `ReaderLaunchControl` renders `"Open Chapter Reader"` right above ZIP download when translated pages exist on the active tab.
2. **In-Page Floating Pill**: `ChapterReaderFloatingPill` docks unobtrusively at the bottom-right when 2+ translated pages exist, fading to 30% opacity during page scroll.
3. **Keyboard Shortcut**: `Alt+Shift+R` registered in `manifest.json` and routed through `readingCommands.ts`.

#### 3.4 Popup Scrollbar & Gap Bugfix
- When `SettingsView` content exceeded 600px, native Chrome popup scrollbar track had `background: transparent` and unstyled `body`, exposing a white-grey gap on the right.
- Fixed by applying `kites-extension-page` class to `body`, setting `::-webkit-scrollbar-track` to `var(--color-paper)`, configuring `scrollbar-color`, and expanding root container to `w-full min-h-full`.

---

### 4. Implementation Steps
1. **Modal Component (`src/content/ChapterReaderModal.tsx` & `.test.tsx`)**: Fullscreen modal with Webtoon, Single, and Double spread modes, keyboard shortcuts (`Esc`, `F`, `W`, arrows), and scroll-position page tracking.
2. **Floating Pill (`src/content/ChapterReaderFloatingPill.tsx` & `.test.tsx`)**: Bottom-right floating badge with scroll fade and dismiss button.
3. **Popup Launch (`src/popup/components/ReaderLaunchControl.tsx` & `.test.tsx`)**: Status-polling button in popup footer.
4. **Commands & Integration (`manifest.json`, `src/background/readingCommands.ts`, `src/content/index.tsx`)**: Added `open-chapter-reader` shortcut, `OPEN_CHAPTER_READER` message routing, and `kites-open-chapter-reader` custom event.
5. **Scrollbar Fix (`popup.html`, `src/index.css`, `src/popup/index.tsx`)**: Styled popup body and scrollbar track to blend seamlessly with theme colors.

---

### 5. Verification
- `npm test`: **65 test files passed, 642 tests passed** (0 failures).
- `npm run build`: Succeeded in 1.76s (`tsc -b`, `vite build`).
- `npm run lint`: 0 errors.
- Visual inspection via in-app browser: Verified modal render, Webtoon continuous stream, Single page mode, and seamless scrollbar layout.
