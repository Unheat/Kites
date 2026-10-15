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
  Edit3,
  Languages,
  Type,
  Image as ImageIcon,
  Plus,
  ClipboardPaste,
} from 'lucide-react';
import { studioStore, useStudioStore, extractTypographyStyle } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
import { recalculateBlockTypeset } from '../canvas/studioTypeset';
import type { TextObject } from '../types';

export const TypographySettings: React.FC = () => {
  const textObjects = useStudioStore((s) => s.textObjects);
  const selectedTextId = useStudioStore((s) => s.selectedTextId);
  const globalEditMode = useStudioStore((s) => s.globalEditMode);
  const originalImage = useStudioStore((s) => s.originalImage);

  const selectedObj = textObjects.find((t) => t.id === selectedTextId);

  const clipboardStyle = useStudioStore((s) => s.clipboardStyle);
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedStyle, setCopiedStyle] = useState(false);
  const [isEditingOriginal, setIsEditingOriginal] = useState(false);
  const [showCropPreview, setShowCropPreview] = useState(true);

  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const initialTextObjectsRef = useRef<TextObject[] | null>(null);

  const handleCopyStyle = () => {
    if (!selectedObj) return;
    const style = extractTypographyStyle(selectedObj);
    studioStore.setState({ clipboardStyle: style });
    setCopiedStyle(true);
    setTimeout(() => setCopiedStyle(false), 2000);
  };

  const handlePasteStyle = () => {
    if (!clipboardStyle || !selectedObj) return;
    const prev = [...textObjects];
    const updated = { ...selectedObj, ...clipboardStyle };
    const typeset = recalculateBlockTypeset(
      updated.text,
      updated.fontFamily,
      updated.width,
      updated.height,
      updated.fontSize
    );
    updated.lines = typeset.lines;

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

  const updateSelected = (partial: Partial<TextObject>) => {
    const prev = [...textObjects];
    let next: TextObject[];

    if (globalEditMode) {
      next = textObjects.map((obj) => ({ ...obj, ...partial }));
    } else if (selectedObj) {
      next = textObjects.map((obj) => (obj.id === selectedObj.id ? { ...obj, ...partial } : obj));
    } else {
      return;
    }

    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `text-edit-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Update Typography',
      textObjects: { before: prev, after: next },
    });
  };

  // Dialogue text editing handlers with dynamic typeset & line reflow
  const handleTextChange = (newText: string) => {
    if (!initialTextObjectsRef.current) {
      initialTextObjectsRef.current = [...textObjects];
    }
    const typeset = recalculateBlockTypeset(
      newText,
      obj.fontFamily || 'sans-serif',
      obj.width || 140,
      obj.height || 50,
      obj.fontSize || 16
    );
    const next = textObjects.map((t) =>
      t.id === obj.id
        ? {
            ...t,
            text: newText,
            fontSize: typeset.fontSize,
            lines: typeset.lines,
          }
        : t
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

  const handleRevertToOriginal = () => {
    if (!obj.originalText) return;
    const prev = [...textObjects];
    const next = textObjects.map((t) =>
      t.id === obj.id ? { ...t, text: obj.originalText!, lines: undefined } : t
    );
    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `revert-dialogue-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Revert to Original Text',
      textObjects: { before: prev, after: next },
    });
  };

  const handleClearText = () => {
    const prev = [...textObjects];
    const next = textObjects.map((t) =>
      t.id === obj.id ? { ...t, text: '', lines: undefined } : t
    );
    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `clear-dialogue-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Clear Dialogue Text',
      textObjects: { before: prev, after: next },
    });
  };

  const handleAddNewEmptyTextBox = () => {
    const id = `bubble-${Date.now()}`;
    const imgW = studioStore.getState().originalImage?.naturalWidth || 800;
    const imgH = studioStore.getState().originalImage?.naturalHeight || 1200;
    const newObj: TextObject = {
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
    };
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
    <div className="space-y-3.5 text-xs text-slate-200">
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
            onClick={() => studioStore.setState({ selectedTextId: null, editingTextId: null })}
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
          placeholder="Type translation dialogue here..."
          rows={3}
          className="w-full rounded-lg border border-[#262a3b] bg-[#12141c] p-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-[#f4446d] focus:outline-hidden transition resize-y min-h-[64px] max-h-48 leading-relaxed font-sans"
        />

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

      {/* Font Family */}
      <div>
        <label className="block text-slate-400 font-medium mb-1">Font Family</label>
        <select
          value={obj.fontFamily || 'WildWords'}
          onChange={(e) => updateSelected({ fontFamily: e.target.value })}
          className="w-full rounded-lg border border-[#282d3f] bg-[#090a0f] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden"
        >
          <option value="WildWords, CCWildWords, sans-serif">CC Wild Words (Comic)</option>
          <option value="Kalam, cursive">Kalam (Manga Dialogue)</option>
          <option value="Figtree, sans-serif">Figtree (Modern Clean)</option>
          <option value="Comic Sans MS, cursive">Comic Sans (Classic)</option>
          <option value="Impact, sans-serif">Impact (Action SFX)</option>
          <option value="sans-serif">System Sans-Serif</option>
        </select>
      </div>

      {/* Font Size & Spacing */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Size</span>
            <span className="font-mono text-slate-200">{obj.fontSize || 16}px</span>
          </div>
          <input
            type="range"
            min="8"
            max="120"
            value={obj.fontSize || 16}
            onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })}
            className="w-full accent-[#f4446d]"
          />
        </div>
        <div>
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Line Space</span>
            <span className="font-mono text-slate-200">{(obj.lineSpacing || 1.2).toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.8"
            max="2.5"
            step="0.1"
            value={obj.lineSpacing || 1.2}
            onChange={(e) => updateSelected({ lineSpacing: Number(e.target.value) })}
            className="w-full accent-[#f4446d]"
          />
        </div>
      </div>

      {/* Formatting & Alignment */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => updateSelected({ bold: !obj.bold })}
          className={`p-2 rounded-lg border transition ${
            obj.bold
              ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Bold"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => updateSelected({ italic: !obj.italic })}
          className={`p-2 rounded-lg border transition ${
            obj.italic
              ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Italic"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
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
            value={obj.color || '#000000'}
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
            value={obj.color || '#000000'}
            onChange={(e) => updateSelected({ color: e.target.value })}
            className="flex-1 rounded-lg border border-[#282d3f] bg-[#090a0f] px-2 py-1 font-mono text-slate-200"
          />
        </div>
      </div>

      {/* Stroke Outline & Drop Shadow Angle Dial */}
      <div className="space-y-2 pt-2 border-t border-[#282d3f]">
        <div className="flex justify-between text-slate-400">
          <span className="font-medium">Outline Stroke</span>
          <span className="font-mono text-slate-200">{obj.strokeWidth || 0}px</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={obj.strokeColor || '#ffffff'}
            onChange={(e) => updateSelected({ strokeColor: e.target.value })}
            className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
          />
          <input
            type="range"
            min="0"
            max="20"
            value={obj.strokeWidth || 0}
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
