import type { BoxRect } from '../../utils/bubbleExpansion';
import type { ImagePatchData } from './HeuristicBubbleExtractor';

/** Native-pixel paper evidence. OCR rectangles never change this mask. */
export interface PaperPatch {
  bounds: BoxRect;
  mask: Uint8Array;
}
export interface PaperComponent {
  mask: Uint8Array;
  area: number;
  bounds: BoxRect;
  frontier: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}
/** @param image Original pixels. @param bounds Native crop. @param threshold Paper cutoff. @param dark Paper polarity. @returns Unmodified observed paper mask. */
export function samplePaperPatch(image: ImagePatchData, bounds: BoxRect, threshold: number, dark: boolean): PaperPatch {
  const mask = new Uint8Array(bounds.w * bounds.h);
  const channels = image.data.length >= image.width * image.height * 4 ? 4 : 3;
  for (let y = 0; y < bounds.h; y++) for (let x = 0; x < bounds.w; x++) {
    const offset = ((bounds.y + y) * image.width + bounds.x + x) * channels;
    const r = image.data[offset], g = image.data[offset + 1], b = image.data[offset + 2];
    mask[y * bounds.w + x] = Number(dark
      ? Math.max(r, g, b) <= threshold : Math.min(r, g, b) >= threshold);
  }
  return { bounds, mask };
}
/** @param index Pixel index. @param width Raster width. @param length Raster length. @param visit Neighbor callback. @returns Nothing. */
function neighbors(index: number, width: number, length: number, visit: (next: number) => void): void {
  const x = index % width;
  if (x > 0) visit(index - 1);
  if (x + 1 < width) visit(index + 1);
  if (index >= width) visit(index - width);
  if (index + width < length) visit(index + width);
}
/** Selects the paper component with greatest observed support inside the OCR box, not a possibly-ink centroid.
 * @param patch Observed paper. @param text Native OCR region. @returns Selected component or null without paper support. */
export function selectPaperComponent(patch: PaperPatch, text: BoxRect): PaperComponent | null {
  const { bounds, mask } = patch;
  const labels = new Int32Array(mask.length);
  const queue = new Int32Array(mask.length);
  const supports: number[] = [0];
  let label = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    label++;
    let head = 0, end = 1, support = 0;
    queue[0] = start;
    labels[start] = label;
    while (head < end) {
      const pixel = queue[head++];
      const x = bounds.x + pixel % bounds.w, y = bounds.y + Math.floor(pixel / bounds.w);
      if (x >= text.x && x < text.x + text.w && y >= text.y && y < text.y + text.h) support++;
      neighbors(pixel, bounds.w, mask.length, (next) => {
        if (mask[next] && !labels[next]) { labels[next] = label; queue[end++] = next; }
      });
    }
    supports.push(support);
  }
  let selected = 0;
  for (let i = 1; i < supports.length; i++) if (supports[i] > supports[selected]) selected = i;
  if (!selected) return null;
  const component = new Uint8Array(mask.length);
  let left = bounds.w, right = -1, top = bounds.h, bottom = -1, area = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] === selected) {
    component[i] = 1; area++;
    const x = i % bounds.w, y = Math.floor(i / bounds.w);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { mask: component, area,
    bounds: { x: bounds.x + left, y: bounds.y + top, w: right - left + 1, h: bottom - top + 1 },
    frontier: { left: left === 0, right: right === bounds.w - 1, top: top === 0, bottom: bottom === bounds.h - 1 } };
}
/** Fill internal ink islands only. Exterior ink and enclosed independent paper components remain barriers.
 * @param component Selected paper mask. @param width Raster width. @param observed All observed paper pixels.
 * @returns Component including enclosed ink holes, never enclosing another outlined balloon. */
export function fillEnclosedInk(component: Uint8Array, width: number, observed?: Uint8Array, maxCounterArea: number = 0): Uint8Array {
  const outside = new Uint8Array(component.length);
  const queue = new Int32Array(component.length);
  let head = 0, end = 0;
  /** @param pixel Exterior or independently observed paper candidate. @returns Nothing. */
  const enqueue = (pixel: number): void => {
    if (!component[pixel] && !outside[pixel]) { outside[pixel] = 1; queue[end++] = pixel; }
  };
  const height = component.length / width;
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
  if (observed) {
    const seen = new Uint8Array(component.length);
    const island = new Int32Array(component.length);
    for (let start = 0; start < component.length; start++) {
      if (!observed[start] || component[start] || seen[start]) continue;
      let read = 0, count = 1;
      island[0] = start; seen[start] = 1;
      while (read < count) neighbors(island[read++], width, component.length, (next) => {
        if (observed[next] && !component[next] && !seen[next]) { seen[next] = 1; island[count++] = next; }
      });
      // Tiny paper islands can be counters inside glyphs. Large independent paper
      // regions are separate cavities and must never be swallowed by hole filling.
      if (count > maxCounterArea) for (let i = 0; i < count; i++) enqueue(island[i]);
    }
  }
  while (head < end) neighbors(queue[head++], width, component.length, enqueue);
  return component.map((value, index) => Number(Boolean(value) || !outside[index]));
}
/** @param mask Crop mask. @param bounds Native crop. @param text OCR region. @returns Fraction of OCR pixels actually inside the component. */
export function paperCoverage(mask: Uint8Array, bounds: BoxRect, text: BoxRect): number {
  const left = Math.max(bounds.x, Math.floor(text.x)), top = Math.max(bounds.y, Math.floor(text.y));
  const right = Math.min(bounds.x + bounds.w, Math.ceil(text.x + text.w));
  const bottom = Math.min(bounds.y + bounds.h, Math.ceil(text.y + text.h));
  let inside = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) inside += mask[(y - bounds.y) * bounds.w + x - bounds.x];
  return inside / Math.max(1, (Math.ceil(text.x + text.w) - Math.floor(text.x)) * (Math.ceil(text.y + text.h) - Math.floor(text.y)));
}
