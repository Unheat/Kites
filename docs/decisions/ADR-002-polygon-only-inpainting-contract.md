# ADR-002: Polygon-Only Contract for Inpainting Engines

## Status
Accepted

## Context
In comic translation, inpainting removes original source text (Japanese kanji, Korean hangul, Chinese hanzi) to prepare a clean surface for translated text.

Historically, manga translation systems made two common architectural mistakes:
1. **Rectangular Bounding Box Inpainting:** Passing the entire speech balloon rectangle to the inpainting model. This erases the balloon's hand-drawn outlines, destroys screentones, and creates noticeable rectangular "gray blur boxes" across the artwork.
2. **Raw Segmentation Heatmap Masks (`maskRawCanvas`):** Passing raw DBNet probability binarizations directly. This frequently bleeds into panel borders and misidentified background art, leaving holes in the artwork.

## Decision
Establish the **Polygon-Only Inpainting Contract**:
Inpainting engines (`LaMa`, `AOT-GAN`, `SimpleInpaint`, `Telea`) must **exclusively receive the 4-point polygon contours of surviving dialogue characters**, never full speech-bubble bounding rectangles or raw DBNet probability masks.

Specifically:
- Only characters that survived the 14-stage noise filtering battery and were assigned to a valid translated text group generate masks.
- Masks are drawn with a tight round stroke (`lineWidth = 4`, `lineJoin = 'round'`) to cover anti-aliased character edges without touching speech balloon borders.
- The raw probability mask (`_maskRawCanvas`) remains explicitly dormant.

## Consequences
### Positive
- **100% Speech Bubble Outline Preservation:** Hand-drawn balloon borders, tails, and panel borders remain completely untouched.
- **Screentone & Background Art Integrity:** Background patterns outside character strokes are preserved.
- **Zero Blanked-Out Bubbles:** If a text line is dropped or low-confidence noise, it is never erased, preventing blank, empty speech balloons.

### Trade-offs
- Requires tight perspective warping and polygon tracking through the entire pipeline.
- If OCR slightly misaligns a character polygon, a small fragment of the original stroke could remain visible (mitigated by the 4px round stroke expansion).

## Alternatives Considered
- **Full Bubble Inpainting:** Rejected because erasing the entire balloon destroys screentones, gradients, and custom hand-lettered balloon contours.
- **Convex Hull Inpainting of Entire Text Group:** Rejected because words with large vertical or horizontal spacing would inpaint the gap between words, degrading intermediate panel art.
