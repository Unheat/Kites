// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTROL_INSET_PX,
  CONTROL_MIN_TOP_PX,
  CONTROL_SLOT_PX,
  computeControlPosition,
  observeAnchorRect,
  placeControl,
} from './overlayPlacement';

/**
 * Builds a minimal rect-shaped object for placement math.
 *
 * @param top - Viewport top edge.
 * @param bottom - Viewport bottom edge.
 * @param left - Viewport left edge.
 * @returns Rect fragment accepted by computeControlPosition.
 */
function rect(top: number, bottom: number, left: number): Pick<DOMRect, 'top' | 'bottom' | 'left'> {
  return { top, bottom, left };
}

describe('control placement math', () => {
  it('pins the control to the image top-left corner when the whole image is on screen', () => {
    expect(computeControlPosition(rect(120, 820, 400), 1000))
      .toEqual({ x: 400 + CONTROL_INSET_PX, y: 120 + CONTROL_INSET_PX });
  });

  it('rides the visible top edge of a tall strip scrolled past the viewport top', () => {
    // Image starts 5000px above the viewport but still covers it: the control must sit at the
    // viewport inset instead of scrolling out of reach with the image's real top edge.
    expect(computeControlPosition(rect(-5000, 900, 30), 1000))
      .toEqual({ x: 30 + CONTROL_INSET_PX, y: CONTROL_MIN_TOP_PX + CONTROL_INSET_PX });
  });

  it('never leaves the image bounds when the image is shorter than the reserved slot', () => {
    const position = computeControlPosition(rect(-500, 20, 10), 1000);
    expect(position.y).toBe(CONTROL_MIN_TOP_PX + CONTROL_INSET_PX);
  });

  it('never floats below the viewport on short viewports', () => {
    const viewportHeight = 30;
    const position = computeControlPosition(rect(-900, 2000, 0), viewportHeight);
    expect(position.y).toBe(viewportHeight - CONTROL_SLOT_PX + CONTROL_INSET_PX);
  });

  it('keeps an image that is fully above the viewport on its own rect (no floating control)', () => {
    expect(computeControlPosition(rect(-300, -20, 50), 1000).y).toBe(-300 + CONTROL_INSET_PX);
  });

  it('places the control with a composited transform', () => {
    const control = document.createElement('div');
    vi.spyOn(control, 'getBoundingClientRect');
    placeControl(control, { ...rect(100, 500, 200), width: 300, height: 400 } as DOMRect);
    expect(control.style.transform).toBe('translate3d(208px, 108px, 0)');
  });
});

describe('shared anchor rect tracker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies subscribers only when the anchor rect changes and stops after unsubscribe', async () => {
    const anchor = document.createElement('img');
    document.body.append(anchor);
    let left = 10;
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({
      x: left, y: 0, top: 0, left, right: left + 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}),
    }) as DOMRect);

    const callback = vi.fn();
    const unsubscribe = observeAnchorRect(anchor, callback);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(callback).not.toHaveBeenCalled();

    left = 60;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toMatchObject({ left: 60 });

    left = 120;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();
    left = 200;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
