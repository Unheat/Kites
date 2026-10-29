import React, { useRef } from 'react';
import type { ContourEditorGeometry } from './contourInlineEditing';
import { wordRangeAt } from './contourInlineEditing';

/** Native-like selection tint over painted contour glyphs. */
const SELECTION_BACKGROUND = 'rgba(59, 130, 246, 0.35)';
/** Caret color matches the editor's signature rose. */
const CARET_COLOR = '#f4446d';

export interface ContourSelectionOverlayProps {
  /** Exact per-character cells derived from the solver placements. */
  geometry: ContourEditorGeometry;
  /** Inclusive selection start in editor offsets, or null when nothing is selected. */
  selectionStart: number | null;
  /** Exclusive selection end in editor offsets, or null when nothing is selected. */
  selectionEnd: number | null;
  /** Resolves the editor offset under a pointer event. */
  onIndexAtPointer: (event: React.PointerEvent | React.MouseEvent) => number;
  /** Reports a new editor selection range. */
  onSelectionChange: (start: number, end: number) => void;
  /** Moves keyboard focus back to the invisible textarea. */
  onFocusEditor: () => void;
}

/**
 * Paints the selection highlight and caret at the Canvas contour's exact scanline geometry
 * and maps pointer gestures to editor offsets, replacing the textarea's uniform-layout
 * selection whose rows drift away from the positioned lines. The invisible textarea keeps
 * keyboard editing; this overlay owns pointer selection.
 * @param props - Geometry, current selection, and editor callbacks.
 * @returns Absolutely-positioned overlay covering the object box.
 */
export const ContourSelectionOverlay: React.FC<ContourSelectionOverlayProps> = ({
  geometry, selectionStart, selectionEnd, onIndexAtPointer, onSelectionChange, onFocusEditor,
}) => {
  const dragAnchorRef = useRef<number | null>(null);

  const rectsFor = (start: number, end: number) =>
    geometry.rects.filter((rect) => rect.start >= start && rect.end <= end && rect.width > 0);

  const caretIndex = selectionEnd ?? 0;
  const caretRect = (() => {
    const cell = geometry.rects.find((rect) => rect.start === caretIndex);
    if (cell) return { x: cell.x, y: cell.y, height: cell.height };
    const last = geometry.rects[geometry.rects.length - 1];
    return last ? { x: last.x + last.width, y: last.y, height: last.height } : null;
  })();

  return (
    <div
      data-testid="contour-selection-overlay"
      style={{ position: 'absolute', inset: 0, zIndex: 36, cursor: 'text' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onFocusEditor();
        const index = onIndexAtPointer(e);
        dragAnchorRef.current = index;
        onSelectionChange(index, index);
        // jsdom lacks pointer capture; real browsers need it for drag-outside continuation.
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch { /* capture unavailable: drag still works inside the overlay */ }
      }}
      onPointerMove={(e) => {
        if (dragAnchorRef.current === null || !(e.buttons & 1)) return;
        e.stopPropagation();
        const index = onIndexAtPointer(e);
        const anchor = dragAnchorRef.current;
        onSelectionChange(Math.min(anchor, index), Math.max(anchor, index));
      }}
      onPointerUp={(e) => {
        if (dragAnchorRef.current === null) return;
        e.stopPropagation();
        dragAnchorRef.current = null;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch { /* nothing captured (jsdom) */ }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const index = onIndexAtPointer(e);
        const { start, end } = wordRangeAt(geometry.value, index);
        dragAnchorRef.current = start;
        onSelectionChange(start, end);
      }}
    >
      <style>{`
        @keyframes contourCaretBlink { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0; } }
        .contour-caret { animation: contourCaretBlink 1.1s step-end infinite; }
      `}</style>
      {selectionStart !== null && selectionEnd !== null && selectionStart < selectionEnd && (() => {
        // Merge adjacent cells into one rectangle per visual run to avoid seam gaps.
        const runs: Array<{ x: number; y: number; width: number; height: number }> = [];
        for (const rect of rectsFor(selectionStart, selectionEnd)) {
          const previous = runs[runs.length - 1];
          if (previous && Math.abs(previous.y - rect.y) < 0.5
            && Math.abs(previous.x + previous.width - rect.x) < 0.5) {
            previous.width += rect.width;
          } else {
            runs.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          }
        }
        return runs.map((run, index) => (
          <div
            key={index}
            style={{
              position: 'absolute', left: run.x, top: run.y,
              width: run.width, height: run.height,
              background: SELECTION_BACKGROUND, borderRadius: 2, pointerEvents: 'none',
            }}
          />
        ));
      })()}
      {caretRect && (
        <div
          className="contour-caret"
          style={{
            position: 'absolute', left: caretRect.x, top: caretRect.y,
            width: 2, height: caretRect.height, background: CARET_COLOR, pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
};
