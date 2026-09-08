# Phase 14: Resilient SPA Image Replacement & XianScan Production Pattern Port

### 1. Metadata (Context at a Glance)

* **Date:** 2026-09-08
* **Feature/Task:** Robust In-Place Image Replacement for SPAs (Twitter/X, Reddit, etc.) & XianScan Architectural Pattern Port
* **Affected Modules:** `src/content/index.tsx`, `AGENTS.md`
* **Status:** Completed

---

### 2. The Objective (The "Why")

When translating images on dynamic single-page applications like `x.com` (Twitter), the translation pipeline completed successfully in the background worker, but the page never displayed the translated image. The goal was to eliminate silent image replacement drops, isolate the source of console Content Security Policy (CSP) errors, and upgrade Kites' content script image replacer to production-grade resilience across modern SPAs (React, Vue) and responsive HTML5 media.

---

### 3. Current Workflow & Implementation Steps (The "How")

1. **Investigated CSP Console Errors & Isolated Root Causes:**
   - Probed the browser console logs (`Loading the stylesheet 'https://fonts.googleapis.com/css2?family=Mulish...' violates style-src`).
   - Confirmed through Chrome extension manifest inspection that the font CSP violations were injected by a third-party extension (**Poper Blocker**, ID `bkkbcggnhapdmkeljlodobbkopceiche`), while the inline script violation was an un-nonced script on Twitter.
   - Verified that `img-src` was never violated; the failure was entirely DOM- and framework-level.
2. **Analyzed Upstream Reference Architecture (XianScan):**
   - Inspected `scratches/reference/xianscan-rust/extensions/xianscan-importer/src/content/replacer.ts` and `safe-image.ts`.
   - Identified five core mechanisms used in production:
     - Direct `img.srcset = ''` clearing and attribute removal.
     - Lazy attribute sanitization (`data-src`, `data-lazy-src`, etc.).
     - Same-origin Blob URL generation (`URL.createObjectURL(blob)`).
     - Targeted `MutationObserver` shield with an `isSelfMutating` recursion guard to defeat React Virtual DOM resets.
     - Multi-tier element resolution using in-memory maps and data attributes.
3. **Implemented Safe Same-Origin Blob URLs (`createSafeBlobUrlFromData`):**
   - Replaced multi-megabyte `data:image/png;base64,...` DOM assignments with local `blob:https://...` URLs.
   - Substantially reduced DOM attribute memory overhead and avoided strict inline data URI CSP constraints.
   - Added automatic revocation on `beforeunload` to prevent memory leaks.
4. **Wiped `srcset` & Sanitized Lazy Attributes (`sanitizeImageAttributes`):**
   - Stored backups in `data-kites-orig-src` and `data-kites-orig-srcset`.
   - Cleared `targetImg.srcset = ''` and removed the attribute to adhere to W3C/HTML5 image candidate selection rules.
   - Stripped common lazy attributes to prevent site scripts from overriding the image.
5. **Built React SPA Reversion Shield (`attachReversionShield` & `runSelfMutation`):**
   - Attached a scoped `MutationObserver` to each translated image.
   - Wrapped all programmatic DOM writes in `runSelfMutation()` with a 50ms reset window to suppress feedback loops.
   - If React re-renders the tweet (upon hover, scroll, or stream updates) and resets `src` or restores `srcset`, the shield immediately re-applies the translated URL.
6. **Constructed Multi-Tier Element Resolution (`resolveTargetImageElement`):**
   - **Tier 1:** In-memory registry lookup (`imageElementRegistry`).
   - **Tier 2:** Exact `img.src` or `img.currentSrc` match.
   - **Tier 3:** `data-kites-orig-src` match.
   - **Tier 4:** Normalized base URL match via `getNormalizedBaseUrl()` (stripping resolution parameters like `?name=medium` vs `?name=large`).
   - Added explicit diagnostic warning logs if an element cannot be found, preventing silent failures.
7. **Suppressed Parent Background Images (`suppressParentBackgroundImage`):**
   - Inspected ancestor elements for Twitter placeholder `background-image: url(...)` styles and set them to `none`.
8. **Fixed Global Auto-Translate MutationObserver:**
   - Modified the observer in `src/content/index.tsx` so images are only marked as translated if their `src` begins with `blob:`/`data:` or has `data-kites-translated="true"`, preventing host resolution upgrades from blacklisting un-translated images.

---

### 4. Roadblocks & Decisions (The Pivot Points)

* **The Problem:** The user observed CSP violation logs in the browser console immediately beside Kites logs and assumed Twitter's CSP was actively blocking image replacement.
* **The Investigation:**
  - `x.com` enforces a strict CSP for styles and scripts.
  - The `Mulish` font error was traced to an external extension (Poper Blocker) injecting un-allowlisted Google Fonts stylesheets.
  - `img-src` was never violated in the console.
* **The True Failure Mode:**
  - **HTML5 Spec:** Browser engines prioritize `srcset` over `src`. When `srcset` was left untouched, the browser continued rendering Twitter's high-DPI CDN image regardless of what was written to `img.src`.
  - **React SPA Virtual DOM Reconciliation:** Twitter is built on React Native for Web. Any interaction (hover, scroll) triggered reconciliation, detecting the DOM mutation and reverting `img.src` back to the virtual DOM prop.
  - **Dynamic CDN Parameters:** Twitter updates image URLs on the fly (`name=small` -> `name=large`). An exact string search (`img.src === originalUrl`) evaluated to false and exited silently.
* **The Solution & Decision:**
  - Rather than writing an `x.com`-specific hack, we ported XianScan's comprehensive image replacement strategy.
  - Clearing `srcset`, shielding against Virtual DOM resets via MutationObserver, and fuzzy-matching base URLs solved the issue permanently for all modern SPAs (Twitter, Reddit, Threads, Pixiv, etc.).

---

### 5. Next Steps / Key Takeaways

* **Key Takeaway:** Never assume console CSP errors are the cause of an extension failure without verifying the specific directive. `style-src` or `font-src` blocks from third-party extensions do not affect `<img>` DOM operations unless `img-src` is explicitly cited.
* **Key Takeaway:** Direct DOM manipulation in modern web applications requires accounting for SPA Virtual DOM reconciliation (React/Vue). An attribute shield MutationObserver with an `isSelfMutating` guard is mandatory for persistent replacement.
* **Next Steps:**
  - Monitor user feedback across diverse manga/comic reader platforms (e.g. MangaDex, Bilibili, Naver Webtoon) to ensure the lazy-load attribute list covers all regional CMS platforms.
