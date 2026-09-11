# Coding Standards & Architectural Invariants 🛡️

When contributing to Kites, please adhere to these core coding principles, performance invariants, and established library workarounds.

---

## 🏛️ 1. Code Quality & Architectural Principles

### Mandatory Docstrings
Every function, class, and interface must include a clear JSDoc comment describing its purpose, inputs, outputs, and any edge-case considerations:
```typescript
/**
 * Clusters text line polygons into speech bubbles using Kruskal's MST.
 * 
 * @param lines Array of detected line bounding polygons.
 * @param options Geometric tolerance factors and font size ratios.
 * @returns Array of grouped text block clusters in natural reading order.
 */
export function clusterLinesWithMST(lines: LinePolygon[], options: ClusterOptions): TextBlock[] { ... }
```

### No Magic Numbers
Extract magic numbers (thresholds, aspect ratios, timeouts, padding) into named constants at the top of the file with explanatory comments:
```typescript
/** Maximum edge weight multiplier before splitting an MST speech balloon cluster. */
const MST_MAX_EDGE_SIGMA_MULTIPLIER = 2.0;

/** Bounding box expansion ratio to ensure anti-aliased character edges are removed. */
const INPAINT_MASK_STROKE_WIDTH = 4;
```

### Defensive Programming & Targeted Logging
- Assume network requests can fail, DOM nodes may be mutated or unmounted by SPAs, and WebGPU devices may be lost.
- Always wrap external API calls and hardware access in `try/catch` blocks with graceful fallbacks.
- Include structured logging at critical junctions:
  - `console.log('[OcrManager] Model initialized with WebGPU provider')`
  - `console.error('[TranslationManager] Waterfall fallback triggered:', err)`
  - Avoid spamming logs in tight loops (such as pixel traversal or DOM mutation observers).

---

## ⚡ 2. WebGPU & Neural Pipeline Invariants

### Dynamic 64px Patch Bucketing (Zero-Resizing Invariant)
- **Do not pass full-page scans into neural inpainters:** Running FFC convolutions across untouched backgrounds wastes 90% of GPU compute and takes 10+ seconds.
- **Crop tightly around bubbles:** Snap patch widths and heights to multiples of 64 ($\lceil\text{dim} / 64\rceil \times 64$). This prevents GPU driver shader recompilation stalls.
- **Never squish and upscale:** Never resize bounding boxes down to 512×512 and upscale them back with bilinear interpolation. Maintain strict 1:1 pixel coordinates between the crop and paste buffers.

### Polygon-Strict Inpainting Contract
- Neural inpainters must receive **character contour polygon masks only**, never rectangular speech bubble boxes.
- Always draw polygon masks with `lineWidth = 4` stroke expansion (`lineJoin = 'round'`, `lineCap = 'round'`) and keep `UNCLIP_RATIO = 1.8`. Drawing unexpanded raw polygons leaves dirty "crumbs" of kanji radicals.

### WebGPU Adapter Probing
- Only the **offscreen document** context may probe WebGPU.
- Always request `powerPreference: 'high-performance'`. Software/low-power fallback adapters will freeze LaMa neural execution.

---

## 🌐 3. Chrome Extension & DOM Invariants

### Explicit RPC Message Addressing
`chrome.runtime.sendMessage()` broadcasts across all extension contexts. To prevent dropped messages and port closures:
- Popup / Dashboard requests must specify: `{ target: 'background', source: 'popup', request: true }`.
- Background forwards requests to offscreen using: `{ target: 'offscreen', source: 'background', request: true }`.
- Offscreen listeners must ignore messages that do not match these routing markers.

### SPA & Responsive Image Replacement Strategy
When replacing comic panels in modern SPAs (Twitter/X, Reddit, MangaDex):
1. **Always wipe `srcset`:** Modern browsers prioritize `srcset` candidates over `src`. Back up `data-kites-orig-srcset`, set `img.srcset = ''`, and call `img.removeAttribute('srcset')`.
2. **Convert Base64 to Blob URLs:** Never assign multi-megabyte `data:image/png;base64,...` strings directly to `img.src`. Use `URL.createObjectURL(blob)`.
3. **Use `isSelfMutating` Flags:** When programmatically updating image attributes, wrap updates in `runSelfMutation(() => { ... })` to prevent infinite mutation observer triggers.
4. **Attach Reversion Shield:** Attach a targeted `MutationObserver` that restores the translated image if the SPA re-renders or updates virtual DOM props.

---

## 🔧 4. Preserving Upstream Library Workarounds

Never refactor, simplify, or delete patterns marked with `# WORKAROUND` or `// WORKAROUND`:

- **Vite 8 + CRXJS 2.7.1 (`vite.config.ts`):** Keep `build.rollupOptions` (do not rename to `build.rolldownOptions`). CRXJS 2.7.1 reads the raw `build.rollupOptions` key to discover extra HTML entry points (`src/offscreen/offscreen.html`).
- **Explicit `optimizeDeps.entries`:** Keep all Kites entry points listed in `optimizeDeps.entries` to prevent cold-start dependency re-optimization during service worker registration.
- **Native Package Exclusions:** Keep Node/native packages (`ppu-paddle-ocr`, `@napi-rs/canvas`, `canvas`, `onnxruntime-node`) in both `optimizeDeps.exclude` and `rollupOptions.external` so Rolldown does not attempt to bundle native binary modules into the extension.
