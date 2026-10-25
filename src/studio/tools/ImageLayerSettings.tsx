import React from 'react';
import { Upload, FlipHorizontal, FlipVertical, Trash2, Loader } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
import type { ImageLayer } from '../types';
import { STUDIO_IMAGE_INPUT_ACCEPT } from '../../shared/constants';

interface ImageLayerSettingsProps {
  onUploadPage?: (files: File[]) => Promise<void>;
  isUploadingPage?: boolean;
  uploadProgress?: { current: number; total: number; currentFileName: string } | null;
}

/**
 * Displays sticker-layer controls and a separate full-page upload action.
 * @param props Page-upload callback and shared queue-loading state from App.
 * @returns Existing sticker controls plus an explicitly labeled page translation control.
 */
export const ImageLayerSettings: React.FC<ImageLayerSettingsProps> = ({
  onUploadPage,
  isUploadingPage = false,
  uploadProgress = null,
}) => {
  const imageLayers = useStudioStore((s) => s.imageLayers);
  const selectedImageLayerId = useStudioStore((s) => s.selectedImageLayerId);

  const selectedLayer = imageLayers.find((l) => l.id === selectedImageLayerId);

  /**
   * Updates selected sticker and records undo history.
   * @param partial Layer properties to replace.
   * @returns Nothing; no-op when no sticker is selected.
   */
  const updateSelected = (partial: Partial<ImageLayer>) => {
    if (!selectedLayer) return;
    const prev = [...imageLayers];
    const next = imageLayers.map((l) => (l.id === selectedLayer.id ? { ...l, ...partial } : l));
    studioStore.setState({ imageLayers: next });
    studioUndoStack.push({
      id: `layer-update-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Update Sticker Layer',
      imageLayers: { before: prev, after: next },
    });
  };

  /**
   * Adds an image as a sticker, without running OCR or translating the page.
   * @param e Sticker file-input change event.
   * @returns Nothing; image decoding adds the layer asynchronously.
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const newLayer: ImageLayer = {
        id: `sticker-${Date.now()}`,
        src: url,
        imageBitmap: img,
        x: 50,
        y: 50,
        width: Math.min(300, img.naturalWidth),
        height: Math.min(300, img.naturalHeight),
        rotation: 0,
        opacity: 1.0,
        flipH: false,
        flipV: false,
      };

      const prev = [...imageLayers];
      const next = [...imageLayers, newLayer];
      studioStore.setState({
        imageLayers: next,
        selectedImageLayerId: newLayer.id,
      });
      studioUndoStack.push({
        id: `add-layer-${Date.now()}`,
        timestamp: Date.now(),
        description: 'Add Sticker Layer',
        imageLayers: { before: prev, after: next },
      });
    };
    img.src = url;
  };

  /**
   * Passes page upload(s) to App and resets selection for repeat uploads.
   * @param event Page file-input change event, never the sticker input.
   * @returns Resolves after App handles persistence, queueing, and failure feedback.
   */
  const handlePageUpload = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const fileList = event.currentTarget.files;
    const files = fileList ? Array.from(fileList) : [];
    event.currentTarget.value = '';
    if (files.length > 0 && onUploadPage && !isUploadingPage) {
      await onUploadPage(files);
    }
  };

  /**
   * Removes selected sticker and records undo history.
   * @returns Nothing; no-op when no sticker is selected.
   */
  const handleDelete = () => {
    if (!selectedLayer) return;
    const prev = [...imageLayers];
    const next = imageLayers.filter((l) => l.id !== selectedLayer.id);
    studioStore.setState({
      imageLayers: next,
      selectedImageLayerId: null,
    });
    studioUndoStack.push({
      id: `delete-layer-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Delete Sticker Layer',
      imageLayers: { before: prev, after: next },
    });
  };

  return (
    <div className="space-y-4 text-xs text-slate-200">
      <div className="pb-2 border-b border-[#282d3f]">
        <h3 className="font-semibold text-sm text-slate-100">Stickers & Image Layers</h3>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Place sound effect graphics, clean speech bubbles, or custom visual overlays.
        </p>
      </div>

      <div>
        <label className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-[#282d3f] bg-[#090a0f] hover:border-[#f4446d]/60 hover:bg-[#12141c] cursor-pointer transition">
          <Upload className="w-5 h-5 text-[#f4446d] mb-1" />
          <span className="font-medium text-slate-200">Upload Sticker Image</span>
          <span className="text-[11px] text-slate-500">PNG with transparency, WebP, JPEG</span>
          <input type="file" accept={STUDIO_IMAGE_INPUT_ACCEPT} onChange={handleFileUpload} className="hidden" />
        </label>
      </div>

      {onUploadPage && (
        <div className="pt-3 border-t border-[#282d3f]">
          <label className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-[#282d3f] bg-[#090a0f] transition ${isUploadingPage ? 'opacity-70 cursor-wait' : 'hover:border-indigo-500 hover:bg-[#12141c] cursor-pointer'}`}>
            {isUploadingPage ? (
              <Loader className="w-5 h-5 text-indigo-400 mb-1 animate-spin" />
            ) : (
              <Upload className="w-5 h-5 text-indigo-400 mb-1" />
            )}
            <span className="font-medium text-slate-200">
              {uploadProgress && uploadProgress.total > 1
                ? `Queueing ${uploadProgress.current}/${uploadProgress.total}…`
                : isUploadingPage
                ? 'Queueing page…'
                : 'Upload & translate pages'}
            </span>
            {uploadProgress && uploadProgress.total > 1 ? (
              <div className="w-full mt-2 space-y-1">
                <div className="w-full bg-[#1c1f2e] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-indigo-500 h-full rounded-full transition-all duration-300 ease-out"
                    style={{
                      width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 text-center truncate max-w-full">
                  {uploadProgress.currentFileName}
                </p>
              </div>
            ) : (
              <span className="text-[11px] text-slate-500">
                {isUploadingPage ? 'Full translation pipeline' : 'PNG, JPG, WebP, AVIF · single or batch'}
              </span>
            )}
            <input
              type="file"
              accept={STUDIO_IMAGE_INPUT_ACCEPT}
              multiple
              aria-label="Upload and translate pages"
              onChange={handlePageUpload}
              disabled={isUploadingPage}
              className="hidden"
            />
          </label>
        </div>
      )}

      {selectedLayer ? (
        <div className="space-y-3 pt-2 border-t border-[#282d3f]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">Selected Sticker</span>
            <button
              onClick={handleDelete}
              className="p-1 rounded text-[#f4446d] hover:bg-[#f4446d]/15 transition"
              title="Delete sticker"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Opacity</span>
              <span className="font-mono text-slate-200">{Math.round(selectedLayer.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={selectedLayer.opacity}
              onChange={(e) => updateSelected({ opacity: Number(e.target.value) })}
              className="w-full accent-[#f4446d]"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => updateSelected({ flipH: !selectedLayer.flipH })}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border transition ${
                selectedLayer.flipH
                  ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
                  : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
              }`}
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              Flip Horizontal
            </button>
            <button
              onClick={() => updateSelected({ flipV: !selectedLayer.flipV })}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border transition ${
                selectedLayer.flipV
                  ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d]'
                  : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
              }`}
            >
              <FlipVertical className="w-3.5 h-3.5" />
              Flip Vertical
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3 text-center text-[11px] text-slate-500">
          {imageLayers.length > 0
            ? 'Click any sticker on the canvas to inspect its layer.'
            : 'No stickers placed yet.'}
        </div>
      )}
    </div>
  );
};
