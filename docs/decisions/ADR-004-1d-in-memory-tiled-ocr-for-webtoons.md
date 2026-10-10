# ADR-004: 1D In-Memory Canvas Tiling for Tall Webtoons

## Status
Accepted

## Context
Digital webtoon platforms (Naver Webtoon, Kakao, Bilibili Comics, Tappytoon) render comics as continuous stitched vertical strips, often reaching 10,000 to 30,000 pixels in height.

Processing these massive strips in a browser extension causes severe failures:
1. **GPU Texture Limits & OOM:** Chromium and WebGPU drivers impose maximum 2D texture dimensions (typically 4,096px to 16,384px). Textures exceeding these limits trigger driver crashes or WebGPU device loss.
2. **Aspect Ratio Squashing:** Standard PaddleOCR DBNet normalizes inputs to fixed maximum dimensions (960px). A 1000×20,000px strip compressed to 960px becomes 48×960px, squashing text into unrecognizable lines.

## Decision
Implement **1D In-Memory Canvas Tiling** directly inside `PaddleOcrEngine` (ported from XianScan's tiled OCR architecture):
1. **Activation Gate:** Automatically activates whenever image height $H \ge 2500\text{ px}$.
2. **Sliding Window Parameters:**
   - Tile height: $H_{\text{tile}} = 1000\text{ px}$
   - Stride: $S = 700\text{ px}$
   - Overlap zone: $O = 300\text{ px}$
3. **Execution:** Each tile is cropped onto a reusable OffscreenCanvas and processed independently through detection and recognition.
4. **Coordinate Re-projection:** Polygon coordinates are mapped back to full-page coordinates by adding the tile vertical offset $Y_{\text{offset}}$.
5. **IoU Boundary Deduplication:** Polygons in the 300px overlap zones are matched using Intersection-over-Union ($\text{IoU} \ge 0.40$). When two detections overlap, the instance with higher OCR confidence is retained.

## Consequences
### Positive
- **Single-Click UX:** The user clicks "Translate" once and receives the entire translated webtoon strip seamlessly.
- **Zero DOM Splitting:** Avoids breaking webpage layout, mutating CSS styles, or injecting multiple conflicting translation buttons.
- **Constant Memory Footprint:** Reuses a single $1000\text{ px}$ canvas slice, keeping memory consumption low regardless of strip height.

### Trade-offs
- Overlapping zones (300px) introduce a ~30% computational redundancy compared to hypothetical non-overlapping slices (necessary to prevent bisecting dialogue bubbles across tile seams).

## Alternatives Considered
- **DOM-Level Splitting:** Slicing the webpage `<img>` element into multiple smaller DOM nodes. Rejected because it breaks page responsiveness, clashes with SPA frameworks, and causes visible seams during scrolling.
- **Viewport Scroll Slicing:** Only translating the currently visible portion as the user scrolls. Rejected because it requires invasive scroll listeners, causes translation lag during fast scrolling, and prevents full-chapter offline caching.
