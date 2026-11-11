/**
 * Overlay placement for the floating translate control.
 *
 * WORKAROUND: [CSS anchor positioning fails inside scrolled/fixed viewer shells] -> The control
 * used to be placed with `position-anchor` + `top: anchor(top); left: anchor(left)`. Two problems
 * make that unusable on layered manga readers (e.g. a full-screen page viewer rendered above the
 * artwork page):
 * 1. Chromium does not update anchor() offsets when an intermediate scroll container scrolls, so a
 *    button anchored to a page inside the viewer stays at the offset of the previously visible page.
 * 2. When the anchor lives inside a fixed overlay, anchor() can resolve against the wrong
 *    coordinate space and stick the control at the viewport origin even though the anchor rect is
 *    correct (verified in Chromium 148 on a real reader page: `left` computed to `0px` while
 *    getBoundingClientRect() reported 604.6px).
 * The control is therefore positioned from `getBoundingClientRect()` in a single shared
 * requestAnimationFrame tracker — the pattern the reference donor extension uses — so it follows
 * nested scrollers, fixed overlays, host layout shifts, and transform animations identically.
 */

/** Horizontal/vertical inset between the image's top-left corner and the control. */
export const CONTROL_INSET_PX = 8;
/** Distance from the viewport top the control must keep while the image scrolls underneath it. */
export const CONTROL_MIN_TOP_PX = 16;
/** Vertical room reserved for the control (32px button + insets and breathing room). */
export const CONTROL_SLOT_PX = 48;

export interface ControlPosition {
  /** Viewport x coordinate for the control's top-left corner. */
  x: number;
  /** Viewport y coordinate for the control's top-left corner. */
  y: number;
}

/**
 * Computes the control's viewport position for a media rect.
 *
 * Tall strips (pages taller than the viewport) keep the control on the image's VISIBLE top edge:
 * it rides the image while scrolling, never leaves the image bounds, and never sits under browser
 * chrome. Fully visible images keep the plain top-left corner placement.
 *
 * @param rect - Rendered rectangle of the media surface being translated.
 * @param viewportHeight - Current viewport height in pixels.
 * @returns Viewport coordinates for the control's top-left corner.
 */
export function computeControlPosition(
  rect: Pick<DOMRect, 'top' | 'bottom' | 'left'>,
  viewportHeight: number
): ControlPosition {
  const shouldClamp = rect.top < CONTROL_MIN_TOP_PX && rect.bottom > CONTROL_MIN_TOP_PX;
  const top = shouldClamp
    ? Math.min(
      Math.max(rect.top, CONTROL_MIN_TOP_PX),
      Math.max(rect.bottom - CONTROL_SLOT_PX, CONTROL_MIN_TOP_PX),
      viewportHeight - CONTROL_SLOT_PX
    )
    : rect.top;
  return { x: rect.left + CONTROL_INSET_PX, y: top + CONTROL_INSET_PX };
}

/**
 * Writes the control's position for a media rect.
 *
 * Uses `transform` rather than `left`/`top` so repeated placement never invalidates layout
 * (composited property), which keeps the tracker's own rect reads cheap.
 *
 * @param control - Floating control element to move.
 * @param rect - Rendered rectangle of the media surface being translated.
 * @returns Nothing.
 */
export function placeControl(control: HTMLElement, rect: DOMRect): void {
  const { x, y } = computeControlPosition(rect, window.innerHeight);
  control.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

type AnchorRectCallback = (rect: DOMRect) => void;

interface AnchorObservation {
  rect: DOMRect;
  callbacks: Set<AnchorRectCallback>;
}

const anchorObservations = new Map<HTMLElement, AnchorObservation>();
let trackerFrameId: number | null = null;

/**
 * Tests whether two renders differ in position or size.
 *
 * @param previous - Last observed rectangle.
 * @param next - Freshly measured rectangle.
 * @returns Whether the control must be repositioned.
 */
function rectChanged(previous: DOMRect, next: DOMRect): boolean {
  return previous.left !== next.left
    || previous.top !== next.top
    || previous.width !== next.width
    || previous.height !== next.height;
}

/**
 * One tracker pass: repositions every subscriber whose anchor moved or resized.
 *
 * @returns Nothing.
 */
function runAnchorTracker(): void {
  for (const [anchor, observation] of anchorObservations) {
    const rect = anchor.getBoundingClientRect();
    if (!rectChanged(rect, observation.rect)) continue;
    observation.rect = rect;
    for (const callback of observation.callbacks) {
      callback(rect);
    }
  }
  trackerFrameId = window.requestAnimationFrame(runAnchorTracker);
}

/**
 * Subscribes to viewport rectangle changes of an anchor element.
 *
 * One shared animation-frame loop serves every mounted control, so persistent mode (a control per
 * image) does not spawn a loop per control. The loop lives only while at least one subscriber
 * exists and is naturally idle in background tabs because requestAnimationFrame is throttled.
 *
 * @param anchor - Element the control is pinned to.
 * @param callback - Invoked with the anchor rect whenever it changes.
 * @returns Unsubscribe function that stops the loop once the last subscriber leaves.
 */
export function observeAnchorRect(anchor: HTMLElement, callback: AnchorRectCallback): () => void {
  let observation = anchorObservations.get(anchor);
  if (!observation) {
    observation = { rect: anchor.getBoundingClientRect(), callbacks: new Set() };
    anchorObservations.set(anchor, observation);
  }
  observation.callbacks.add(callback);
  if (trackerFrameId === null) {
    trackerFrameId = window.requestAnimationFrame(runAnchorTracker);
  }

  return () => {
    const current = anchorObservations.get(anchor);
    if (!current) return;
    current.callbacks.delete(callback);
    if (current.callbacks.size > 0) return;
    anchorObservations.delete(anchor);
    if (anchorObservations.size === 0 && trackerFrameId !== null) {
      window.cancelAnimationFrame(trackerFrameId);
      trackerFrameId = null;
    }
  };
}
