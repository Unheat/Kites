import React, { useState, useEffect, useRef } from 'react';
import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  CaseUpper,
  Copy,
  Check,
  RotateCcw,
  RotateCw,
  Edit3,
  Languages,
  Type,
  Image as ImageIcon,
  Plus,
  ClipboardPaste,
  Sparkles,
  CircleDot,
} from 'lucide-react';
import type { TypesetMode } from '../../shared/constants';
import { RENDER_FONT_PRESETS } from '../../shared/renderFontPresets';
import { FontPickerDropdown } from '../../shared/ui/FontPickerDropdown';

/** @param stack - CSS font-family stack. @returns First family token, de-quoted, for display/selection. */
function displayFontFamily(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? stack;
  return first.replace(/^['"]|['"]$/g, '') || stack;
}
import { studioStore, useStudioStore, extractTypographyStyle } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
import { applyTextObjectUpdates, CJK_CHARACTER_REGEX, prepareInitialTextObject } from '../canvas/studioTypeset';
import type { TextObject, CharStyleOverride } from '../types';

const SELECTION_ELIGIBLE_KEYS: (keyof CharStyleOverride)[] = [
  'bold',
  'italic',
  'fontFamily',
  'fontSize',
  'color',
  'strokeColor',
  'strokeWidth',
];

/**
 * Applies box-wide typography fields, removing conflicting character overrides.
 * @param object Existing text box and its per-character styling.
 * @param partial Typography fields changed by the user.
 * @param globalMode Editing default used when the box has no local mode.
 * @returns Updated box, reflowed only when its layout-affecting values change.
 */
function applyBoxTypographyUpdate(
  object: TextObject,
  partial: Partial<TextObject>,
  globalMode: TypesetMode,
): TextObject {
  // Object-wide update: if changing a property box-wide, clear overrides for that property in charStyles
  let updatedCharStyles = object.charStyles ? [...object.charStyles] : undefined;
  if (updatedCharStyles?.some(Boolean)) {
    updatedCharStyles = updatedCharStyles.map((style) => {
      if (!style) return null;
      const copy = { ...style };
      for (const key of SELECTION_ELIGIBLE_KEYS) {
        if (key in partial) delete copy[key];
      }
      return Object.keys(copy).length > 0 ? copy : null;
    });
    if (!updatedCharStyles.some(Boolean)) updatedCharStyles = undefined;
  }
  return applyTextObjectUpdates(object, { ...partial, charStyles: updatedCharStyles }, globalMode);
}

/** Renders typography controls; user edits reflow text, while mode choices only set editing intent. */
export const TypographySettings: React.FC = () => {
  const textObjects = useStudioStore((s) => s.textObjects);
  const selectedTextId = useStudioStore((s) => s.selectedTextId);
  const globalEditMode = useStudioStore((s) => s.globalEditMode);
  const globalTypesetMode = useStudioStore((s) => s.globalTypesetMode);
  const originalImage = useStudioStore((s) => s.originalImage);
  const inlineSelection = useStudioStore((s) => s.inlineSelection);

  const selectedObj = textObjects.find((t) => t.id === selectedTextId);
  const effectiveTypesetMode = globalEditMode
    ? globalTypesetMode
    : selectedObj?.typesetMode ?? globalTypesetMode;
  // Contour fitting owns baseline pitch, except vertical CJK columns still consume lineSpacing
  // (recalculateBlockTypeset routes isVertical CJK through the vertical branch before mode).
  const isVerticalCjk = Boolean(selectedObj?.isVertical && CJK_CHARACTER_REGEX.test(selectedObj.text));
  const lineSpacingEffective = effectiveTypesetMode !== 'contour' || isVerticalCjk;

  const clipboardStyle = useStudioStore((s) => s.clipboardStyle);
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedStyle, setCopiedStyle] = useState(false);
  const [isEditingOriginal, setIsEditingOriginal] = useState(false);
  const [showCropPreview, setShowCropPreview] = useState(true);

  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const initialTextObjectsRef = useRef<TextObject[] | null>(null);
  /** Open slider gesture snapshot; one drag/keyboard hold commits a single undo entry. */
  const sliderGestureRef = useRef<{ before: TextObject[] } | null>(null);

  const isSelectionActive = Boolean(
    !globalEditMode &&
    selectedObj &&
    inlineSelection &&
    inlineSelection.textId === selectedObj.id &&
    inlineSelection.start !== inlineSelection.end
  );

  const selStart = inlineSelection ? Math.min(inlineSelection.start, inlineSelection.end) : 0;
  const selEnd = inlineSelection ? Math.max(inlineSelection.start, inlineSelection.end) : 0;
  const currentSelOverride = (isSelectionActive && selectedObj?.charStyles)
    ? selectedObj.charStyles[selStart]
    : null;

  const effectiveBold = currentSelOverride?.bold !== undefined ? currentSelOverride.bold : Boolean(selectedObj?.bold);
  const effectiveItalic = currentSelOverride?.italic !== undefined ? currentSelOverride.italic : Boolean(selectedObj?.italic);
  const effectiveFontFamily = currentSelOverride?.fontFamily || selectedObj?.fontFamily || 'WildWords, CCWildWords, sans-serif';
  const effectiveFontSize = currentSelOverride?.fontSize || selectedObj?.fontSize || 16;
  const effectiveColor = currentSelOverride?.color || selectedObj?.color || '#000000';
  const effectiveStrokeColor = currentSelOverride?.strokeColor || selectedObj?.strokeColor || '#ffffff';
  const effectiveStrokeWidth = currentSelOverride?.strokeWidth !== undefined ? currentSelOverride.strokeWidth : (selectedObj?.strokeWidth || 0);

  const handleCopyStyle = () => {
    if (!selectedObj) return;
    const style = extractTypographyStyle(selectedObj);
    studioStore.setState({ clipboardStyle: style });
    setCopiedStyle(true);
    setTimeout(() => setCopiedStyle(false), 2000);
  };

  /** Pastes clipboard appearance onto selected box using its editing mode; records one undo step. */
  const handlePasteStyle = () => {
    if (!clipboardStyle || !selectedObj) return;
    const prev = [...textObjects];
    // A copied appearance must not replace the destination's chosen editing engine.
    const { typesetMode: _copiedMode, ...style } = clipboardStyle;
    const updated = applyBoxTypographyUpdate(selectedObj, style, globalTypesetMode);

    const next = textObjects.map((t) => (t.id === selectedObj.id ? updated : t));
    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `paste-style-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Paste Typography Style',
      textObjects: { before: prev, after: next },
    });
  };

  // Render crop preview of original manga panel containing the selected text bubble
  useEffect(() => {
    if (!cropCanvasRef.current || !originalImage || !selectedObj || !showCropPreview) return;
    const canvas = cropCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padX = Math.max(16, Math.round(selectedObj.width * 0.15));
    const padY = Math.max(16, Math.round(selectedObj.height * 0.15));
    const sx = Math.max(0, Math.round(selectedObj.x - padX));
    const sy = Math.max(0, Math.round(selectedObj.y - padY));
    const sw = Math.min(originalImage.naturalWidth - sx, Math.round(selectedObj.width + padX * 2));
    const sh = Math.min(originalImage.naturalHeight - sy, Math.round(selectedObj.height + padY * 2));

    if (sw <= 0 || sh <= 0) return;

    canvas.width = sw;
    canvas.height = sh;
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(originalImage, sx, sy, sw, sh, 0, 0, sw, sh);

    // Outline the speech bubble bounds in signature rose
    ctx.strokeStyle = '#f4446d';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(selectedObj.x - sx, selectedObj.y - sy, selectedObj.width, selectedObj.height);
  }, [originalImage, selectedObj, showCropPreview]);

  /**
   * Updates current selection or all boxes, reflowing only layout-affecting changes.
   * @param partial Changed typography or paint fields.
   * @param options Transient updates (drag frames) defer the undo entry to gesture commit.
   * @returns Nothing; updates store and records one undo entry unless transient.
   */
  const updateSelected = (partial: Partial<TextObject>, options: { transient?: boolean } = {}) => {
    const prev = [...textObjects];
    let next: TextObject[];

    if (globalEditMode) {
      next = textObjects.map((obj) => applyBoxTypographyUpdate(obj, partial, globalTypesetMode));
    } else if (selectedObj) {
      const liveSelection = studioStore.getState().inlineSelection;
      const hasActiveSel =
        liveSelection &&
        liveSelection.textId === selectedObj.id &&
        liveSelection.start !== liveSelection.end;

      const hasSelectionEligibleProp = Object.keys(partial).some((k) =>
        SELECTION_ELIGIBLE_KEYS.includes(k as keyof CharStyleOverride)
      );

      if (hasActiveSel && hasSelectionEligibleProp) {
        const start = Math.min(liveSelection.start, liveSelection.end);
        const end = Math.max(liveSelection.start, liveSelection.end);
        const textLen = selectedObj.text.length;
        const charStyles: (CharStyleOverride | null)[] = selectedObj.charStyles
          ? [...selectedObj.charStyles]
          : new Array(textLen).fill(null);
        while (charStyles.length < textLen) charStyles.push(null);

        for (let i = start; i < end && i < textLen; i++) {
          const existing: CharStyleOverride = charStyles[i] ? { ...charStyles[i] } : {};
          for (const key of SELECTION_ELIGIBLE_KEYS) {
            if (key in partial) {
              const val = (partial as any)[key];
              if (val === (selectedObj as any)[key]) {
                delete (existing as any)[key];
              } else {
                (existing as any)[key] = val;
              }
            }
          }
          charStyles[i] = Object.keys(existing).length > 0 ? existing : null;
        }

        const nonSelectionPartial: Partial<TextObject> = {};
        for (const key of Object.keys(partial) as (keyof TextObject)[]) {
          if (!SELECTION_ELIGIBLE_KEYS.includes(key as any)) {
            (nonSelectionPartial as any)[key] = partial[key];
          }
        }

        const updated = applyTextObjectUpdates(selectedObj, {
          ...nonSelectionPartial,
          charStyles: charStyles.some(Boolean) ? charStyles : undefined,
        }, globalTypesetMode);
        next = textObjects.map((obj) => (obj.id === selectedObj.id ? updated : obj));
      } else {
        const updated = applyBoxTypographyUpdate(selectedObj, partial, globalTypesetMode);
        next = textObjects.map((obj) => (obj.id === selectedObj.id ? updated : obj));
      }
    } else {
      return;
    }

    studioStore.setState({ textObjects: next });
    if (options.transient) return;
    studioUndoStack.push({
      id: `text-edit-${Date.now()}`,
      timestamp: Date.now(),
      description: isSelectionActive ? 'Format Selected Text' : 'Update Typography',
      textObjects: { before: prev, after: next },
    });
  };

  /**
   * Opens a slider gesture: snapshots the scene once before the first drag frame so the
   * whole gesture (pointer drag or held arrow key) becomes a single undo entry, matching
   * the canvas drag handles' commit-on-release behavior.
   * @returns Nothing.
   */
  const beginSliderGesture = () => {
    if (!sliderGestureRef.current) {
      sliderGestureRef.current = { before: [...studioStore.getState().textObjects] };
    }
  };

  /**
   * Commits the open slider gesture as one undo entry when the scene actually changed.
   * @returns Nothing.
   */
  const commitSliderGesture = () => {
    const gesture = sliderGestureRef.current;
    sliderGestureRef.current = null;
    if (!gesture) return;
    const current = studioStore.getState().textObjects;
    if (JSON.stringify(gesture.before) === JSON.stringify(current)) return;
    studioUndoStack.push({
      id: `slider-gesture-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Update Typography',
      textObjects: { before: gesture.before, after: current },
    });
  };

  /**
   * Edits dialogue live with dynamic typeset and line reflow in its chosen mode.
   * @param newText Replacement dialogue; the initial snapshot groups keystrokes for undo.
   * @returns Nothing; writes updated dialogue layout to the store.
   */
  const handleTextChange = (newText: string) => {
    if (!initialTextObjectsRef.current) {
      initialTextObjectsRef.current = [...textObjects];
    }
    const next = textObjects.map((t) =>
      t.id === obj.id ? applyTextObjectUpdates(t, { text: newText }, globalTypesetMode) : t
    );
    studioStore.setState({ textObjects: next });
  };

  const handleTextBlur = () => {
    if (initialTextObjectsRef.current) {
      const prev = initialTextObjectsRef.current;
      const current = studioStore.getState().textObjects;
      initialTextObjectsRef.current = null;
      if (JSON.stringify(prev) !== JSON.stringify(current)) {
        studioUndoStack.push({
          id: `text-edit-${Date.now()}`,
          timestamp: Date.now(),
          description: 'Edit Dialogue Text',
          textObjects: { before: prev, after: current },
        });
      }
    }
  };

  /**
   * Changes editing intent without recomputing any current layout.
   * @param newMode Engine for subsequent edits in the active scope.
   * @returns Nothing; global default is session-only and not part of document undo.
   */
  const handleToggleTypesetMode = (newMode: TypesetMode) => {
    const prev = [...textObjects];
    let next: TextObject[];

    if (globalEditMode) {
      // Global editing: set every box's future editing mode, preserving its current pipeline layout.
      next = textObjects.map((t) => applyTextObjectUpdates(t, { typesetMode: newMode }, globalTypesetMode));
    } else if (selectedObj) {
      // Local editing: set ONLY the selected box's future editing mode without fitting it now.
      next = textObjects.map((t) => t.id === selectedObj.id
        ? applyTextObjectUpdates(t, { typesetMode: newMode }, globalTypesetMode)
        : t);
    } else {
      return;
    }

    studioStore.setState({
      textObjects: next,
      ...(globalEditMode ? { globalTypesetMode: newMode } : {}),
    });
    const modeLabels: Record<TypesetMode, string> = {
      contour: 'Bubble Contour',
      balloon: 'Balanced Fit',
      simple: 'Caption Box',
    };
    studioUndoStack.push({
      id: `typeset-mode-${Date.now()}`,
      timestamp: Date.now(),
      description: `Switch Typesetting Mode to ${modeLabels[newMode]}`,
      textObjects: { before: prev, after: next },
    });
  };

  const handleCopyOriginal = () => {
    if (!obj.originalText) return;
    navigator.clipboard.writeText(obj.originalText);
    setCopiedOriginal(true);
    setTimeout(() => setCopiedOriginal(false), 1500);
  };

  const handleUpdateOriginalText = (newOriginal: string) => {
    const prev = [...textObjects];
    const next = textObjects.map((t) =>
      t.id === obj.id ? { ...t, originalText: newOriginal } : t
    );
    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `orig-text-edit-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Update Original OCR Text',
      textObjects: { before: prev, after: next },
    });
  };

  /** Restores original OCR dialogue using current editing mode and records the resulting layout for undo. */
  const handleRevertToOriginal = () => {
    if (!obj.originalText) return;
    const prev = [...textObjects];
    const next = textObjects.map((t) =>
      t.id === obj.id ? applyTextObjectUpdates(t, { text: obj.originalText! }, globalTypesetMode) : t
    );
    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `revert-dialogue-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Revert to Original Text',
      textObjects: { before: prev, after: next },
    });
  };

  /** Clears dialogue and its measured lines together, preserving the editing engine preference. */
  const handleClearText = () => {
    const prev = [...textObjects];
    const next = textObjects.map((t) =>
      t.id === obj.id ? applyTextObjectUpdates(t, { text: '' }, globalTypesetMode) : t
    );
    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `clear-dialogue-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Clear Dialogue Text',
      textObjects: { before: prev, after: next },
    });
  };

  /** Adds manual dialogue with initial Auto Balloon layout; later edits inherit the session default. */
  const handleAddNewEmptyTextBox = () => {
    const id = `bubble-${Date.now()}`;
    const imgW = studioStore.getState().originalImage?.naturalWidth || 800;
    const imgH = studioStore.getState().originalImage?.naturalHeight || 1200;
    const newObj = prepareInitialTextObject({
      id,
      x: Math.round(imgW / 2 - 70),
      y: Math.round(imgH / 2 - 25),
      width: 140,
      height: 50,
      text: 'New Dialogue',
      originalText: undefined,
      fontSize: 18,
      fontFamily: 'WildWords, CCWildWords, sans-serif',
      color: '#000000',
      strokeColor: '#ffffff',
      strokeWidth: 2,
      align: 'center',
      isVertical: false,
    });
    const prev = [...textObjects];
    const next = [...textObjects, newObj];
    studioStore.setState({
      textObjects: next,
      selectedTextId: id,
      editingTextId: null, // Keep canvas transparent directly
      activeTool: 'text',
    });
    studioUndoStack.push({
      id: `add-empty-box-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Add Empty Text Box',
      textObjects: { before: prev, after: next },
    });
  };

  const obj = selectedObj || textObjects[0] || ({} as Partial<TextObject>);

  return (
    <div className="space-y-3.5 text-xs text-slate-200" data-studio-sidebar="true">
      {/* ======================================================== */}
      {/* 0. PERMANENT TOP ACTION BAR: ALWAYS VISIBLE             */}
      {/* ======================================================== */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleAddNewEmptyTextBox}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#f4446d] hover:bg-[#e0355e] text-white text-xs font-semibold shadow-md shadow-[rgba(244,68,109,0.3)] transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Text Box
        </button>
        {selectedObj && (
          <button
            onClick={() => studioStore.setState({ selectedTextId: null, editingTextId: null, inlineSelection: null })}
            title="Deselect text box"
            className="py-2 px-2.5 rounded-lg border border-[#282d3f] bg-[#090a0f] text-slate-400 hover:text-white hover:bg-[#1c1f2e] text-xs font-medium transition cursor-pointer"
          >
            Deselect
          </button>
        )}
      </div>

      {!selectedObj && !globalEditMode ? (
        <div className="p-4 text-center text-xs text-slate-400 space-y-2.5 rounded-xl border border-[#262a3b] bg-[#090a0f]/50">
          <p className="font-medium text-slate-300">No text bubble selected</p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Click any bubble on the canvas to edit its dialogue and style, or enable <strong>Global Edit Mode</strong> to style all bubbles at once.
          </p>
          <button
            onClick={() => studioStore.setState({ globalEditMode: true })}
            className="w-full py-1.5 px-3 rounded-lg border border-[#282d3f] bg-[#1c1f2e] text-[#f4446d] hover:bg-[#282d3f] transition font-medium"
          >
            Enable Global Edit Mode
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between pb-2 border-b border-[#282d3f]">
            <h3 className="font-semibold text-sm text-slate-100">Typography</h3>
            <label className="flex items-center gap-1.5 text-[11px] text-[#f4446d] font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={globalEditMode}
                onChange={(e) => studioStore.setState({ globalEditMode: e.target.checked })}
                className="rounded border-[#282d3f] bg-[#090a0f] text-[#f4446d] focus:ring-0 accent-[#f4446d]"
              />
              All Bubbles
            </label>
          </div>

          {/* Quick Style Clipboard & Skipped Status */}
          {selectedObj && !globalEditMode && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-1.5 p-1.5 rounded-lg bg-[#090a0f] border border-[#262a3b]">
                <button
                  type="button"
                  onClick={handleCopyStyle}
                  title="Copy typography styling (font, color, stroke, shadow, etc.)"
                  className="flex-1 py-1 px-2 rounded text-[11px] font-medium bg-[#1c1f2e] text-slate-200 hover:text-white hover:bg-[#282d3f] border border-[#282d3f] transition flex items-center justify-center gap-1"
                >
                  {copiedStyle ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-indigo-400" />}
                  <span>{copiedStyle ? 'Copied!' : 'Copy Style'}</span>
                </button>
                <button
                  type="button"
                  onClick={handlePasteStyle}
                  disabled={!clipboardStyle}
                  title={clipboardStyle ? "Paste copied typography styling onto this bubble" : "Copy a style first"}
                  className="flex-1 py-1 px-2 rounded text-[11px] font-medium bg-[#1c1f2e] text-slate-200 hover:text-white hover:bg-[#282d3f] border border-[#282d3f] disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-1"
                >
                  <ClipboardPaste className="w-3 h-3 text-indigo-400" />
                  <span>Paste Style</span>
                </button>
              </div>

              {selectedObj.isSkipped && (
                <div className="flex items-center justify-between p-2 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs">
                  <span className="text-[11px]">Filtered out by bubble detector</span>
                  <button
                    type="button"
                    onClick={() => {
                      studioStore.setState({
                        textObjects: textObjects.map((t) => (t.id === selectedObj.id ? { ...t, isSkipped: false } : t)),
                      });
                    }}
                    className="px-2 py-0.5 rounded bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 text-[10px] font-medium transition"
                  >
                    Include Bubble
                  </button>
                </div>
              )}
            </div>
          )}

      {/* ======================================================== */}
      {/* 1. ORIGINAL OCR SOURCE TEXT SECTION                      */}
      {/* ======================================================== */}
      <div className="space-y-1.5 p-2.5 rounded-xl bg-[#090a0f] border border-[#262a3b]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-xs">
            <Languages className="w-3.5 h-3.5 text-[#f4446d]" />
            <span>Original Source (OCR)</span>
          </div>
          <div className="flex items-center gap-1">
            {originalImage && (
              <button
                onClick={() => setShowCropPreview(!showCropPreview)}
                title={showCropPreview ? 'Hide original panel crop' : 'Peek original panel crop'}
                className={`p-1 rounded text-[10px] transition ${
                  showCropPreview ? 'bg-[#1c1f2e] text-[#f4446d]' : 'text-slate-400 hover:text-white'
                }`}
              >
                <ImageIcon className="w-3 h-3" />
              </button>
            )}
            {obj.originalText && (
              <button
                onClick={handleCopyOriginal}
                title="Copy original OCR text"
                className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1c1f2e] text-slate-300 hover:text-white hover:bg-[#282d3f] transition flex items-center gap-1"
              >
                {copiedOriginal ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedOriginal ? 'Copied' : 'Copy'}
              </button>
            )}
            <button
              onClick={() => setIsEditingOriginal(!isEditingOriginal)}
              title={isEditingOriginal ? 'Done editing original OCR' : 'Edit original OCR transcription'}
              className={`p-1 rounded text-[10px] transition ${
                isEditingOriginal
                  ? 'bg-[#f4446d]/20 text-[#f4446d]'
                  : 'text-slate-400 hover:text-white hover:bg-[#1c1f2e]'
              }`}
            >
              <Edit3 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Visual crop preview from original raw manga page */}
        {originalImage && obj.originalText && showCropPreview && (
          <div className="relative rounded-lg overflow-hidden border border-[#262a3b] bg-black/50 my-1.5 flex items-center justify-center">
            <canvas ref={cropCanvasRef} className="max-w-full max-h-24 object-contain" />
          </div>
        )}

        {/* Original text content */}
        {isEditingOriginal ? (
          <textarea
            value={obj.originalText ?? ''}
            onChange={(e) => handleUpdateOriginalText(e.target.value)}
            placeholder="Edit original raw text (e.g. Japanese, Korean)..."
            rows={2}
            className="w-full rounded-lg border border-[#f4446d]/60 bg-[#12141c] p-2 text-xs text-slate-200 focus:outline-hidden resize-none font-sans"
          />
        ) : (
          <div className="p-2 rounded-lg bg-[#12141c]/70 border border-[#262a3b]/60 text-xs text-slate-300 max-h-24 overflow-y-auto select-text leading-relaxed font-sans">
            {obj.originalText ? (
              obj.originalText
            ) : (
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span className="italic">None (Manual text box)</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1c1f2e] text-slate-500 font-mono">
                  No source OCR
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* 2. TRANSLATION / DIALOGUE EDITOR TEXTAREA                */}
      {/* ======================================================== */}
      <div className="space-y-1.5 p-2.5 rounded-xl bg-[#090a0f] border border-[#262a3b]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-xs">
            <Type className="w-3.5 h-3.5 text-[#f4446d]" />
            <span>Dialogue Text</span>
          </div>
          <div className="flex items-center gap-1">
            {obj.originalText && (
              <button
                onClick={handleRevertToOriginal}
                title="Reset dialogue to original OCR text"
                className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1c1f2e] text-slate-400 hover:text-white hover:bg-[#282d3f] transition flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Revert
              </button>
            )}
            <button
              onClick={handleClearText}
              title="Clear dialogue text"
              className="px-1.5 py-0.5 rounded text-[10px] text-slate-400 hover:text-[#f4446d] hover:bg-[#1c1f2e] transition"
            >
              Clear
            </button>
          </div>
        </div>

        <textarea
          value={obj.text ?? ''}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleTextBlur}
          onSelect={(e) => {
            const el = e.target as HTMLTextAreaElement;
            studioStore.setState({
              inlineSelection: {
                textId: obj.id,
                start: el.selectionStart,
                end: el.selectionEnd,
              },
            });
          }}
          onKeyUp={(e) => {
            const el = e.target as HTMLTextAreaElement;
            studioStore.setState({
              inlineSelection: {
                textId: obj.id,
                start: el.selectionStart,
                end: el.selectionEnd,
              },
            });
          }}
          onMouseUp={(e) => {
            const el = e.target as HTMLTextAreaElement;
            studioStore.setState({
              inlineSelection: {
                textId: obj.id,
                start: el.selectionStart,
                end: el.selectionEnd,
              },
            });
          }}
          placeholder="Type translation dialogue here..."
          rows={3}
          className="w-full rounded-lg border border-[#262a3b] bg-[#12141c] p-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-[#f4446d] focus:outline-hidden transition resize-y min-h-[64px] max-h-48 leading-relaxed font-sans"
        />

        {isSelectionActive && (
          <div className="flex items-center justify-between text-[11px] text-[#f4446d] bg-[#f4446d]/10 px-2.5 py-1.5 rounded-lg border border-[#f4446d]/20 animate-in fade-in duration-150">
            <span className="truncate max-w-[210px] font-medium">
              Formatting selection: "{obj.text?.slice(selStart, selEnd)}"
            </span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => studioStore.setState({ inlineSelection: null })}
              className="text-[10px] text-slate-400 hover:text-white shrink-0 ml-1 underline cursor-pointer"
            >
              Deselect
            </button>
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
          <span>
            {(obj.text || '').length} chars • {(obj.text || '').split('\n').filter(Boolean).length || 1} lines
          </span>
          <span className="text-slate-500 text-[10px]">Updates canvas live</span>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. TYPOGRAPHY CONTROLS (Font, Size, Align, Color)        */}
      {/* ======================================================== */}

      {/* Typesetting Mode Toggle */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-slate-400 font-medium">Typesetting Engine</label>
          <span className="text-[10px] text-slate-500 font-mono">
            {globalEditMode ? 'Global (All Bubbles)' : 'Local (Selected)'}
          </span>
        </div>
        <div className="flex p-0.5 rounded-lg bg-[#090a0f] border border-[#282d3f] text-xs">
          <button
            type="button"
            onClick={() => handleToggleTypesetMode('contour')}
            className={`flex-1 py-1.5 px-1.5 rounded-md font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer text-[11px] ${
              effectiveTypesetMode === 'contour'
                ? 'bg-[#1c1f2e] text-[#f4446d] shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Bubble Contour: 2D scanline engine fitted to speech bubble curves and ovals with dynamic font sizing (Koharu engine)"
          >
            <CircleDot size={12} className={effectiveTypesetMode === 'contour' ? 'text-[#f4446d]' : ''} />
            <span className="truncate">Bubble Contour</span>
          </button>
          <button
            type="button"
            onClick={() => handleToggleTypesetMode('balloon')}
            className={`flex-1 py-1.5 px-1.5 rounded-md font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer text-[11px] ${
              effectiveTypesetMode === 'balloon'
                ? 'bg-[#1c1f2e] text-[#f4446d] shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Balanced Fit: Balances dialogue line lengths into diamond envelopes with auto font scaling (Cotrans / XianScan engine)"
          >
            <Sparkles size={12} className={effectiveTypesetMode === 'balloon' ? 'text-[#f4446d]' : ''} />
            <span className="truncate">Balanced Fit</span>
          </button>
          <button
            type="button"
            onClick={() => handleToggleTypesetMode('simple')}
            className={`flex-1 py-1.5 px-1.5 rounded-md font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer text-[11px] ${
              effectiveTypesetMode === 'simple'
                ? 'bg-[#1c1f2e] text-[#f4446d] shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Caption Box: Fixed font rectangular text wrap for square caption and narration panels"
          >
            <AlignLeft size={12} className={effectiveTypesetMode === 'simple' ? 'text-[#f4446d]' : ''} />
            <span className="truncate">Caption Box</span>
          </button>
        </div>
        {selectedObj?.originalContourPoints && selectedObj?.detectedWidth && selectedObj?.detectedHeight &&
          (Math.round(selectedObj.width) !== Math.round(selectedObj.detectedWidth) || Math.round(selectedObj.height) !== Math.round(selectedObj.detectedHeight)) && (
          <button
            type="button"
            onClick={() => {
              if (!selectedObj.originalContourPoints || !selectedObj.detectedWidth || !selectedObj.detectedHeight) return;
              updateSelected({
                width: selectedObj.detectedWidth,
                height: selectedObj.detectedHeight,
                contourPoints: [...selectedObj.originalContourPoints],
              });
            }}
            className="mt-2 w-full py-1 px-2 rounded-md border border-[#282d3f] bg-[#12151f] hover:bg-[#1a1e2d] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5 text-[11px] cursor-pointer"
            title="Reset frame dimensions and contour back to the detected bubble (Koharu Reset)"
          >
            <RotateCcw size={12} className="text-[#38bdf8]" />
            <span>Reset to Bubble Frame</span>
          </button>
        )}
        <p className="mt-1 text-[10px] text-slate-500">
          Applies when you edit text or typography. Existing layout stays unchanged until then.
        </p>
      </div>

      {/* Font Family — shared picker: presets, on-demand catalog, and user imports */}
      <div>
        <label className="block text-slate-400 font-medium mb-1">Font Family</label>
        <FontPickerDropdown
          ariaLabel="Font Family"
          variant="studio"
          selection={RENDER_FONT_PRESETS.some((preset) => preset.fontFamily === effectiveFontFamily)
            ? { type: 'preset', presetId: RENDER_FONT_PRESETS.find((preset) => preset.fontFamily === effectiveFontFamily)!.id }
            : { type: 'family', family: displayFontFamily(effectiveFontFamily) }}
          onSelect={(sel) => {
            updateSelected({
              fontFamily: sel.type === 'preset'
                ? (RENDER_FONT_PRESETS.find((preset) => preset.id === sel.presetId)?.fontFamily ?? effectiveFontFamily)
                : sel.family,
            });
          }}
        />
      </div>

      {/* Font Size & Spacing */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Size</span>
            <span className="font-mono text-slate-200">{effectiveFontSize}px</span>
          </div>
          <input
            type="range"
            min="8"
            max="120"
            value={effectiveFontSize}
            onPointerDown={beginSliderGesture}
            onChange={(e) => {
              beginSliderGesture();
              updateSelected({ fontSize: Number(e.target.value) }, { transient: true });
            }}
            onPointerUp={commitSliderGesture}
            onPointerCancel={commitSliderGesture}
            onBlur={commitSliderGesture}
            onKeyUp={(e) => { if (!e.repeat) commitSliderGesture(); }}
            className="w-full accent-[#f4446d]"
          />
        </div>
        <div>
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Line Space</span>
            <span className="font-mono text-slate-200">
              {lineSpacingEffective ? (obj.lineSpacing || 1.2).toFixed(1) + 'x' : '1.2x'}
            </span>
          </div>
          <input
            type="range"
            min="0.8"
            max="2.5"
            step="0.1"
            value={obj.lineSpacing || 1.2}
            disabled={!lineSpacingEffective}
            title={lineSpacingEffective
              ? undefined
              : 'Contour typesetting fits lines to the bubble shape; line spacing stays at the engine default.'}
            onPointerDown={beginSliderGesture}
            onChange={(e) => {
              beginSliderGesture();
              updateSelected({ lineSpacing: Number(e.target.value) }, { transient: true });
            }}
            onPointerUp={commitSliderGesture}
            onPointerCancel={commitSliderGesture}
            onBlur={commitSliderGesture}
            onKeyUp={(e) => { if (!e.repeat) commitSliderGesture(); }}
            className="w-full accent-[#f4446d] disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>
      </div>
      {!lineSpacingEffective && (
        <p className="text-[11px] text-slate-500 -mt-1">
          Line spacing is fixed while Contour typesetting fits text to the bubble outline.
        </p>
      )}

      {/* Formatting & Alignment */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => updateSelected({ bold: !effectiveBold })}
          className={`p-2 rounded-lg border transition ${
            effectiveBold
              ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Bold"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => updateSelected({ italic: !effectiveItalic })}
          className={`p-2 rounded-lg border transition ${
            effectiveItalic
              ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Italic"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => updateSelected({ uppercase: !obj.uppercase, lowercase: false })}
          className={`p-2 rounded-lg border transition ${
            obj.uppercase
              ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Uppercase"
        >
          <CaseUpper className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => updateSelected({ align: 'left' })}
          className={`p-2 rounded-lg border transition ${
            obj.align === 'left'
              ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Align Left"
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => updateSelected({ align: 'center' })}
          className={`p-2 rounded-lg border transition ${
            obj.align === 'center' || !obj.align
              ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Align Center"
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => updateSelected({ align: 'right' })}
          className={`p-2 rounded-lg border transition ${
            obj.align === 'right'
              ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Align Right"
        >
          <AlignRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* CJK Vertical Layout Toggle */}
      <div className="flex items-center justify-between p-2 rounded-lg bg-[#090a0f] border border-[#282d3f]">
        <div>
          <span className="font-medium text-slate-200">CJK Vertical Layout</span>
          <p className="text-[11px] text-slate-500">Top-to-bottom right-to-left columns</p>
        </div>
        <input
          type="checkbox"
          checked={obj.isVertical || false}
          onChange={(e) => updateSelected({ isVertical: e.target.checked })}
          className="rounded border-[#282d3f] bg-[#12141c] text-[#f4446d] focus:ring-0 accent-[#f4446d]"
        />
      </div>

      {/* Rotation & Angle */}
      <div className="space-y-1.5 p-2 rounded-lg bg-[#090a0f] border border-[#282d3f]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-300 font-medium">
            <RotateCw className="w-3.5 h-3.5 text-[#f4446d]" />
            <span>Rotation Angle</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-slate-200">{obj.rotation || 0}°</span>
            {obj.rotation !== undefined && obj.rotation !== 0 && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateSelected({ rotation: 0 })}
                title="Reset angle to 0° (flat)"
                className="px-1.5 py-0.5 rounded text-[10px] bg-[#1c1f2e] text-slate-400 hover:text-white transition"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={obj.rotation || 0}
            onPointerDown={beginSliderGesture}
            onChange={(e) => {
              beginSliderGesture();
              updateSelected({ rotation: Number(e.target.value) }, { transient: true });
            }}
            onPointerUp={commitSliderGesture}
            onPointerCancel={commitSliderGesture}
            onBlur={commitSliderGesture}
            onKeyUp={(e) => { if (!e.repeat) commitSliderGesture(); }}
            className="flex-1 accent-[#f4446d]"
          />
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                let deg = (obj.rotation || 0) - 90;
                deg = ((((deg % 360) + 540) % 360) - 180);
                updateSelected({ rotation: deg });
              }}
              title="Rotate -90°"
              className="px-1.5 py-0.5 rounded bg-[#1c1f2e] border border-[#282d3f] text-slate-300 hover:text-white text-[10px] font-mono transition"
            >
              -90°
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                let deg = (obj.rotation || 0) + 90;
                deg = ((((deg % 360) + 540) % 360) - 180);
                updateSelected({ rotation: deg });
              }}
              title="Rotate +90°"
              className="px-1.5 py-0.5 rounded bg-[#1c1f2e] border border-[#282d3f] text-slate-300 hover:text-white text-[10px] font-mono transition"
            >
              +90°
            </button>
          </div>
        </div>
      </div>

      {/* Text Color & Gradient */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-slate-400 font-medium">Text Fill Color</label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={obj.isGradient || false}
              onChange={(e) => updateSelected({ isGradient: e.target.checked })}
              className="rounded border-[#282d3f] bg-[#090a0f] text-[#f4446d] focus:ring-0 accent-[#f4446d]"
            />
            Linear Gradient
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={effectiveColor}
            onChange={(e) => updateSelected({ color: e.target.value })}
            className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
          />
          {obj.isGradient && (
            <input
              type="color"
              value={obj.color2 || '#ef4444'}
              onChange={(e) => updateSelected({ color2: e.target.value })}
              className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
            />
          )}
          <input
            type="text"
            value={effectiveColor}
            onChange={(e) => updateSelected({ color: e.target.value })}
            className="flex-1 rounded-lg border border-[#282d3f] bg-[#090a0f] px-2 py-1 font-mono text-slate-200"
          />
        </div>
      </div>

      {/* Stroke Outline & Drop Shadow Angle Dial */}
      <div className="space-y-2 pt-2 border-t border-[#282d3f]">
        <div className="flex justify-between text-slate-400">
          <span className="font-medium">Outline Stroke</span>
          <span className="font-mono text-slate-200">{effectiveStrokeWidth}px</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={effectiveStrokeColor}
            onChange={(e) => updateSelected({ strokeColor: e.target.value })}
            className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
          />
          <input
            type="range"
            min="0"
            max="20"
            value={effectiveStrokeWidth}
            onChange={(e) => updateSelected({ strokeWidth: Number(e.target.value) })}
            className="flex-1 accent-[#f4446d]"
          />
        </div>

        {/* Shadow distance & angle */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Shadow Offset</span>
              <span className="font-mono text-slate-200">{obj.shadowDistance || 0}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="25"
              value={obj.shadowDistance || 0}
              onChange={(e) => updateSelected({ shadowDistance: Number(e.target.value) })}
              className="w-full accent-[#f4446d]"
            />
          </div>
          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Shadow Angle</span>
              <span className="font-mono text-slate-200">{obj.shadowAngle || 45}°</span>
            </div>
            <input
              type="range"
              min="0"
              max="360"
              value={obj.shadowAngle || 45}
              onChange={(e) => updateSelected({ shadowAngle: Number(e.target.value) })}
              className="w-full accent-[#f4446d]"
            />
          </div>
        </div>
      </div>

      {/* Bubble Background Fill Box */}
      <div className="space-y-2 pt-2 border-t border-[#282d3f]">
        <label className="block text-slate-400 font-medium">Bubble Background Box</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={obj.backgroundFill && obj.backgroundFill !== 'transparent' ? obj.backgroundFill : '#ffffff'}
            onChange={(e) => updateSelected({ backgroundFill: e.target.value })}
            className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
          />
          <button
            onClick={() => updateSelected({ backgroundFill: 'transparent' })}
            className="px-2.5 py-1 rounded-md border border-[#282d3f] bg-[#090a0f] text-slate-400 hover:text-white"
          >
            Clear Fill
          </button>
        </div>
        {obj.backgroundFill && obj.backgroundFill !== 'transparent' && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>Padding</span>
                <span className="font-mono text-slate-200">{obj.backgroundPadding || 4}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                value={obj.backgroundPadding || 4}
                onChange={(e) => updateSelected({ backgroundPadding: Number(e.target.value) })}
                className="w-full accent-[#f4446d]"
              />
            </div>
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>Corner Radius</span>
                <span className="font-mono text-slate-200">{obj.backgroundBorderRadius || 0}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={obj.backgroundBorderRadius || 0}
                onChange={(e) => updateSelected({ backgroundBorderRadius: Number(e.target.value) })}
                className="w-full accent-[#f4446d]"
              />
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
};
