import type { Point } from '../types';
import { MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL } from '../state/studioStore';

/** Normal scroll velocity multiplier for wheel delta. */
export const WHEEL_SCROLL_SPEED = 0.6;

/** Exponential zoom dampening factor for cursor-centered wheel zooming. */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/**
 * Transforms screen client coordinates into canvas image coordinate space.
 *
 * @param clientX - Screen horizontal coordinate.
 * @param clientY - Screen vertical coordinate.
 * @param containerRect - Bounding client rectangle of the viewport container.
 * @param zoom - Current zoom magnification factor.
 * @param pan - Viewport translation offsets in screen pixels.
 * @param imageWidth - Width of the base manga image.
 * @param isFlipped - Whether the image is mirrored horizontally.
 * @returns Translated point in image pixel coordinates.
 */
export function clientToImage(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  zoom: number,
  pan: Point,
  imageWidth: number,
  isFlipped: boolean = false
): Point {
  const localX = clientX - containerRect.left - pan.x;
  const localY = clientY - containerRect.top - pan.y;

  let imgX = localX / zoom;
  const imgY = localY / zoom;

  if (isFlipped && imageWidth > 0) {
    imgX = imageWidth - imgX;
  }

  return { x: imgX, y: imgY };
}

/**
 * Transforms canvas image coordinates into screen client coordinate space.
 *
 * @param imageX - Horizontal image coordinate.
 * @param imageY - Vertical image coordinate.
 * @param containerRect - Bounding client rectangle of the viewport container.
 * @param zoom - Current zoom magnification factor.
 * @param pan - Viewport translation offsets in screen pixels.
 * @param imageWidth - Width of the base manga image.
 * @param isFlipped - Whether the image is mirrored horizontally.
 * @returns Screen position point in client pixels.
 */
export function imageToClient(
  imageX: number,
  imageY: number,
  containerRect: DOMRect,
  zoom: number,
  pan: Point,
  imageWidth: number,
  isFlipped: boolean = false
): Point {
  const effectiveX = isFlipped && imageWidth > 0 ? imageWidth - imageX : imageX;
  const clientX = containerRect.left + pan.x + effectiveX * zoom;
  const clientY = containerRect.top + pan.y + imageY * zoom;

  return { x: clientX, y: clientY };
}

/**
 * Computes zoom factor to fit the image width into the viewport container with padding.
 *
 * @param containerWidth - Width of viewport container.
 * @param imageWidth - Natural width of manga image.
 * @param paddingPx - Margin padding inside container (default 32).
 * @returns Clamped scale factor.
 */
export function calculateFitWidth(
  containerWidth: number,
  imageWidth: number,
  paddingPx: number = 32
): number {
  if (imageWidth <= 0 || containerWidth <= 0) return 1.0;
  const available = Math.max(10, containerWidth - paddingPx);
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, available / imageWidth));
}

/**
 * Computes zoom factor to fit the image height into the viewport container with padding.
 *
 * @param containerHeight - Height of viewport container.
 * @param imageHeight - Natural height of manga image.
 * @param paddingPx - Margin padding inside container (default 32).
 * @returns Clamped scale factor.
 */
export function calculateFitHeight(
  containerHeight: number,
  imageHeight: number,
  paddingPx: number = 32
): number {
  if (imageHeight <= 0 || containerHeight <= 0) return 1.0;
  const available = Math.max(10, containerHeight - paddingPx);
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, available / imageHeight));
}

/**
 * Computes zoom factor to fit the entire image within the container boundaries.
 *
 * @param containerWidth - Width of viewport container.
 * @param containerHeight - Height of viewport container.
 * @param imageWidth - Natural width of manga image.
 * @param imageHeight - Natural height of manga image.
 * @param paddingPx - Margin padding inside container (default 32).
 * @returns Clamped scale factor.
 */
export function calculateFitWindow(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  paddingPx: number = 32
): number {
  const scaleW = calculateFitWidth(containerWidth, imageWidth, paddingPx);
  const scaleH = calculateFitHeight(containerHeight, imageHeight, paddingPx);
  return Math.min(scaleW, scaleH);
}

/**
 * Processes mouse wheel events for natural scrolling vs cursor-centered zoom.
 *
 * @param event - MouseWheel event from the viewport container.
 * @param containerRect - Bounding rectangle of the viewport container.
 * @param currentZoom - Current zoom factor.
 * @param currentPan - Current pan coordinates.
 * @returns Updated zoom and pan state.
 */
export function processWheelNavigation(
  event: WheelEvent,
  containerRect: DOMRect,
  currentZoom: number,
  currentPan: Point
): { zoom: number; pan: Point } {
  // Cursor-centered zoom on Ctrl+wheel or Cmd+wheel
  if (event.ctrlKey || event.metaKey) {
    const zoomMultiplier = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
    const targetZoom = Math.max(
      MIN_ZOOM_LEVEL,
      Math.min(MAX_ZOOM_LEVEL, currentZoom * zoomMultiplier)
    );

    // Compute cursor position relative to container
    const cursorX = event.clientX - containerRect.left;
    const cursorY = event.clientY - containerRect.top;

    // Preserve the image coordinate under the cursor
    const scaleRatio = targetZoom / currentZoom;
    const nextPanX = cursorX - (cursorX - currentPan.x) * scaleRatio;
    const nextPanY = cursorY - (cursorY - currentPan.y) * scaleRatio;

    return {
      zoom: targetZoom,
      pan: { x: nextPanX, y: nextPanY },
    };
  }

  // Shift+wheel: Horizontal scroll
  if (event.shiftKey) {
    return {
      zoom: currentZoom,
      pan: {
        x: currentPan.x - event.deltaY * WHEEL_SCROLL_SPEED,
        y: currentPan.y,
      },
    };
  }

  // Default: Vertical document scroll
  return {
    zoom: currentZoom,
    pan: {
      x: currentPan.x - (event.deltaX ? event.deltaX * WHEEL_SCROLL_SPEED : 0),
      y: currentPan.y - event.deltaY * WHEEL_SCROLL_SPEED,
    },
  };
}
