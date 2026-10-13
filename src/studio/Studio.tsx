import React, { useState, useEffect } from 'react';
import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  FlipHorizontal,
  Search,
  FileText,
  Type,
  Keyboard,
  Palette,
  Save,
  ChevronDown,
} from 'lucide-react';
import { studioStore, useStudioStore } from './state/studioStore';
import { studioUndoStack } from './state/undoStack';
import {
  calculateFitWidth,
  calculateFitHeight,
  calculateFitWindow,
} from './canvas/CanvasViewport';
import { ToolRail } from './tools/ToolRail';
import { StudioCanvas } from './canvas/StudioCanvas';
import { EraseSettings } from './tools/EraseSettings';
import { PaintSettings } from './tools/PaintSettings';
import { InpaintSettings } from './tools/InpaintSettings';
import { OcrSettings } from './tools/OcrSettings';
import { TypographySettings } from './tools/TypographySettings';
import { WarpSettings } from './tools/WarpSettings';
import { ImageLayerSettings } from './tools/ImageLayerSettings';
import { FindReplaceModal } from './modals/FindReplaceModal';
import { ExportTranscriptModal } from './modals/ExportTranscriptModal';
import { ShortcutsModal } from './modals/ShortcutsModal';
import { FontManagerModal } from './modals/FontManagerModal';
import { AppearanceSettingsModal } from './modals/AppearanceSettingsModal';
import type { BoundedDirtyRectPatch, ImageLayer, TextObject } from './types';

export interface StudioProps {
  originalImage: HTMLImageElement | null;
  cleanedImage: HTMLImageElement | null;
  initialTextObjects?: TextObject[];
  jobTitle?: string;
  onSave?: (savedImageBlob: Blob, textObjects: TextObject[]) => Promise<void>;
  onBack?: () => void;
}

export const Studio: React.FC<StudioProps> = ({
  originalImage,
  cleanedImage,
  initialTextObjects = [],
  jobTitle = 'Manga Page',
  onSave,
  onBack,
}) => {
  const activeTool = useStudioStore((s) => s.activeTool);
  const zoom = useStudioStore((s) => s.zoom);
  const isCanvasFlipped = useStudioStore((s) => s.isCanvasFlipped);
  const activeModal = useStudioStore((s) => s.activeModal);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoomDropdownOpen, setZoomDropdownOpen] = useState(false);

  // Load initial text objects into studio store
  useEffect(() => {
    if (initialTextObjects && initialTextObjects.length > 0) {
      studioStore.setState({ textObjects: initialTextObjects });
    }
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

  // Global Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y hotkeys
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
      } else if (e.key.toLowerCase() === 'v') {
        studioStore.setState({ activeTool: 'select' });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'erase' });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '2') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'paint' });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '3') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'inpaint' });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '4') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'ocr' });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '5') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'text' });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '6') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'warp' });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '7') {
        e.preventDefault();
        studioStore.setState({ activeTool: 'image' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUndo = () => {
    studioUndoStack.undo({
      applyRasterPatch: (patch: BoundedDirtyRectPatch) => {
        // Will restore via background canvas
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
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
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
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
    const imgW = originalImage?.naturalWidth || cleanedImage?.naturalWidth || 800;
    const imgH = originalImage?.naturalHeight || cleanedImage?.naturalHeight || 1200;
    const winW = window.innerWidth - 350; // minus sidebars
    const winH = window.innerHeight - 80;

    if (preset === '100%') {
      studioStore.setState({ zoom: 1.0 });
    } else if (preset === 'fitWidth') {
      studioStore.setState({ zoom: calculateFitWidth(winW, imgW) });
    } else if (preset === 'fitHeight') {
      studioStore.setState({ zoom: calculateFitHeight(winH, imgH) });
    } else if (preset === 'fitWindow') {
      studioStore.setState({ zoom: calculateFitWindow(winW, winH, imgW, imgH) });
    }
  };

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#090a0f] text-slate-100 select-none">
      {/* Top Application Toolbar */}
      <header className="h-12 border-b border-[#282d3f] bg-[#12141c] flex items-center justify-between px-3 z-30 shrink-0">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-md border border-[#282d3f] hover:bg-[#1c1f2e] transition"
            >
              Library
            </button>
          )}
          <span className="font-semibold text-xs text-slate-200 tracking-wide">{jobTitle}</span>

          <div className="h-4 w-px bg-[#282d3f] mx-1" />

          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="p-1.5 rounded-lg text-slate-300 hover:bg-[#1c1f2e] disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className="p-1.5 rounded-lg text-slate-300 hover:bg-[#1c1f2e] disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewport Zoom & Presets */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => studioStore.setClampedZoom(zoom * 0.85)}
            title="Zoom Out"
            className="p-1.5 rounded-lg text-slate-300 hover:bg-[#1c1f2e] transition"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              onClick={() => setZoomDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#282d3f] bg-[#090a0f] text-xs font-mono text-slate-200 hover:border-slate-600 transition"
            >
              <span>{Math.round(zoom * 100)}%</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {zoomDropdownOpen && (
              <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 w-28 rounded-xl border border-[#282d3f] bg-[#12141c] p-1 shadow-2xl text-xs z-50">
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
            className="p-1.5 rounded-lg text-slate-300 hover:bg-[#1c1f2e] transition"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            onClick={() => studioStore.setState({ isCanvasFlipped: !isCanvasFlipped })}
            title="Flip Preview Horizontally"
            className={`p-1.5 rounded-lg transition ${
              isCanvasFlipped
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:bg-[#1c1f2e]'
            }`}
          >
            <FlipHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Global Utilities */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => studioStore.setState({ activeModal: 'findReplace' })}
            title="Find & Replace"
            className="p-1.5 rounded-lg text-slate-300 hover:bg-[#1c1f2e] transition"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => studioStore.setState({ activeModal: 'exportTranscript' })}
            title="Export Dialogue Transcript"
            className="p-1.5 rounded-lg text-slate-300 hover:bg-[#1c1f2e] transition"
          >
            <FileText className="w-4 h-4" />
          </button>
          <button
            onClick={() => studioStore.setState({ activeModal: 'fontManager' })}
            title="Manage Custom Fonts"
            className="p-1.5 rounded-lg text-slate-300 hover:bg-[#1c1f2e] transition"
          >
            <Type className="w-4 h-4" />
          </button>
          <button
            onClick={() => studioStore.setState({ activeModal: 'shortcuts' })}
            title="Keyboard Shortcuts"
            className="p-1.5 rounded-lg text-slate-300 hover:bg-[#1c1f2e] transition"
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <button
            onClick={() => studioStore.setState({ activeModal: 'appearance' })}
            title="Editor Appearance"
            className="p-1.5 rounded-lg text-slate-300 hover:bg-[#1c1f2e] transition"
          >
            <Palette className="w-4 h-4" />
          </button>

          {onSave && (
            <button
              onClick={() => {
                // Trigger save
              }}
              className="flex items-center gap-1.5 ml-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              Save Image
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Tool Rail */}
        <ToolRail />

        {/* Viewport Canvas Center */}
        <main className="flex-1 relative overflow-hidden">
          <StudioCanvas
            originalImage={originalImage}
            cleanedImage={cleanedImage}
          />
        </main>

        {/* Right Tool Inspector Panel */}
        <aside className="w-72 border-l border-[#282d3f] bg-[#12141c] overflow-y-auto shrink-0 z-20">
          {activeTool === 'erase' && <EraseSettings />}
          {activeTool === 'paint' && <PaintSettings />}
          {activeTool === 'inpaint' && <InpaintSettings />}
          {activeTool === 'ocr' && <OcrSettings />}
          {(activeTool === 'text' || activeTool === 'select') && <TypographySettings />}
          {activeTool === 'warp' && <WarpSettings />}
          {activeTool === 'image' && <ImageLayerSettings />}
        </aside>
      </div>

      {/* Modals Container */}
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
    </div>
  );
};
