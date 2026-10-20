import React, { useState, useEffect, useRef } from 'react';
import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Search,
  FileText,
  Type,
  Keyboard,
  Palette,
  Save,
  ChevronDown,
  Eye,
  EyeOff,
  Sparkles,
  Eraser,
  Brush,
  ScanText,
  Maximize2,
  Image as ImageIcon,
  RotateCcw,
  Loader,
  Info,
  Download,
  Copy,
  Check,
} from 'lucide-react';
import { db } from '../db';
import { studioStore, useStudioStore } from './state/studioStore';
import { studioUndoStack } from './state/undoStack';
import { requestStudioOcr } from './bridge/offscreenStudioBridge';
import {
  renderFullCompositeCanvas,
  downloadCanvasAsFile,
  copyCanvasToClipboard,
} from './canvas/compositeExport';
import {
  calculateFitWidth,
  calculateFitHeight,
  calculateFitWindow,
} from './canvas/CanvasViewport';
import { StudioCanvas } from './canvas/StudioCanvas';
import { prepareInitialTextObject } from './canvas/studioTypeset';
import { EraseSettings } from './tools/EraseSettings';
import { PaintSettings } from './tools/PaintSettings';
import { InpaintSettings } from './tools/InpaintSettings';
import { OcrSettings } from './tools/OcrSettings';
import { TypographySettings } from './tools/TypographySettings';
import { WarpSettings } from './tools/WarpSettings';
import { ImageLayerSettings } from './tools/ImageLayerSettings';
import { PageInfoSettings } from './tools/PageInfoSettings';
import { FindReplaceModal } from './modals/FindReplaceModal';
import { ExportTranscriptModal } from './modals/ExportTranscriptModal';
import { ShortcutsModal } from './modals/ShortcutsModal';
import { FontManagerModal } from './modals/FontManagerModal';
import { AppearanceSettingsModal } from './modals/AppearanceSettingsModal';
import type { BoundedDirtyRectPatch, ImageLayer, StudioTool, TextObject } from './types';

export interface StudioProps {
  jobId?: number;
  originalImage: HTMLImageElement | null;
  cleanedImage: HTMLImageElement | null;
  initialTextObjects?: TextObject[];
  jobTitle?: string;
  onSave?: (savedImageBlob: Blob, textObjects: TextObject[]) => Promise<void>;
  onBack?: () => void;
  /** Queues an uploaded page through App's persisted full translation pipeline. */
  onUploadPage?: (file: File) => Promise<void>;
  isUploadingPage?: boolean;
}

// Stable fallback prevents resetting editor state on unrelated renders without initial objects.
const EMPTY_TEXT_OBJECTS: TextObject[] = [];

const TOOLS: { id: StudioTool; label: string; icon: React.ComponentType<{ className?: string }>; shortcut: string }[] = [
  { id: 'text', label: 'Text & Typography', icon: Type, shortcut: 'T' },
  { id: 'erase', label: 'Restore / Erase Brush', icon: Eraser, shortcut: 'Ctrl+1' },
  { id: 'paint', label: 'Freehand Paint Brush', icon: Brush, shortcut: 'Ctrl+2' },
  { id: 'inpaint', label: 'Local AI Inpaint', icon: Sparkles, shortcut: 'Ctrl+3' },
  { id: 'ocr', label: 'Manual Translate OCR', icon: ScanText, shortcut: 'Ctrl+4' },
  { id: 'warp', label: 'Warp & Perspective', icon: Maximize2, shortcut: 'Ctrl+5' },
  { id: 'image', label: 'Stickers & Layers', icon: ImageIcon, shortcut: 'Ctrl+6' },
];

export const Studio: React.FC<StudioProps> = ({
  jobId,
  originalImage,
  cleanedImage,
  initialTextObjects = EMPTY_TEXT_OBJECTS,
  jobTitle = 'Manga Page',
  onSave,
  onBack,
  onUploadPage,
  isUploadingPage = false,
}) => {
  const activeTool = useStudioStore((s) => s.activeTool);
  const isInfoPanelOpen = useStudioStore((s) => s.isInfoPanelOpen);
  const zoom = useStudioStore((s) => s.zoom);
  const viewMode = useStudioStore((s) => s.viewMode ?? (s.isShowingOriginal ? 'original' : 'translated'));
  const hideBoxes = useStudioStore((s) => s.hideBoxes);
  const activeModal = useStudioStore((s) => s.activeModal);
  const globalEditMode = useStudioStore((s) => s.globalEditMode);
  const textObjects = useStudioStore((s) => s.textObjects);
  const imageLayers = useStudioStore((s) => s.imageLayers);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoomDropdownOpen, setZoomDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRetranslating, setIsRetranslating] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [copiedImageToast, setCopiedImageToast] = useState(false);

  const exportDropdownRef = useRef<HTMLDivElement | null>(null);
  const zoomDropdownRef = useRef<HTMLDivElement | null>(null);

  // Close dropdowns on click outside or Escape key
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setExportDropdownOpen(false);
      }
      if (zoomDropdownRef.current && !zoomDropdownRef.current.contains(target)) {
        setZoomDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExportDropdownOpen(false);
        setZoomDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const imageWidth = originalImage?.naturalWidth || cleanedImage?.naturalWidth || 800;
  const imageHeight = originalImage?.naturalHeight || cleanedImage?.naturalHeight || 1200;

  // Synchronize originalImage into studioStore
  useEffect(() => {
    studioStore.setState({ originalImage });
  }, [originalImage]);

  // Initialize text objects
  useEffect(() => {
    // An uploaded page starts without blocks; clear the previous page's text too.
    // Keep pipeline/persisted lines exact; only legacy objects missing layout need preparation.
    studioStore.setState({ textObjects: initialTextObjects.map(prepareInitialTextObject) });
  }, [initialTextObjects]);

  // Subscribe to undo stack updates
  useEffect(() => {
    (studioUndoStack as any).listeners = {
      onStackChange: (u: boolean, r: boolean) => {
        setCanUndo(u);
        setCanRedo(r);
      },
    };
    return () => {
      (studioUndoStack as any).listeners = {};
    };
  }, []);

  // Studio Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        handleRedo();
      } else if (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 't') {
        studioStore.setState({ activeTool: 'text', isInfoPanelOpen: false });
      } else if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey) {
        studioStore.setState((s) => ({ isInfoPanelOpen: !s.isInfoPanelOpen }));
      } else if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'erase', isInfoPanelOpen: false });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '2') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'paint', isInfoPanelOpen: false });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '3') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'inpaint', isInfoPanelOpen: false });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '4') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'ocr', isInfoPanelOpen: false });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '5') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'warp', isInfoPanelOpen: false });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '6') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'image', isInfoPanelOpen: false });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getWorkingCanvas = (): HTMLCanvasElement | null => {
    return (
      document.querySelector('canvas[data-studio-working-background="true"]') ||
      document.querySelector('#studio-working-background') ||
      document.querySelectorAll('canvas')[1] ||
      document.querySelector('canvas')
    );
  };

  const handleUndo = () => {
    studioUndoStack.undo({
      applyRasterPatch: (patch: BoundedDirtyRectPatch) => {
        const canvas = getWorkingCanvas();
        const ctx = canvas?.getContext('2d');
        if (ctx) ctx.putImageData(patch.patchImageData, patch.x, patch.y);
      },
      applyTextObjects: (objs: TextObject[]) => {
        studioStore.setState({ textObjects: objs });
      },
      applyImageLayers: (layers: ImageLayer[]) => {
        studioStore.setState({ imageLayers: layers });
      },
    });
  };

  const handleRedo = () => {
    studioUndoStack.redo({
      applyRasterPatch: (patch: BoundedDirtyRectPatch) => {
        const canvas = getWorkingCanvas();
        const ctx = canvas?.getContext('2d');
        if (ctx) ctx.putImageData(patch.patchImageData, patch.x, patch.y);
      },
      applyTextObjects: (objs: TextObject[]) => {
        studioStore.setState({ textObjects: objs });
      },
      applyImageLayers: (layers: ImageLayer[]) => {
        studioStore.setState({ imageLayers: layers });
      },
    });
  };

  const handleZoomPreset = (preset: '100%' | 'fitWidth' | 'fitHeight' | 'fitWindow') => {
    setZoomDropdownOpen(false);
    const winW = window.innerWidth - 380;
    const winH = window.innerHeight - 80;

    if (preset === '100%') {
      studioStore.setState({ zoom: 1.0 });
    } else if (preset === 'fitWidth') {
      studioStore.setState({ zoom: calculateFitWidth(winW, imageWidth) });
    } else if (preset === 'fitHeight') {
      studioStore.setState({ zoom: calculateFitHeight(winH, imageHeight) });
    } else if (preset === 'fitWindow') {
      studioStore.setState({ zoom: calculateFitWindow(winW, winH, imageWidth, imageHeight) });
    }
  };

  const getCleanBaseFilename = (): string => {
    let name = jobTitle || 'manga-page';
    name = name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\-]/g, '_');
    return name.slice(0, 40) || 'manga-page';
  };

  const handleExportImage = async (format: 'png' | 'jpeg' = 'png') => {
    const bgCanvas = getWorkingCanvas();
    const compositeCanvas = renderFullCompositeCanvas(
      imageWidth,
      imageHeight,
      bgCanvas,
      originalImage,
      viewMode,
      imageLayers,
      textObjects
    );
    const filename = `kites-${getCleanBaseFilename()}-translated.${format === 'jpeg' ? 'jpg' : 'png'}`;
    await downloadCanvasAsFile(compositeCanvas, filename, format);
    setToastMessage(`Exported ${format.toUpperCase()} image successfully!`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCopyCompositeToClipboard = async () => {
    const bgCanvas = getWorkingCanvas();
    const compositeCanvas = renderFullCompositeCanvas(
      imageWidth,
      imageHeight,
      bgCanvas,
      originalImage,
      viewMode,
      imageLayers,
      textObjects
    );
    const success = await copyCanvasToClipboard(compositeCanvas);
    if (success) {
      setToastMessage('Full image copied to clipboard!');
      setCopiedImageToast(true);
      setTimeout(() => setCopiedImageToast(false), 2000);
    } else {
      setToastMessage('Could not copy image to clipboard');
    }
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSaveImage = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      const bgCanvas = getWorkingCanvas();
      const exportCanvas = renderFullCompositeCanvas(
        imageWidth,
        imageHeight,
        bgCanvas,
        originalImage,
        viewMode,
        imageLayers,
        textObjects
      );

      exportCanvas.toBlob(async (blob) => {
        if (blob) {
          await onSave(blob, textObjects);
        }
        setIsSaving(false);
        setToastMessage('Saved changes to library!');
        setTimeout(() => setToastMessage(null), 3000);
      }, 'image/png');
    } catch (err) {
      console.error('[Studio] Save failed:', err);
      setIsSaving(false);
    }
  };

  const handleRetranslatePage = async () => {
    if (!originalImage || isRetranslating) return;
    const retranslateStart = performance.now();
    setIsRetranslating(true);
    setToastMessage('Retranslating page with full AI pipeline…');

    try {
      const bgCanvas = getWorkingCanvas();
      const ctx = bgCanvas?.getContext('2d');
      const prevImageData = ctx?.getImageData(0, 0, imageWidth, imageHeight);
      const prevTextObjects = [...studioStore.getState().textObjects];

      // Draw original image onto an offscreen canvas for OCR recognition
      const patchCanvas = document.createElement('canvas');
      patchCanvas.width = imageWidth;
      patchCanvas.height = imageHeight;
      const pCtx = patchCanvas.getContext('2d');
      if (pCtx) {
        pCtx.drawImage(originalImage, 0, 0, imageWidth, imageHeight);
      }

      const result = await requestStudioOcr(
        patchCanvas,
        { x: 0, y: 0, width: imageWidth, height: imageHeight },
        { translate: true, inpaint: true }
      );

      if (ctx && result.inpaintedImage) {
        ctx.drawImage(result.inpaintedImage, 0, 0, imageWidth, imageHeight);
      }
      const nextImageData = ctx?.getImageData(0, 0, imageWidth, imageHeight);

      // Push to undo stack for seamless Ctrl+Z recovery
      if (prevImageData && nextImageData) {
        studioUndoStack.push({
          id: `retranslate-${Date.now()}`,
          timestamp: Date.now(),
          description: 'Retranslate full page',
          rasterPatch: {
            before: {
              x: 0,
              y: 0,
              width: imageWidth,
              height: imageHeight,
              patchImageData: prevImageData,
            },
            after: {
              x: 0,
              y: 0,
              width: imageWidth,
              height: imageHeight,
              patchImageData: nextImageData,
            },
          },
          textObjects: {
            before: prevTextObjects,
            after: result.textObjects,
          },
        });
      }

      // Update studio state
      studioStore.setState({
        textObjects: result.textObjects,
      });

      // Synchronize retranslation metadata and updated text blocks directly into IndexedDB
      if (jobId) {
        try {
          const retranslateDuration = Math.round(performance.now() - retranslateStart);
          const currentOcrId = studioStore.getState().selectedOcrEngineId || 'v6-small';
          const currentInpaintId = studioStore.getState().selectedInpaintEngineId || 'lama-manga';
          const currentTranslationId = studioStore.getState().selectedTranslationEngineId || 'gg-translate';

          await db.translationJobs.update(jobId, {
            status: 'completed',
            completedAt: Date.now(),
            durationMs: retranslateDuration,
            ocrEngineId: currentOcrId,
            inpaintTier: currentInpaintId,
            translationEngineId: currentTranslationId,
          });

          const imageRecord = await db.images.where({ jobId }).first();
          if (imageRecord?.id) {
            await db.textBlocks.where({ imageId: imageRecord.id }).delete();
            const blocksToSave = result.textObjects.map((obj) => ({
              imageId: imageRecord.id!,
              originalText: obj.originalText || '',
              translatedText: obj.text,
              posX: obj.x,
              posY: obj.y,
              width: obj.width,
              height: obj.height,
              fontSize: obj.fontSize || 16,
              fontFamily: obj.fontFamily || 'WildWords, CCWildWords, sans-serif',
              bold: obj.bold,
              italic: obj.italic,
              align: obj.align,
              color: obj.color || '#000000',
              strokeColor: obj.strokeColor || '#ffffff',
              direction: (obj.isVertical ? 'v' : 'h') as 'v' | 'h',
              lines: obj.lines,
            }));
            await db.textBlocks.bulkAdd(blocksToSave);
          }
        } catch (dbErr) {
          console.warn('[Studio] Failed to sync retranslate into IndexedDB:', dbErr);
        }
      }

      setToastMessage('Page retranslated · Press Ctrl+Z to undo');
      setTimeout(() => {
        setToastMessage((curr) => (curr?.includes('retranslated') ? null : curr));
      }, 4500);
    } catch (err: any) {
      console.error('[Studio] Retranslate failed:', err);
      setToastMessage(`Retranslate failed: ${err?.message || 'Pipeline error'}`);
      setTimeout(() => setToastMessage(null), 4500);
    } finally {
      setIsRetranslating(false);
    }
  };

  return (
    <div className="flex flex-row gap-3 p-3 w-screen h-screen overflow-hidden bg-[#090a0f] text-slate-100 select-none">
      {/* ======================================================== */}
      {/* 1. LEFT SIDE PANEL: DUAL CARD TOOL ARCHITECTURE          */}
      {/* ======================================================== */}
      <aside className="flex flex-col h-full gap-3 w-88 max-w-[calc(100vw-1.5rem)] shrink-0 z-30">
        {/* CARD 1: Tool Selector & Tool Settings */}
        <div className="relative flex-1 min-h-0 bg-[#12141c] border border-[#262a3b] rounded-xl shadow-2xl p-3.5 flex flex-col overflow-hidden">
          {/* Top Bar of Card 1: Title & Utilities */}
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[#262a3b]">
            <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">Tools</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => studioStore.setState({ isInfoPanelOpen: !isInfoPanelOpen })}
                title={isInfoPanelOpen ? 'Close Page & Translation Info' : 'Page & Translation Info (I)'}
                className={`p-1 rounded-md transition cursor-pointer ${
                  isInfoPanelOpen
                    ? 'bg-[#f4446d] text-white shadow-md shadow-[rgba(244,68,109,0.35)]'
                    : 'text-slate-400 hover:text-white hover:bg-[#1c1f2e]'
                }`}
              >
                <Info className="w-4 h-4" />
              </button>
              <button
                onClick={() => studioStore.setState({ activeModal: 'fontManager' })}
                title="Manage Custom Fonts"
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition"
              >
                <Type className="w-4 h-4" />
              </button>
              <button
                onClick={() => studioStore.setState({ activeModal: 'appearance' })}
                title="Editor Appearance"
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition"
              >
                <Palette className="w-4 h-4" />
              </button>
              <button
                onClick={() => studioStore.setState({ activeModal: 'shortcuts' })}
                title="Keyboard Shortcuts"
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition"
              >
                <Keyboard className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tools Grid (7 tool buttons in 1 row) */}
          <div className="grid grid-cols-7 gap-1 p-1 bg-[#090a0f] border border-[#262a3b] rounded-lg shrink-0">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => studioStore.setState({ activeTool: t.id, isInfoPanelOpen: false })}
                title={`${t.label} (${t.shortcut})`}
                className={`flex items-center justify-center aspect-square rounded-md transition ${
                  activeTool === t.id && !isInfoPanelOpen
                    ? 'bg-[#f4446d] text-white shadow-md shadow-[rgba(244,68,109,0.35)]'
                    : 'text-slate-400 hover:text-white hover:bg-[#1c1f2e]'
                }`}
              >
                <t.icon className="w-[18px] h-[18px]" />
              </button>
            ))}
          </div>

          {/* Active Tool Settings or Page Info: Scrollable directly underneath the tools in Card 1 */}
          <div className="flex-1 overflow-y-auto mt-3 pr-1">
            {isInfoPanelOpen ? (
              <PageInfoSettings jobId={jobId} onBack={() => studioStore.setState({ isInfoPanelOpen: false })} />
            ) : (
              <>
                {activeTool === 'erase' && <EraseSettings />}
                {activeTool === 'paint' && <PaintSettings />}
                {activeTool === 'inpaint' && <InpaintSettings />}
                {activeTool === 'ocr' && <OcrSettings />}
                {(activeTool === 'text' || (activeTool as any) === 'select') && <TypographySettings />}
                {activeTool === 'warp' && <WarpSettings />}
                {activeTool === 'image' && <ImageLayerSettings onUploadPage={onUploadPage} isUploadingPage={isUploadingPage} />}
              </>
            )}
          </div>

          {/* Bottom of Card 1: Global Editing Pill Toggle */}
          <div className="pt-3 mt-auto border-t border-[#262a3b] shrink-0">
            <button
              onClick={() => studioStore.setState({ globalEditMode: !globalEditMode })}
              className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-semibold uppercase tracking-wider transition ${
                globalEditMode
                  ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d] shadow-md shadow-[rgba(244,68,109,0.2)]'
                  : 'border-[#262a3b] bg-[#090a0f] text-slate-400 hover:text-white hover:bg-[#1c1f2e]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Global Editing {globalEditMode ? '(On)' : '(Off)'}
            </button>
          </div>
        </div>

        {/* CARD 2: Actions Grid */}
        <div className="bg-[#12141c] border border-[#262a3b] rounded-xl shadow-2xl p-3 shrink-0 flex flex-col gap-2">
          <div className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">Actions</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border border-[#262a3b] bg-[#090a0f] text-xs font-medium text-slate-300 hover:bg-[#1c1f2e] disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border border-[#262a3b] bg-[#090a0f] text-xs font-medium text-slate-300 hover:bg-[#1c1f2e] disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <Redo2 className="w-3.5 h-3.5" /> Redo
            </button>
            <button
              onClick={() => studioStore.setState({ activeModal: 'exportTranscript' })}
              className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border border-[#262a3b] bg-[#090a0f] text-xs font-medium text-slate-300 hover:bg-[#1c1f2e] transition"
            >
              <FileText className="w-3.5 h-3.5" /> Export Texts
            </button>
            <button
              onClick={() => studioStore.setState({ activeModal: 'findReplace' })}
              className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border border-[#262a3b] bg-[#090a0f] text-xs font-medium text-slate-300 hover:bg-[#1c1f2e] transition"
            >
              <Search className="w-3.5 h-3.5" /> Find & Replace
            </button>
            <button
              onClick={handleSaveImage}
              disabled={isSaving}
              title="Save changes to Kites library"
              className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-[#f4446d] hover:bg-[#e0355e] text-white text-xs font-semibold shadow-md shadow-[rgba(244,68,109,0.35)] transition disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" /> {isSaving ? 'Saving...' : 'Save to DB'}
            </button>
            <button
              onClick={handleRetranslatePage}
              disabled={isRetranslating || !originalImage}
              title="Re-run full OCR detection, inpainting, and translation on the original page"
              className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border border-[#262a3b] bg-[#090a0f] text-xs font-medium text-slate-300 hover:bg-[#1c1f2e] hover:text-[#f4446d] hover:border-[#f4446d]/40 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            >
              {isRetranslating ? (
                <>
                  <Loader className="w-3.5 h-3.5 animate-spin text-[#f4446d]" /> Retranslating…
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" /> Retranslate
                </>
              )}
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="col-span-2 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border border-[#262a3b] bg-[#090a0f] text-xs font-medium text-slate-300 hover:bg-[#1c1f2e] transition"
              >
                Library
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ======================================================== */}
      {/* 2. RIGHT CANVAS WORKSPACE: TOP BAR + CENTERED CANVAS     */}
      {/* ======================================================== */}
      <main className="flex-1 flex flex-col h-full bg-[#12141c] border border-[#262a3b] rounded-xl shadow-2xl overflow-hidden">
        {/* Canvas Top Bar */}
        <div className="w-full h-9 bg-[#141724] border-b border-[#262a3b] px-3 flex items-center justify-between text-xs text-slate-300 shrink-0 select-none z-30">
          <div className="flex items-center gap-2">
            {/* 3-Way Presentation View Mode Segmented Control */}
            <div className="flex items-center p-0.5 rounded-lg bg-[#090a0f] border border-[#262a3b]">
              <button
                type="button"
                onClick={() => studioStore.setViewMode('original')}
                title="Show pristine untouched raw artwork"
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  viewMode === 'original'
                    ? 'bg-[#f4446d] text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#1c1f2e]/50'
                }`}
              >
                <span>Original</span>
              </button>
              <button
                type="button"
                onClick={() => studioStore.setViewMode('inpainted')}
                title="Show cleaned background artwork without text"
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  viewMode === 'inpainted'
                    ? 'bg-[#f4446d] text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#1c1f2e]/50'
                }`}
              >
                <span>Inpainted BG</span>
              </button>
              <button
                type="button"
                onClick={() => studioStore.setViewMode('translated')}
                title="Show translated artwork with typography overlay"
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  viewMode === 'translated'
                    ? 'bg-[#f4446d] text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#1c1f2e]/50'
                }`}
              >
                <span>Translated</span>
              </button>
            </div>

            <button
              onClick={() => studioStore.setState({ hideBoxes: !hideBoxes })}
              title="Hide Boxes (Preview clean page without dashed outlines)"
              disabled={viewMode !== 'translated'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition ${
                viewMode !== 'translated'
                  ? 'opacity-40 cursor-not-allowed border-[#262a3b] bg-[#090a0f] text-slate-500'
                  : hideBoxes
                  ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d] cursor-pointer'
                  : 'border-[#262a3b] bg-[#090a0f] text-slate-300 hover:bg-[#1c1f2e] cursor-pointer'
              }`}
            >
              {hideBoxes ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>{hideBoxes ? 'Show Boxes' : 'Hide Boxes'}</span>
            </button>
          </div>

          <span className="font-medium text-slate-400 truncate max-w-sm text-center">{jobTitle}</span>

          <div className="flex items-center gap-2">
            <span className="font-mono text-slate-500 text-[11px] hidden sm:inline">
              Canvas: {imageWidth} × {imageHeight}
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => studioStore.setClampedZoom(zoom * 0.85)}
                title="Zoom Out"
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <div ref={zoomDropdownRef} className="relative">
                <button
                  onClick={() => setZoomDropdownOpen((prev) => !prev)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#262a3b] bg-[#090a0f] font-mono text-[11px] text-slate-200 hover:border-slate-500 transition"
                >
                  <span>{Math.round(zoom * 100)}%</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {zoomDropdownOpen && (
                  <div className="absolute top-full mt-1.5 right-0 w-28 rounded-xl border border-[#262a3b] bg-[#12141c] p-1 shadow-2xl text-xs z-50">
                    <button
                      onClick={() => handleZoomPreset('100%')}
                      className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-[#1c1f2e] text-slate-200"
                    >
                      100% Actual
                    </button>
                    <button
                      onClick={() => handleZoomPreset('fitWidth')}
                      className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-[#1c1f2e] text-slate-200"
                    >
                      Fit Width
                    </button>
                    <button
                      onClick={() => handleZoomPreset('fitHeight')}
                      className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-[#1c1f2e] text-slate-200"
                    >
                      Fit Height
                    </button>
                    <button
                      onClick={() => handleZoomPreset('fitWindow')}
                      className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-[#1c1f2e] text-slate-200"
                    >
                      Fit Window
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => studioStore.setClampedZoom(zoom * 1.15)}
                title="Zoom In"
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Export Image Dropdown */}
            <div ref={exportDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setExportDropdownOpen((prev) => !prev)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#f4446d] hover:bg-[#e0355e] text-white text-xs font-semibold shadow-xs transition cursor-pointer"
                title="Export or download image"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
                <ChevronDown className="w-3 h-3 text-white/80" />
              </button>

              {exportDropdownOpen && (
                <div
                  className="absolute top-full mt-1.5 right-0 w-44 rounded-xl border border-[#262a3b] bg-[#12141c]/95 backdrop-blur-md p-1.5 shadow-2xl text-xs z-50 space-y-0.5"
                  onClick={() => setExportDropdownOpen(false)}
                >
                  <button
                    type="button"
                    onClick={() => handleExportImage('png')}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-200 text-left transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#f4446d]" />
                    <span>Download PNG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportImage('jpeg')}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-200 text-left transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    <span>Download JPEG</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCompositeToClipboard}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-200 text-left transition cursor-pointer"
                  >
                    {copiedImageToast ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                    <span>Copy Full Image</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Canvas Body Container */}
        <div className="relative flex flex-1 min-h-0 w-full h-full overflow-hidden">
          <StudioCanvas originalImage={originalImage} cleanedImage={cleanedImage} />
        </div>
      </main>

      {/* ======================================================== */}
      {/* 3. MODALS                                                */}
      {/* ======================================================== */}
      {activeModal === 'findReplace' && (
        <FindReplaceModal onClose={() => studioStore.setState({ activeModal: null })} />
      )}
      {activeModal === 'exportTranscript' && (
        <ExportTranscriptModal onClose={() => studioStore.setState({ activeModal: null })} />
      )}
      {activeModal === 'shortcuts' && (
        <ShortcutsModal onClose={() => studioStore.setState({ activeModal: null })} />
      )}
      {activeModal === 'fontManager' && (
        <FontManagerModal onClose={() => studioStore.setState({ activeModal: null })} />
      )}
      {activeModal === 'appearance' && (
        <AppearanceSettingsModal onClose={() => studioStore.setState({ activeModal: null })} />
      )}

      {/* Floating Toast Feedback for Retranslate / Actions */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 py-2 px-4 rounded-lg bg-[#141724] border border-[#f4446d]/40 shadow-xl shadow-black/60 text-xs font-medium text-slate-200 flex items-center gap-2 animate-fadeIn pointer-events-none">
          <Sparkles className="w-4 h-4 text-[#f4446d] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
