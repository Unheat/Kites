# Devlog 031: Site-Specific Blacklist Toggle and Custom Image Selectors

### 1. Metadata
* **Date:** 2026-10-13
* **Feature/Task:** Site-Specific Domain Enablement (Blacklist) and Custom CSS Image Selectors
* **Branch:** `feat/site-domain-rules`
* **Status:** Completed

---

### 2. Objective
Allow users to easily disable Kites on specific domains with a single click in the popup (e.g. social media, banking, or non-manga sites), while running everywhere by default. Additionally, support custom CSS image selectors per domain (with built-in manga reader container heuristics ported from XianScan) to cleanly target chapter strips and avoid banner ads on tricky reader websites.

---

### 3. Architecture Decisions

#### 3.1 Blacklist Mode as Default
Following donor analysis (Torii and XianScan), manga reader extensions deliver the best UX when running everywhere by default, allowing quick opt-out for problematic domains:
- `disabledDomains: string[]` stored in `PopupState` (`chrome.storage.local`).
- Normalized to unique, lowercase hostnames supporting both exact match (`mangadex.org`) and wildcard subdomains (`*.bato.to`).

#### 3.2 Gatekeeping at Both Content Script and Background
1. **Content Script (`src/content/index.tsx`)**:
   `isDomainDisabled(window.location.hostname, state.disabledDomains)` gates `isEnabled`. When disabled, `GlobalOverlay` unmounts, observers disconnect, and all overlays are dismissed.
2. **Background (`src/background/index.ts`)**:
   `TRANSLATE_IMAGE`, `TRANSLATE_CAPTURED_IMAGE`, and context menu clicks inspect sender tab URL against `disabledDomains` and reject disabled requests with `{ status: 'error', error: 'Extension is disabled on this domain' }`.

#### 3.3 XianScan Container Heuristics & Custom Selector Engine (`src/shared/siteRules.ts`)
- `MANGA_READER_CONTAINER_SELECTORS`: Ported high-priority manga containers (`#readerarea`, `div[class*="reading-content"]`, `div[class*="wt_viewer"]`, etc.).
- `AD_NOISE_CONTAINER_SELECTORS`: Noise containers (`header`, `footer`, `aside`, `nav`, `[class*="sidebar"]`, `[class*="advert"]`, `[class*="banner"]`) are excluded during DOM discovery unless enclosed in a known manga reader area.
- User-configurable `SiteSelectorRule` array enables domain-specific selector overrides (e.g. `#readerarea img`).

---

### 4. Implementation Steps
1. **Types (`src/shared/types.ts`)**: Defined `SiteSelectorRule`, added `disabledDomains` and `siteRules` to `PopupState` and `DEFAULT_POPUP_STATE`.
2. **Utilities (`src/shared/siteRules.ts` & `siteRules.test.ts`)**: Implemented `normalizeDomain`, `isDomainDisabled`, `normalizeDisabledDomains`, `isValidCssSelector`, `normalizeSiteRules`, and `findMatchingSiteRule`.
3. **Background (`src/background/index.ts` & `normalizePopupState.test.ts`)**: Integrated domain and site rules normalization and sender tab gatekeeping.
4. **Content Script (`src/content/index.tsx` & `src/content/mediaTargets.ts`)**: Connected live domain gating, noise container filtering, and custom selector overrides in `discoverMediaTargets`.
5. **Popup UI (`src/popup/index.tsx` & `src/popup/components/SiteRulesPanel.tsx`)**:
   - Added 1-click domain toggle pill below header showing active tab domain with `Disable on site` / `Disabled · Enable` states and `PAUSED` header badge.
   - Added `SiteRulesPanel` in SettingsView with tabs for Disabled Sites and Custom Selectors.

---

### 5. Verification
- `npm test`: **62 test files passed, 633 tests passed** (0 failures).
- `npm run build`: Succeeded in 1.76s (`tsc -b`, `vite build`).
- `npm run lint`: 0 errors.
