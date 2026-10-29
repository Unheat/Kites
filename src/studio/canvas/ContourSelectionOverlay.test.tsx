// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContourSelectionOverlay } from './ContourSelectionOverlay';
import type { ContourEditorGeometry } from './contourInlineEditing';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Two-line geometry mirroring the contour fixtures (zoomed coordinates). */
const geometry: ContourEditorGeometry = {
  value: 'STAND\nUP',
  lines: ['STAND', 'UP'],
  rects: [
    ...[0, 1, 2, 3, 4].map((i) => ({
      start: i, end: i + 1, x: 90 + i * 20, y: 20, width: 20, height: 48, line: 0,
    })),
    { start: 5, end: 6, x: 190, y: 20, width: 0, height: 48, line: 0 },
    ...[6, 7].map((i) => ({
      start: i, end: i + 1, x: 120 + (i - 6) * 20, y: 68, width: 20, height: 48, line: 1,
    })),
    { start: 8, end: 9, x: 160, y: 68, width: 0, height: 48, line: 1 },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('ContourSelectionOverlay', () => {
  it('paints highlight runs across every line for a full selection', () => {
    const onSelectionChange = vi.fn();
    act(() => {
      root.render(
        <ContourSelectionOverlay
          geometry={geometry}
          selectionStart={0}
          selectionEnd={8}
          onIndexAtPointer={() => 0}
          onSelectionChange={onSelectionChange}
          onFocusEditor={() => {}}
        />,
      );
    });
    const overlay = container.querySelector('[data-testid="contour-selection-overlay"]')!;
    const highlights = Array.from(overlay.children).filter((child) =>
      (child as HTMLElement).style.background);
    const tops = [...new Set(highlights.map((child) => (child as HTMLElement).style.top))];
    // Highlight reaches the second line (the below part Ctrl+A must cover).
    expect(tops).toEqual(expect.arrayContaining(['20px', '68px']));
  });

  it('maps pointer drag to exact editor offsets and keeps the caret visible', () => {
    const onSelectionChange = vi.fn();
    const onIndexAtPointer = vi.fn()
      .mockReturnValueOnce(6)   // pointerdown on the second line's first char
      .mockReturnValueOnce(8);  // drag to its end
    act(() => {
      root.render(
        <ContourSelectionOverlay
          geometry={geometry}
          selectionStart={null}
          selectionEnd={null}
          onIndexAtPointer={onIndexAtPointer}
          onSelectionChange={onSelectionChange}
          onFocusEditor={() => {}}
        />,
      );
    });
    const overlay = container.querySelector('[data-testid="contour-selection-overlay"]')!;
    const down = new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 });
    act(() => { overlay.dispatchEvent(down); });
    act(() => { overlay.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1 })); });
    act(() => { overlay.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); });
    expect(onSelectionChange).toHaveBeenLastCalledWith(6, 8);
    expect(container.querySelector('.contour-caret')).not.toBeNull();
  });

  it('selects the word under a double click', () => {
    const onSelectionChange = vi.fn();
    const onIndexAtPointer = vi.fn().mockReturnValue(7);
    act(() => {
      root.render(
        <ContourSelectionOverlay
          geometry={geometry}
          selectionStart={null}
          selectionEnd={null}
          onIndexAtPointer={onIndexAtPointer}
          onSelectionChange={onSelectionChange}
          onFocusEditor={() => {}}
        />,
      );
    });
    const overlay = container.querySelector('[data-testid="contour-selection-overlay"]')!;
    act(() => { overlay.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(onSelectionChange).toHaveBeenLastCalledWith(6, 8);
  });
});
