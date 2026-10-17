# Devlog 050: Paginated Gallery Image Replacement & Scope Alignment

### 1. Metadata
* **Date:** 2026-10-17
* **Feature/Task:** Fix Immediate Image Replacement on Paginated Manga/Gallery Readers (nhentai / e-hentai)
* **Branch:** `main`
* **Status:** Completed & E2E Verified

---

### 2. Root Cause Analysis

#### 2.1 The Symptom
On paginated single-page readers such as nhentai (`https://nhentai.net/g/677759/1/`), translating an image caused the translate button to update and display the 3 finished action icons (`<Eye />` toggle, `<Download />`, `<ExternalLink />` edit in studio), but the image on screen remained the untranslated original. The translated image only appeared after the user clicked the Eye toggle button twice. Meanwhile, social media sites like X/Twitter functioned normally.

#### 2.2 Root Cause 1: URL Normalization Mismatch in Content Script Message Dispatch
1. In commit `dfb1c6d`, `translatedRegistry` was updated to resolve chapter scope via canonical `getChapterScopeId(window.location.href)` to enable accumulating translated pages across sequential URL navigations (`/g/677759/1/` $\to$ `/g/677759/`).
2. When an image translation completed, `record.sourcePage` was saved as the normalized root: `https://nhentai.net/g/677759/`.
3. However, in `handleMessage` (`IMAGE_TRANSLATED`), line 2047 checked:
   ```ts
   if (record.sourcePage !== window.location.href || !target) {
     console.warn('[Content Script] Target media element detached or chapter changed; translation archived...');
     return;
   }
   ```
4. On nhentai, `record.sourcePage` was `https://nhentai.net/g/677759/` while `window.location.href` was `https://nhentai.net/g/677759/1/`. The condition `record.sourcePage !== window.location.href` evaluated to `true`, logging the warning and exiting without calling `replaceImageWithTranslation(target, record)`.
5. On X/Twitter (`https://x.com/...`), `getChapterScopeId` leaves the status URL unchanged, so `record.sourcePage === window.location.href`, explaining why X was unaffected.

#### 2.3 Why Double-Clicking the Eye Icon Worked Around the Failure
1. Because `translatedRegistry.complete` had already archived the translation under `getChapterScopeId(window.location.href)`, `translatedRegistry.get(srcUrl)` returned the valid record.
2. `TranslateButton` saw the record and rendered the 3 finished buttons.
3. Clicking the Eye button twice triggered `toggleImageDisplay(target, false)`.
4. Unlike `handleMessage`, `toggleImageDisplay` has no `sourcePage !== window.location.href` guard; it retrieved `record.translatedUrl` from the registry and directly set `targetImg.src = appliedSrc`, finally rendering the translated image.

---

### 3. Architecture & Solutions

#### 3.1 Strict Source-Page URL Isolation Preserved (`window.location.href`)
`getChapterScopeId` was deliberately rejected and discarded to avoid over-including subpages or merging distinct chapters that use numeric URL suffixes (e.g. `/manga/ch1/` and `/ch2/`). Strict `window.location.href` scoping is preserved across:
- `translatedRegistry` (`getSourcePage: () => window.location.href`)
- `chapterExporter` (`getSourcePage: () => window.location.href`)
- `handleMessage` guard (`if (record.sourcePage !== window.location.href || !target)`)
- `BatchScanPanel` export (`sourcePage: item.source === 'page' ? (tab.url || '') : 'history'`)
- `orderChapterImages` (`if (record.sourcePage !== sourcePage || !record.translatedUrl)`)

Because `record.sourcePage` and `window.location.href` are both the exact page URL (`https://nhentai.net/g/677759/1/`), they match on the current page, executing `replaceImageWithTranslation` immediately upon translation completion.

#### 3.2 Auto-Healing & Instant Memory Restoration in `TranslateButton`
Added active auto-healing to `TranslateButton`: when an image is known to be translated in the current session (`translatedRegistry.get(srcUrl)`) and the user has not chosen to view the original (`!showOriginal`), `TranslateButton` verifies whether the DOM element actually displays the translation. If recycled by the host site without Kites attributes, it immediately invokes `replaceImageWithTranslation(target, reg)` to eliminate any potential desync between the action buttons and the displayed image.

#### 3.3 Recycled Element Target Protection
In `resolveTargetMedia`, Tier 1 in-memory lookup now verifies that an `HTMLImageElement` still displays the requested `originalUrl` or our `data-kites-applied-src` before returning it, preventing recycled DOM elements on page turns from receiving mismatched translations.

---

### 4. Verification

1. **Unit Tests (`npm test`)**: All 77 test suites and 784 unit tests passed cleanly (0 regressions). Added dedicated unit test in `src/content/readingIntegration.test.tsx` verifying immediate image replacement on nhentai URLs upon `IMAGE_TRANSLATED`.
2. **Playwright E2E Test (`npm run test:e2e:nhentai`)**: Automated test on live nhentai reader page (`https://nhentai.net/g/688293/1/`) using the real built extension in Chromium:
   - Successfully hovered over page 1 reader image.
   - Clicked Translate button.
   - Verified `data-kites-translated: true` and `src: blob:https://nhentai.net/...` replaced immediately on first pass without touching Eye icon.
   - Verified 3 finished action buttons appeared.
   - Verified Eye toggle restored original artwork and toggled back to translated blob.
