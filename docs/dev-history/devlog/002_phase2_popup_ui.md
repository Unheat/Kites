# DevLog 002: Phase 2 - Advanced Popup UI & Model Registry

**Date:** July 2026  
**Focus:** User Interface, State Persistence, DOM Optimization, Search Indexing

## Overview
In Phase 2, we built out the complete popup interface for Kites. Because Kites allows users to select between local WebGPU models, local CPU ONNX models, and custom Cloud APIs, the UI needed to handle massive lists of models without dropping frames, while feeling cohesive and extremely fast.

## Key Features & Implementations

### 1. "Light Table" Dark Mode Theme
Instead of using generic UI toolkits or default browser styling, we designed a custom, highly-tailored "Light Table" dark mode theme inspired by professional illustration and photography software.
*   **Implementation:** Used vanilla CSS variables mapped to a highly specific HSL color palette (e.g., `var(--color-paper)`, `var(--color-ink)`).
*   **Result:** The extension feels premium, focused, and non-distracting when overlayed on top of colorful manga/webtoon pages.

### 2. State Persistence
We needed the extension to remember user configurations instantly.
*   **Implementation:** Built a robust `PopupState` schema backed by `chrome.storage.local`.
*   **Result:** Selected engines, API keys, and toggle states are instantly saved and hydrated upon reopening the popup, providing a seamless user experience.

### 3. Waterfall Fallback Architecture (UI)
Local AI models can sometimes crash due to hardware limitations (e.g., WebGPU Out-Of-Memory errors).
*   **Implementation:** We designed a "Fallback Chain" UI. Users select a primary engine (like an aggressive local 7B model), and then configure a waterfall of fallback models (like a lightweight ONNX model or an OpenAI API key) that the backend will automatically cycle through if a crash occurs.

## Major Optimizations (Resume Highlights)

To handle the integration of WebLLM, we had to load a registry of nearly 100+ LLM variants. Rendering this natively inside a Chrome Extension popup caused severe performance bottlenecks. We implemented two major optimizations:

### 1. Client-Side Search Indexing (MiniSearch)
*   **The Problem:** Standard array `.filter()` searching across hundreds of complex model IDs and metadata strings is slow and unforgiving of typos, leading to a clunky autocomplete experience.
*   **The Solution:** Integrated `minisearch` directly into the `ModelRegistry`. We built an inverted index of all available models.
*   **The Impact:** Achieved sub-millisecond, typo-tolerant autocomplete search results directly inside the extension popup.

### 2. DOM Render Optimization
*   **The Problem:** Rendering hundreds of `<div>` nodes for every model in the registry caused layout thrashing and severe scroll lag inside the constrained Chrome Extension popup window.
*   **The Solution:** Implemented a DOM capping/virtualization strategy. The UI strictly limits rendering to only the top 50 search matches returned by the index.
*   **The Impact:** Scrolling and searching became perfectly smooth at 60FPS, completely eliminating layout thrashing while still allowing the user to find any model instantly via the search bar. 

## Next Steps
With the UI fully capable of capturing the user's primary models, custom APIs, and fallback chains, the next phase focuses on the Backend Service Worker / Offscreen Document. We will implement the actual engine logic that executes the UI's Waterfall strategy.
