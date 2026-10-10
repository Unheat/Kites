# Architecture & Implementation Plan: Speech Bubble Detection, Dynamic Expansion & Intelligent Typesetting

**Document Status:** APPROVED / IN-PROGRESS  
**Target Milestone:** Phase 23+ (Post-v1.1.1)  
**Target Module:** `src/offscreen/`, `src/shared/`, `src/popup/`  
**Author:** Antigravity / ZCode  
**Ground Truth References:**  
- `scratches/reference/xianscan-rust` (ArbenApura/xianscan-rust)
  - `src/pipeline/region_builder/builder.rs` (Container association & orphan rescue)
  - `src/pipeline/region_builder/clustering.rs` (Utterance clustering & vertical lobe splitting)
  - `src/pipeline/region_builder/expansion.rs` (Carrier derivation, safe core inset, damped slack expansion)
  - `src/pipeline/region_builder/geometry.rs` (Morphological carrier extraction & disk opening)
  - `web/src/lib/server/typeset/layout.ts` (Balanced wrap & multi-pass font fitting)
- `scratches/reference/cotrans-2023` (commit `39fb606`)

---

## 1. Executive Summary & Problem Statement

### 1.1 The Current Problem in Kites (Pure Cotrans Bottom-Up)
Currently, Kites determines text block geometry solely through a **Bottom-Up Minimum Spanning Tree (MST)** line clustering algorithm (`OcrManager.ts` / Cotrans `quadrilateral_can_merge_region`). The merged bounding box tightly hugs the original source text lines (e.g. narrow vertical Japanese/Chinese columns measuring 20–30px wide).

While this works adequately when original text spans wide areas, it triggers severe failure modes in common comic layouts:
1. **Font Size Collapse (Teo chữ):** Translated English/Vietnamese sentences require $1.5\times - 2.5\times$ more horizontal width than compact CJK characters. Because the merged box is locked to the narrow CJK column width, the layout engine (`typesetLayout.ts`) is forced to wrap text after every 1–2 words, driving font sizes down to an unreadable 5–7px despite vast empty white space inside the balloon.
2. **Optical Decentering (Lệch tâm quang học):** Original CJK text is frequently positioned off-center (closer to the top or side of a speech balloon). The typesetter centers translated text within the narrow OCR box rather than the visual center of the balloon chamber, producing awkward, off-balance layouts.
3. **Orphan Punctuation & Sub-column Fragmentation:** Expressive comic punctuation (`!!`, `!?`, `...`) positioned below or adjacent to vertical dialogue columns often exceeds the distance threshold of the merge graph, leaving it dropped or rendered as an isolated orphan box.
4. **Staggered Multi-Utterance Balloon Collisions (Bong bóng đôi giật cấp):** When two distinct dialogue utterances share a connected or staggered balloon, Cotrans MST either erroneously fuses them into a single giant box (spanning over artwork panels) or places them in separate boxes that collide when translated.

### 1.2 The Proposed Solution: Dual-Route Hybrid Architecture
We introduce a **dual-route hybrid layout engine**:
- **Dialogue inside Speech Balloons:** Handled by a **Top-Down Bubble Container Pipeline** (ported and enhanced from XianScan). The bubble provides the safe geometric boundary ceiling, tail-severed optical center, and slack expansion room.
- **Free-Floating Text / SFX outside Balloons:** Handled by the **existing Bottom-Up Cotrans MST Merge Engine**, preserving 100% recall for sound effects, signs, chapter titles, and unanchored narrative prose.
- **User Control:** Governed by an explicit, persistent setting toggle in the extension popup. If disabled, Kites executes the existing v1.1.1 MST pipeline with zero regression risk.

### 1.3 Strict Architectural Invariants & Boundary Rules
1. **Inpainting Isolation (Polygon-Only Contract):**
   In accordance with memory `inpaint-polygon-only-contract.md` and Devlog 016, inpainting engines (LaMa, Simple) **STRICTLY receive the original tight line polygons (`rawPolygons` / `polygon`)**. They must NEVER receive `typeset_box` or expanded bubble boxes. The expanded bubble box exists exclusively for the rendering/typesetting stage.
2. **Post-Merge Splitting Boundary:**
   In accordance with memory `hybrid-text-pipeline-boundary.md`, utterance splitting must NEVER interfere with Cotrans line merging. Cotrans MST groups all candidate lines first; utterance splitting runs strictly as a **POST-merge pass** over final clusters.
3. **Zero-Overhead Default (Tier 1 Heuristic):**
   The default mode operates at 0 MB model download cost and $< 2$ ms runtime by combining Canvas typed array morphology with pure O(1) geometric slack equations.

---

## 2. Settings UI & Configuration Architecture

The bubble detection subsystem is controlled by an explicit setting registered in `STORAGE_KEYS` to maintain a single source of truth and avoid magic strings.

### 2.1 State Definition & Storage Schema
Update `src/shared/types.ts` and `src/shared/constants.ts`:

```typescript
// In src/shared/constants.ts
export const STORAGE_KEYS = {
  POPUP_STATE: 'popupState',
  AUTH_TOKEN: 'kites_oauth_auth_token',
  AUTH_EXPIRES_AT: 'kites_oauth_token_expires_at',
  WEBGPU_SUPPORTED: 'hardware_webgpu_supported',
} as const;

// In src/shared/types.ts
export type BubbleDetectionMode = 'off' | 'heuristic' | 'neural';

export interface PopupState {
  // Existing fields...
  isExtensionEnabled: boolean;
  isAuto: boolean;
  manualMode: 'hover' | 'persistent';
  concurrency: number;
  isDark: boolean;
  sourceLang: string;
  targetLang: string;
  activeEngineId: string;
  activeInpaintId: string;
  activeOcrId: string;
  renderFontPresetId: RenderFontPresetId;
  fallbackChain: string[];
  customApis: CustomApiConfig[];
  webgpuSupported: boolean | null;
  webgpuMaster: boolean;
  webgpuOverrides: {
    llm: boolean;
    inpaint: boolean;
    ocr: boolean;
  };
  userAccount?: UserAccountInfo;

  // NEW: Bubble Detection & Typesetting Settings
  bubbleMode: BubbleDetectionMode; // default: 'heuristic'
}

export const DEFAULT_POPUP_STATE: PopupState = {
  // ...existing defaults
  bubbleMode: 'heuristic', // 0 MB instant heuristic default
};
```

### 2.2 Normalization & Migration
In `src/background/index.ts` (`normalizePopupState`):
```typescript
const bubbleMode: BubbleDetectionMode = 
  completedState.bubbleMode === 'neural' || completedState.bubbleMode === 'off'
    ? completedState.bubbleMode
    : 'heuristic';

const state: PopupState = {
  ...completedState,
  bubbleMode,
  // ...other fields
};
```

### 2.3 Popup UI Component (`src/popup/components/SettingsView.tsx`)
Add a dedicated **"Layout & Typography Engine"** section in `SettingsView.tsx`:

```tsx
{/* Layout & Typography Engine Card */}
<div className="flex flex-col gap-2 p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-lg">
  <div className="flex items-center justify-between">
    <div className="flex flex-col">
      <span className="font-medium text-sm">Smart Bubble Fit</span>
      <span className="text-xs text-[var(--color-dust)]">
        Detect bubble containers to prevent tiny fonts & optical decentering
      </span>
    </div>
    <select
      value={state.bubbleMode}
      onChange={(e) => updateState({ bubbleMode: e.target.value as BubbleDetectionMode })}
      className="text-xs bg-[var(--color-bg)] border border-[var(--color-dust)] rounded px-2 py-1 cursor-pointer font-medium"
    >
      <option value="off">Off (Classic Line Merge)</option>
      <option value="heuristic">Heuristic (Fast, 0 MB)</option>
      <option value="neural">Neural YOLO (Accurate, ~3.2 MB)</option>
    </select>
  </div>
</div>
```

---

## 3. High-Level Dual-Route Pipeline Architecture

```
                                [Raw Page Image Canvas]
                                           │
                                  1. Text Line OCR
                               (PaddleOCR / RapidOCR)
                                           │
                           [Raw OCR Text Line Polygons]
                                           │
                              Is bubbleMode == 'off'?
                                    /           \
                                   /             \
                             [YES]                [NO]
                              /                     \
                             /                       \
             ┌────────────────────────┐      2. Bubble Detection Pass
             │  Classic Route (v1.1)  │      Tier 1: Adaptive Heuristic (0 MB)
             │   - Cotrans MST Merge  │      Tier 2: YOLO11n ONNX (~3.2 MB)
             │   - Standard Quad Fit  │                       │
             └────────────────────────┘              [Bubble Containers]
                                                              │
                                                     3. Match & Post-Merge Split
                                                   (Coverage >= 50% Intersection)
                                                   (Punctuation & Stagger Split)
                                                              │
                                                  ┌───────────┴───────────┐
                                          [Inside Bubble]           [Outside Bubble]
                                                 │                         │
                                    ┌────────────────────────┐   ┌───────────────────┐
                                    │ 4. Tail Severing       │   │ FreeText / SFX    │
                                    │ 5. Safe Core Inset 8%  │   │ - Keep OCR bounds │
                                    │ 6. Slack Expansion     │   │ - Zero expansion  │
                                    │ 7. Optical Centering   │   │ - Rotation angle  │
                                    └────────────────────────┘   └───────────────────┘
                                                 \                         /
                                                  \                       /
                                              8. Multi-Pass Typeset Engine
                                                 (`fitFontSizeWithLines`)
                                                 (`balancedWrapText`)
                                                             │
                                              9. Canvas Render & Bake
```

---

## 4. Bubble Detection Subsystem: Tiers & Algorithms

We discard the heavy 145 MB RF-DETR model from XianScan and design a lean two-tier system suitable for Chrome MV3 extension constraints.

### 4.1 Tier 1: Adaptive Heuristic Carrier Extractor (0 MB, Instant CPU)
Tier 1 requires zero network downloads and runs purely on the Offscreen Canvas `ImageData` using spatial seeds already provided by OCR.

#### Algorithm Specification:
1. **Text Line Spatial Seeds:** Each detected OCR text line polygon provides a centroid coordinate $(cx_i, cy_i)$.
2. **Adaptive Background Sampling ($\Delta E$ Color Distance):**
   - Sample pixel colors within a $12\times 12$px patch around the seed, filtering out dark text pixels ($Luminance < 110$).
   - Compute baseline background color $C_{bg} = (R_0, G_0, B_0)$.
   - Compute WCAG luminance of $C_{bg}$. If $Luminance < 0.20$, the bubble is flagged as **Inverted Dark Bubble**; otherwise, it is a **Standard Light Bubble**.
3. **Normalized Downscale Patch (Resolution Invariance & O(1) Speed):**
   - Extract a bounding patch around the text cluster expanded by $80$px on all sides.
   - Downscale the patch to a maximum resolution of $200 \times 200$px onto a temporary canvas.
   - Scaling factor: $s = \min(200 / W_{orig}, 200 / H_{orig}, 1.0)$.
   - *Why:* Guarantees execution time is $< 1$ ms regardless of whether the source page is 720p or 4K webtoon strip.
4. **Adaptive Flood Fill (Boundary Tracing):**
   - A pixel $P(x, y)$ is classified as bubble interior if:
     $$\Delta E(P, C_{bg}) = \sqrt{(R - R_0)^2 + (G - G_0)^2 + (B - B_0)^2} \le 35$$
   - Flood fill propagates outward from the scaled text centroid using a 4-connected BFS queue.
   - Propagation halts upon reaching dark border strokes ($\Delta E > 35$).
   - **Leak Guard:** If flood fill touches the boundary of the expanded patch without encountering a closed contour, the region is determined to be **FreeText in open artwork** $\to$ abort bubble creation and preserve original tight OCR box.
5. **Resolution-Invariant Morphological Disk Opening (Tail Severing):**
   - Execute erosion on the interior binary mask using disk kernel:
     $$R_{erode} = \text{clamp}\left(\text{round}(14 \times s), 8, 16\right)$$
   - Narrow protrusions ($< 2 \times R_{erode}$ px, i.e. the pointing tail) are disconnected from the main chamber.
   - Flood fill from text seed retains only the main chamber component.
   - Execute dilation with radius $R_{erode}$ bounded by original mask.
6. **Upscale & Bounding Box Extraction:**
   - Extract bounding box $[minX, minY, maxX - minX, maxY - minY]$ and scale back by $1 / s$.
   - Output: `carrier_box` $[x, y, w, h]$.

### 4.2 Tier 2: Neural YOLO Comic Bubble Detector (~3.2 MB ONNX)
For complex scenes (textured backgrounds, screaming bubbles with irregular spiky strokes, borderless semi-transparent balloons), Tier 2 provides a deep learning object detection model.

#### Model Specifications:
- **Base Architecture:** YOLO11-nano comic speech bubble detector (e.g. trained on Manga109 / ComicBubble datasets).
- **Format:** ONNX INT8 quantized. Size: **~3.2 MB**.
- **Input Tensor:** Fixed $[1, 3, 640, 640]$, normalized RGB $[0.0, 1.0]$.
- **Execution Provider:** ONNX Runtime Web (`ort-web`) utilizing WebGPU backend (falling back to WASM SIMD).
- **Execution Target:** Offscreen document. Reuses existing WebGPU pipeline and memory manager.
- **Inference Time:** $15–25$ ms on modern GPUs, $\sim 120$ ms on WASM CPU.
- **Output:** Bounding boxes $[x, y, w, h]$ for classes `[0: Bubble]`.

### 4.3 Why XianScan's RF-DETR Model (145 MB) is Permanently Rejected
- Violates Chrome Web Store CRX package limits (store limit 200MB, extension bundle budget $\le 25$MB).
- Consumes $> 500$ MB VRAM, exceeding Chrome's per-tab GPU process budget.
- Cold-load latency $> 4$ seconds on user systems.

---

## 5. Detailed Step-by-Step Pipeline Logic

### Step 1: Matching OCR Lines to Bubbles
For every detected candidate box $T = (t_x, t_y, t_w, t_h)$ from OCR:
- Compute intersection area with each detected bubble box $B = (b_x, b_y, b_w, b_h)$.
- A text region is associated with bubble $B$ if:
  $$\text{Coverage} = \frac{\text{Area}(T \cap B)}{\text{Area}(T)} \ge 0.50$$
- If matched: `RegionKind = DialogueBubble`.
- If unmatched: `RegionKind = FreeText`.

### Step 2: Orphan Line & Punctuation Rescue (Port from `builder.rs:138-187`)
OCR engines often isolate exclamation points or outlying vertical columns.
- For each unmatched OCR line $L$:
  - If centroid $(L_{cx}, L_{cy})$ lies inside matched bubble $B$ $\rightarrow$ claim $L$ into bubble's text lines.
  - If $L$ is pure punctuation (`!`, `?`, `!!`, `!?`, `...`) and lies within 35px vertical / 45px horizontal gap of a claimed line $\rightarrow$ claim $L$ into the cluster.

### Step 3: In-Bubble Utterance Splitting (Port from `clustering.rs`)
Inside a single speech balloon, characters may speak two distinct lines separated by a vertical/horizontal gap (e.g. staggered speech lobes, User Image 2).
- Executes as a post-merge filter over Cotrans MST clusters:
- Sort lines in reading order (TBRL for vertical, top-to-bottom for horizontal).
- Detect split boundary between consecutive lines $L_{i}$ and $L_{i+1}$ if:
  1. $L_i$ ends with a terminal punctuation mark (`ends_with_term`): `!`, `?`, `...`, `。`, `」`, `』`.
  2. Vertical gap $\Delta Y = Top(L_{i+1}) - Bottom(L_i) \ge (1.35 \times \text{median\_thickness})$.
- If conditions met $\rightarrow$ split into two independent utterances ($U_1, U_2$).

### Step 4: Sibling Boundary Constraints (Port from `expansion.rs:230-269`)
When a bubble contains multiple sibling utterances ($U_1, U_2$):
- They dynamically limit each other's expansion room.
- Maintain a minimum sibling clearance:
  $$\text{SIBLING\_GAP} = 6\text{ px}$$
- Utterance $U_1$ cannot expand downward past $Top(U_2) - \text{SIBLING\_GAP}$.
- Utterance $U_2$ cannot expand upward past $Bottom(U_1) + \text{SIBLING\_GAP}$.

### Step 5: Carrier Chamber Derivation (Tail Severing)
- Run Tier 1 Morphological Erosion on the bubble patch.
- If image pixel erosion fails or is bypassed: apply the asymmetric geometric margin heuristic (`derive_carrier_box` in `expansion.rs:70-117`):
  $$m_{\text{top}} = T_y - B_y, \quad m_{\text{bot}} = (B_y + B_h) - (T_y + T_h)$$
  $$m_{\text{left}} = T_x - B_x, \quad m_{\text{right}} = (B_x + B_w) - (T_x + T_w)$$
  If $m_{\text{bot}} \ge 1.30 \times m_{\text{top}}$ and $(m_{\text{bot}} - m_{\text{top}}) \ge 20$px:
  $$\text{safe\_pad} = \min(m_{\text{top}}, m_{\text{side}} \times 0.90)$$
  $$\text{carrier.h} = (T_y + T_h + \text{safe\_pad}) - B_y$$
- **Validation Guard (`valid_tail_cut_carrier`):** If bubble touches canvas boundary ($B_y \le 12$ or $B_y + B_h \ge H - 12$), tail cut is aborted to prevent cropping edge-sliced panels.

### Step 6: Safe Core Inscription (Port from `expansion.rs:26-38`)
Compute safe inner boundary by insetting the carrier chamber by $8\%$:
$$m_x = \text{clamp}(carrier.w \times 0.08, 4, 24)$$
$$m_y = \text{clamp}(carrier.h \times 0.08, 4, 24)$$
$$\text{SafeCore} = [carrier.x + m_x, carrier.y + m_y, carrier.w - 2m_x, carrier.h - 2m_y]$$

### Step 7: Damped Slack Expansion (Port from `expansion.rs:273-318`)
Anchored around text centroid $(cx, cy) = (t_x + t_w / 2, t_y + t_h / 2)$:
$$\text{max\_safe\_half\_w} = \min(cx - \text{SafeCore.left}, \text{SafeCore.right} - cx)$$
$$\text{raw\_scale\_w} = \frac{\text{max\_safe\_half\_w}}{t_w / 2}$$
$$\text{usable\_slack} = (\text{SafeCore.width} - t_w)$$

If $\text{usable\_slack} \ge t_w \times 0.15$ and $\text{raw\_scale\_w} \ge 1.05$:
$$\text{damping} = \begin{cases} 1.0 & \text{if narrow vertical } (t_w < t_h / 2 \text{ and vertical}) \\ 0.60 & \text{otherwise} \end{cases}$$
$$\text{cap} = \begin{cases} 2.20 & \text{if narrow vertical} \\ 1.45 & \text{otherwise} \end{cases}$$
$$\text{final\_scale} = \min(1.0 + (\text{raw\_scale\_w} - 1.0) \times \text{damping}, \text{cap}, \text{raw\_scale\_w})$$
$$W_{\text{new}} = 2 \times \text{round}\left(\frac{t_w}{2} \times \text{final\_scale}\right), \quad X_{\text{new}} = cx - \frac{W_{\text{new}}}{2}$$

*(Repeat symmetrically for height axis with damping $0.60$ and cap $1.45$).*

### Step 8: Optical Chamber Centering & Typeset Box Emission
- For sole-occupant bubbles with healthy fill ratio ($0.15 \le \text{fill} \le 0.90$):
  $$typeset\_box.x = carrier\_cx - W_{\text{new}} / 2$$
  $$typeset\_box.y = carrier\_cy - H_{\text{new}} / 2$$
- Clamp `typeset_box` strictly within `carrier` bounds.
- Emit `typeset_box` directly to `typesetLayout.ts` and `canvasTypesetting.ts`.

---

## 6. What to Port vs What Kites Upgrades Beyond XianScan

| Component | XianScan Reference File | Kites Port / Upgrade Strategy | Rationale & Advantage over XianScan |
| :--- | :--- | :--- | :--- |
| **Bubble Detector Model** | `src/ml/detect/rfdetr.rs` (145 MB) | **Custom Upgrade:** 0 MB Heuristic (Tier 1) + Optional 3.2 MB YOLO11n (Tier 2). | RF-DETR is too massive for Chrome Web Store MV3. Our 0 MB Tier 1 runs in $<1$ ms. |
| **Carrier Chamber (Tail Cut)** | `src/pipeline/region_builder/geometry.rs:228-406` | **Custom Upgrade:** Downscaled normalized patch ($200\times 200$) with dynamic $R_{erode}$ clamp $[8, 16]$. | XianScan hardcodes $R=14$ on raw resolution, which over-erodes 720p images and under-erodes 4K webtoons. |
| **Bubble Interior Color Test** | `src/ml/inpaint/shrinkwrap.rs:108-175` | **Custom Upgrade:** Adaptive background sampling via `sampleQuadBackground` and $\Delta E$ color distance. | XianScan hardcodes `RGB >= 200`, breaking on dark, screentone, or tinted bubbles. Our logic supports all color schemes. |
| **FreeText / SFX Clustering** | `src/pipeline/region_builder/filter.rs` | **Retain Existing Kites Logic:** Cotrans Kruskal MST line merge. | XianScan uses 21 aggressive rejection filters that frequently discard artistic SFX. Cotrans MST preserves maximum recall. |
| **Utterance Splitting** | `src/pipeline/region_builder/clustering.rs` | **1:1 Port:** Post-merge split pass checking `ends_with_term` and vertical stagger gap $\ge 1.35\times$. | Solves staggered multi-utterance bubbles (Issue illustrated in user's Image 2). |
| **Slack Expansion Math** | `src/pipeline/region_builder/expansion.rs:270-320` | **1:1 Port:** Centroid-anchored expansion with damping $0.60$, $1.45\times$ cap, and $2.20\times$ narrow-vertical cap. | Prevents font size collapse and keeps text comfortably inside comic bubble chambers. |
| **Typesetting & Line Wrapping** | `web/src/lib/server/typeset/layout.ts` | **Already Ported:** `typesetLayout.ts` (`balancedWrapText`, `fitFontSizeWithLines`). | Balanced diamond wrap is already active; connecting `typeset_box` gives it optimal chamber dimensions. |

---

## 7. Edge Case Matrix & Defensive Failure Handling

| Edge Case | Failure Mode if Unhandled | Defensive Mechanism in Kites |
| :--- | :--- | :--- |
| **Hand-Drawn Broken / Open Borders** | Flood fill leaks out of the gap into adjacent panel artwork. | **1.** Crop boundary clamp: flood fill cannot expand beyond bounding patch $+6$px.<br>**2.** Morphological Closing ($R=2$px) seals gaps $\le 4$px.<br>**3.** If outer border touched: aborts carrier and falls back to OCR box. |
| **Inverted Dark Bubble (White text on black background)** | Fixed $RGB \ge 200$ test fails to recognize bubble interior. | Adaptive luminance probe checks seed background. If dark ($L < 0.20$), inverts thresholding: interior is $L < 0.25$, boundary is light stroke. |
| **Screaming / Shock Spiky Bubbles** | Text expands into sharp spike corners, colliding with black spike contours. | Morphological erosion ($R=14$) naturally severs narrow spikes ($<28$px), leaving only the smooth oval core chamber. |
| **Rectangular Narration / Status Cards** | Tail-cutting logic misinterprets rectangular corners as asymmetric tails. | Symmetric margin check detects $m_{\text{top}} \approx m_{\text{bot}}$ and $m_{\text{left}} \approx m_{\text{right}}$. `valid_tail_cut_carrier` returns `false`, keeping pure rectangle. |
| **Extremely Cramped Bubbles** | Text expansion causes text to overlap bubble stroke. | If available slack space is $< 15\%$ of current text box width (`MIN_UNUSED_RATIO = 0.15`), expansion is completely disabled. |
| **Tall Webtoon Strips (>14,000px)** | Canvas operations exhaust GPU VRAM or crash offscreen memory. | Bubble detection integrates with `tallStripTiling.ts`: executes per-tile with 300px overlap, merging bubble proposals via standard IoU ($\ge 0.50$). |

---

## 8. Implementation Roadmap & Phased Execution

### Phase 1: Storage Key, Popup UI & Feature Flag Scaffolding
- Add `bubbleMode: 'off' | 'heuristic' | 'neural'` to `PopupState` in `src/shared/types.ts`.
- Update `DEFAULT_POPUP_STATE` and `normalizePopupState` in `src/background/index.ts`.
- Add the configuration dropdown to `src/popup/components/SettingsView.tsx`.
- Write unit tests verifying state persistence and backward compatibility.

### Phase 2: Core Geometric Algorithms & Utterance Splitting (`src/offscreen/utils/`)
- Implement `bubbleExpansion.ts`:
  - `bubbleCore(box: BoxRect): BoxRect`
  - `dampedSlackExpansion(textBox: BoxRect, limitBox: BoxRect, isVertical: boolean): BoxRect`
  - `deriveCarrierBoxGeometric(bubble: BoxRect, text: BoxRect, pageH: number): BoxRect`
- Implement `utteranceSplitter.ts`:
  - Port `cluster_lines_into_utterances` from XianScan `clustering.rs`.
  - Wire as a post-merge pass on Cotrans MST clusters (`OcrManager.ts`).
- Write 100% test coverage suite validating math against XianScan test fixtures.

### Phase 3: Tier 1 Adaptive Heuristic Carrier Extractor (`src/offscreen/engines/bubble/`)
- Implement `HeuristicBubbleExtractor.ts`:
  - Canvas patch downscaling to $200 \times 200$.
  - Adaptive $\Delta E$ BFS flood fill on `Uint8ClampedArray`.
  - Disk erosion ($R_{erode} \in [8, 16]$) and carrier chamber reconstruction.
- Benchmark runtime on 1080p and 4K images to guarantee $< 1.5$ ms per image.

### Phase 4: Integration with `PipelineOrchestrator` & `canvasTypesetting`
- Update `OcrResult` in `BaseOcrEngine.ts` to include optional `typesetBoxes?: OcrBox[]`.
- In `PipelineOrchestrator.ts`:
  - Read `popupState.bubbleMode`.
  - Route text blocks through `HeuristicBubbleExtractor` if enabled.
  - Forward `typesetBox` to `TextBlockItem` in `renderTextBlocksBatch`.
- In `canvasTypesetting.ts` & `cotransDefaultRenderer.ts`:
  - Update `resizeRegionToFontSize` to respect `typesetBox` when provided, providing comfortable chamber bounds to `fitFontSizeWithLines` while keeping inpainting strictly bounded to original line polygons.

### Phase 5: Optional Tier 2 Neural YOLO11n Integration
- Download and quantize YOLO11n-comic-bubble to INT8 ONNX (~3.2 MB).
- Implement `YoloBubbleEngine.ts` utilizing `ort-web` in the offscreen document.
- Activate when `bubbleMode === 'neural'` and WebGPU is available.

### Phase 6: End-to-End Verification & Devlog
- Run `npm test` across all unit tests to ensure zero regressions.
- Execute visual acceptance test via `npx tsx src/test/pipelineVisualTest.ts`.
- Write Devlog document in `docs/dev-history/devlog/`.
