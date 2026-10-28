import type { BoxRect } from '../../utils/bubbleExpansion';
import type { ImagePatchData } from './HeuristicBubbleExtractor';
import { paperCoverage, type PaperComponent, type PaperPatch } from './heuristicPaperComponents';

/** Most OCR pixels must belong to the supported cavity, without demanding ink pixels be paper. */
export const MIN_HEURISTIC_TEXT_COVERAGE = 0.6;
/** Sub-threshold screentone noise is tolerated; most of the perimeter needs an actual contrast edge. */
const MIN_SUPPORTED_BOUNDARY_RATIO = 0.5;
/** Native-pixel edge band includes antialiasing without reaching unrelated distant contours. */
const EDGE_BAND_RADIUS = 2;
/** Minimum local channel contrast for a drawn boundary rather than smooth shading. */
const MIN_BOUNDARY_CONTRAST = 35;

/** @param component Selected paper. @param patch Native crop. @param image Original pixels. @returns Artificial sides requiring more image evidence. */
export function incompleteFrontier(component: PaperComponent, patch: PaperPatch, image: ImagePatchData): PaperComponent['frontier'] {
  const { bounds } = patch;
  return {
    left: component.frontier.left && bounds.x > 0,
    right: component.frontier.right && bounds.x + bounds.w < image.width,
    top: component.frontier.top && bounds.y > 0,
    bottom: component.frontier.bottom && bounds.y + bounds.h < image.height,
  };
}
/** @param image Original pixels. @param x Native X. @param y Native Y. @returns Average RGB channel luminance. */
function luminance(image: ImagePatchData, x: number, y: number): number {
  const channels = image.data.length >= image.width * image.height * 4 ? 4 : 3;
  const index = (y * image.width + x) * channels;
  return (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
}
/** Tests real local contrast around the component perimeter, excluding artificial closure at page boundaries.
 * @param image Raw pixels. @param patch Native crop. @param mask Cavity mask. @returns Supported perimeter fraction. */
export function boundarySupport(image: ImagePatchData, patch: PaperPatch, mask: Uint8Array): number {
  const { bounds } = patch;
  let boundary = 0, supported = 0;
  for (let y = 1; y < bounds.h - 1; y++) for (let x = 1; x < bounds.w - 1; x++) {
    const pixel = y * bounds.w + x;
    if (!mask[pixel] || (mask[pixel - 1] && mask[pixel + 1] && mask[pixel - bounds.w] && mask[pixel + bounds.w])) continue;
    boundary++;
    let minimum = Infinity, maximum = -Infinity;
    for (let dy = -EDGE_BAND_RADIUS; dy <= EDGE_BAND_RADIUS; dy++) {
      for (let dx = -EDGE_BAND_RADIUS; dx <= EDGE_BAND_RADIUS; dx++) {
        const gx = bounds.x + x + dx, gy = bounds.y + y + dy;
        if (gx < 0 || gy < 0 || gx >= image.width || gy >= image.height) continue;
        const value = luminance(image, gx, gy);
        minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
      }
    }
    if (maximum - minimum >= MIN_BOUNDARY_CONTRAST) supported++;
  }
  return boundary ? supported / boundary : 0;
}
/** @param image Original pixels. @param patch Crop evidence. @param component Observed component. @param filled Cavity with enclosed glyph holes. @param text OCR bounds. @returns Rejection reason or null when supported. */
export function validatePaperCandidate(image: ImagePatchData, patch: PaperPatch, component: PaperComponent, filled: Uint8Array, text: BoxRect): string | null {
  if (paperCoverage(filled, patch.bounds, text) < MIN_HEURISTIC_TEXT_COVERAGE) return 'insufficient-text-support';
  // Paper spanning opposite edges proves unbounded territory (no enclosing wall).
  // Single-edge contact may be a legitimate bubble at a crop or panel boundary.
  if ((component.frontier.left && component.frontier.right) ||
      (component.frontier.top && component.frontier.bottom)) return 'page-spanning-paper';
  if (boundarySupport(image, patch, filled) < MIN_SUPPORTED_BOUNDARY_RATIO) return 'unsupported-boundary';
  return null;
}
