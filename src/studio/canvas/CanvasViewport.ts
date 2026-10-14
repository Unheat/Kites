import type { Point } from '../types';

/** Minimum permitted zoom factor (10%). */
export const MIN_ZOOM_LEVEL = 0.1;

/** Maximum permitted zoom factor (500%). */
export const MAX_ZOOM_LEVEL = 5.0;

/**
 * Transforms screen client coordinates into image pixel space using the canvas element's bounding rect.
 * Perfectly immune to scroll offsets and margin: auto centering.
 *
 * @param clientX - Pointer screen horizontal coordinate.
 * @param clientY - Pointer screen vertical coordinate.
 * @param canvasRect - Bounding client rectangle of the rendered canvas.
 * @param imageWidth - Natural width of manga image in pixels.
 * @param imageHeight - Natural height of manga image in pixels.
 * @param isFlipped - Whether image is horizontally mirrored.
 * @returns Point in natural image coordinate space.
 */
export function clientToImage(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  imageWidth: number,
  imageHeight: number,
  isFlipped: boolean = false
): Point {
  if (canvasRect.width <= 0 || canvasRect.height <= 0) {
    return { x: 0, y: 0 };
  }

  const normalizedX = (clientX - canvasRect.left) / canvasRect.width;
  const normalizedY = (clientY - canvasRect.top) / canvasRect.height;

  let imgX = normalizedX * imageWidth;
  const imgY = normalizedY * imageHeight;

  if (isFlipped && imageWidth > 0) {
    imgX = imageWidth - imgX;
  }

  return { x: imgX, y: imgY };
}

/**
 * Transforms image coordinates into screen client pixels using the canvas element's bounding rect.
 *
 * @param imageX - Horizontal coordinate in image space.
 * @param imageY - Vertical coordinate in image space.
 * @param canvasRect - Bounding client rectangle of the rendered canvas.
 * @param imageWidth - Natural width of manga image in pixels.
 * @param imageHeight - Natural height of manga image in pixels.
 * @param isFlipped - Whether image is horizontally mirrored.
 * @returns Screen coordinate point in client pixels.
 */
export function imageToClient(
  imageX: number,
  imageY: number,
  canvasRect: DOMRect,
  imageWidth: number,
  imageHeight: number,
  isFlipped: boolean = false
): Point {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { x: canvasRect.left, y: canvasRect.top };
  }

  const effectiveX = isFlipped && imageWidth > 0 ? imageWidth - imageX : imageX;
  const clientX = canvasRect.left + (effectiveX / imageWidth) * canvasRect.width;
  const clientY = canvasRect.top + (imageY / imageHeight) * canvasRect.height;

  return { x: clientX, y: clientY };
}

/**
 * Computes scale to fit the image width into the container with padding.
 *
 * @param containerWidth - Width of available scroll viewport.
 * @param imageWidth - Natural image width.
 * @param paddingPx - Margin padding (default 32).
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
 * Computes scale to fit the image height into the container with padding.
 *
 * @param containerHeight - Height of available scroll viewport.
 * @param imageHeight - Natural image height.
 * @param paddingPx - Margin padding (default 32).
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
 * Computes scale to fit both width and height inside the scroll container.
 *
 * @param containerWidth - Width of available scroll viewport.
 * @param containerHeight - Height of available scroll viewport.
 * @param imageWidth - Natural image width.
 * @param imageHeight - Natural image height.
 * @param paddingPx - Margin padding (default 32).
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
