import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  cleanupOldJobs,
  db,
  deleteJobs,
  type TranslationJob,
  type ImageRecord,
  type TextBlock,
} from './db';
import {
  Upload,
  Trash2,
  FileImage,
  Layers,
  PanelLeftClose,
} from 'lucide-react';
import './index.css';
import { Studio } from './studio/Studio';
import type { TextObject } from './studio/types';
import { uploadStudioPage } from './shared/studioUpload';
import { restoreTextObject } from './studio/state/persistedTextObjects';

export type DragHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ActiveDragState {
  blockId: number;
  handle: DragHandle;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  origFontSize: number;
  origLines: string[];
  translatedText: string;
  fontFamily: string;
}

/** Minimum allowable width and height for an interactive text block in pixels. */
export const MIN_BLOCK_SIZE = 24;

/**
 * Computes bounded rectangle coordinates and dimensions based on handle movement.
 * (Preserved for backward-compatibility with testing and geometry utilities)
 */
export function computeNewBounds(
  drag: ActiveDragState,
  deltaX: number,
  deltaY: number,
  maxImageW: number,
  maxImageH: number
): { x: number; y: number; w: number; h: number } {
  const { origX, origY, origW, origH, handle } = drag;

  if (handle === 'move') {
    let x = origX + deltaX;
    let y = origY + deltaY;
    if (maxImageW > 0) {
      x = Math.max(0, Math.min(maxImageW - origW, x));
    }
    if (maxImageH > 0) {
      y = Math.max(0, Math.min(maxImageH - origH, y));
    }
    return { x, y, w: origW, h: origH };
  }

  let x = origX;
  let y = origY;
  let w = origW;
  let h = origH;

  if (handle === 'e' || handle === 'ne' || handle === 'se') {
    w = Math.max(MIN_BLOCK_SIZE, origW + deltaX);
    if (maxImageW > 0 && x + w > maxImageW) {
      w = maxImageW - x;
    }
  } else if (handle === 'w' || handle === 'nw' || handle === 'sw') {
    const maxDeltaX = origW - MIN_BLOCK_SIZE;
    const minDeltaX = -origX;
    const clampedDeltaX = Math.max(minDeltaX, Math.min(maxDeltaX, deltaX));
    x = origX + clampedDeltaX;
    w = origW - clampedDeltaX;
  }

  if (handle === 's' || handle === 'se' || handle === 'sw') {
    h = Math.max(MIN_BLOCK_SIZE, origH + deltaY);
    if (maxImageH > 0 && y + h > maxImageH) {
      h = maxImageH - y;
    }
  } else if (handle === 'n' || handle === 'ne' || handle === 'nw') {
    const maxDeltaY = origH - MIN_BLOCK_SIZE;
    const minDeltaY = -origY;
    const clampedDeltaY = Math.max(minDeltaY, Math.min(maxDeltaY, deltaY));
    y = origY + clampedDeltaY;
    h = origH - clampedDeltaY;
  }

  return { x, y, w, h };
}

export default function App() {
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [imageRecord, setImageRecord] = useState<ImageRecord | null>(null);
  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false);

  const [originalImageEl, setOriginalImageEl] = useState<HTMLImageElement | null>(null);
  const [cleanedImageEl, setCleanedImageEl] = useState<HTMLImageElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeBlobUrlsRef = useRef<string[]>([]);
  const jobLoadVersionRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Revoke active Blob URLs on component unmount
  useEffect(() => {
    return () => {
      jobLoadVersionRef.current += 1;
      activeBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      activeBlobUrlsRef.current = [];
    };
  }, []);

  // Load jobs from Dexie
  const loadJobs = useCallback(async () => {
    try {
      const allJobs = await db.translationJobs.orderBy('timestamp').reverse().toArray();
      setJobs(allJobs);
      if (allJobs.length > 0) {
        const params = new URLSearchParams(window.location.search);
        const queryJobId = params.get('jobId') ? Number(params.get('jobId')) : null;
        if (queryJobId && allJobs.some((j) => j.id === queryJobId)) {
          setActiveJobId(queryJobId);
        } else {
          setActiveJobId((curr) => curr ?? allJobs[0].id ?? null);
        }
      }
      return allJobs;
    } catch (err) {
      console.error('[Studio] Failed to load jobs:', err);
      return [];
    }
  }, []);

  /**
   * Loads one page, ignoring database/image callbacks superseded by another selection.
   * @param jobIdToLoad Selected persisted job ID, or null to clear the viewport.
   * @returns Resolves once the current page records have been read.
   */
  const loadJobDetails = useCallback(async (jobIdToLoad: number | null) => {
    const loadVersion = ++jobLoadVersionRef.current;
    setImageRecord(null);
    setTextBlocks([]);
    setOriginalImageEl(null);
    setCleanedImageEl(null);
    // Revoke prior page Blob URLs to prevent memory accumulation across page switches
    activeBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    activeBlobUrlsRef.current = [];
    if (!jobIdToLoad) return;

    try {
      const img = await db.images.where({ jobId: jobIdToLoad }).first();
      if (loadVersion !== jobLoadVersionRef.current) return;
      const blocks = img?.id ? await db.textBlocks.where({ imageId: img.id }).toArray() : [];
      if (loadVersion !== jobLoadVersionRef.current) return;
      setImageRecord(img || null);
      setTextBlocks(blocks);

      // Load original image element
      if (img?.rawImageBlob) {
        const origUrl = URL.createObjectURL(img.rawImageBlob);
        activeBlobUrlsRef.current.push(origUrl);
        const origImg = new Image();
        origImg.onload = () => {
          if (loadVersion === jobLoadVersionRef.current) setOriginalImageEl(origImg);
        };
        origImg.src = origUrl;
      } else {
        setOriginalImageEl(null);
      }

      // Load cleaned image element
      if (img?.translatedImageBlob) {
        const cleanUrl = URL.createObjectURL(img.translatedImageBlob);
        activeBlobUrlsRef.current.push(cleanUrl);
        const cleanImg = new Image();
        cleanImg.onload = () => {
          if (loadVersion === jobLoadVersionRef.current) setCleanedImageEl(cleanImg);
        };
        cleanImg.src = cleanUrl;
      } else {
        setCleanedImageEl(null);
      }
    } catch (err) {
      console.error('[Studio] Failed loading job details:', err);
    }
  }, []);

  useEffect(() => {
    void cleanupOldJobs().then(() => loadJobs());
  }, [loadJobs]);

  useEffect(() => {
    void loadJobDetails(activeJobId);
  }, [activeJobId, loadJobDetails]);

  // Listen for pipeline completion
  useEffect(() => {
    const handleRuntimeMessage = (message: any) => {
      if (message?.type === 'JOB_COMPLETED' || message?.type === 'IMAGE_TRANSLATED') {
        void loadJobs();
        const completedJobId = message.payload?.jobId;
        if (!completedJobId || completedJobId === activeJobId) {
          void loadJobDetails(activeJobId);
        }
      } else if (message?.type === 'JOB_ERROR') {
        void loadJobs();
      }
    };
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  }, [activeJobId, loadJobs, loadJobDetails]);

  // Map Dexie TextBlocks to Studio TextObjects; keep identity stable during upload/UI updates.
  const studioTextObjects = useMemo(() => textBlocks.map(restoreTextObject), [textBlocks]);

  /**
   * Uploads a page from either the library or editor through the same persisted pipeline entry point.
   * @param file User-selected image file; sticker uploads use their separate layer handler.
   * @returns Resolves after queue acknowledgement and library refresh, or visible failure feedback.
   */
  const handlePageUpload = async (file: File): Promise<void> => {
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setIsUploading(true);
    setUploadError(null);
    try {
      const jobId = await uploadStudioPage(file);
      await loadJobs();
      setActiveJobId(jobId);
    } catch (err) {
      console.error('[Studio] Manual upload failed:', err);
      setUploadError(err instanceof Error ? err.message : 'Could not upload and queue this page.');
      await loadJobs();
    } finally {
      uploadInFlightRef.current = false;
      setIsUploading(false);
    }
  };

  /**
   * Reads and resets the library file input so the same file can be selected again.
   * @param event Native file-input change event.
   * @returns Resolves after the selected page upload completes.
   */
  const handleManualUpload = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) await handlePageUpload(file);
  };

  const handleDeleteJob = async (jobId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteJobs([jobId]);
    await loadJobs();
    if (activeJobId === jobId) {
      setActiveJobId(null);
    }
  };

  const handleSaveToDb = async (savedImageBlob: Blob, updatedObjects: TextObject[]) => {
    if (!activeJobId || !imageRecord?.id) return;

    try {
      await db.transaction('rw', db.images, db.textBlocks, async () => {
        // Update cleaned raster blob
        await db.images.update(imageRecord.id!, {
          translatedImageBlob: savedImageBlob,
        });

        // Delete old blocks and write updated blocks
        await db.textBlocks.where({ imageId: imageRecord.id! }).delete();
        const newBlocks: TextBlock[] = updatedObjects.map((obj) => ({
          imageId: imageRecord.id!,
          originalText: obj.originalText || '',
          translatedText: obj.text,
          posX: obj.x,
          posY: obj.y,
          width: obj.width,
          height: obj.height,
          fontSize: obj.fontSize,
          fontFamily: obj.fontFamily,
          bold: obj.bold,
          italic: obj.italic,
          align: obj.align,
          color: obj.color,
          strokeColor: obj.strokeColor,
          direction: obj.isVertical ? 'v' : 'h',
          lines: obj.lines,
          lineSpacing: obj.lineSpacing,
          typesetMode: obj.typesetMode,
          isSkipped: obj.isSkipped,
          angle: obj.rotation ?? 0,
        }));
        await db.textBlocks.bulkAdd(newBlocks);
      });

      // Synchronize in-memory record without triggering loadJobDetails unmount/flicker
      setImageRecord((prev) => (prev ? { ...prev, translatedImageBlob: savedImageBlob } : prev));
    } catch (err) {
      console.error('[Studio] Failed saving to database:', err);
    }
  };

  const activeJob = jobs.find((j) => j.id === activeJobId);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#090a0f] text-slate-100 flex">
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        onChange={handleManualUpload}
        disabled={isUploading}
        className="hidden"
      />
      {/* Left Project Library Drawer */}
      {isLeftDrawerOpen && (
        <aside className="w-64 border-r border-[#282d3f] bg-[#12141c] flex flex-col z-40 shrink-0">
          <div className="flex items-center justify-between p-3 border-b border-[#282d3f]">
            <span className="font-semibold text-xs text-slate-200">Library & Pages ({jobs.length})</span>
            <button
              onClick={() => setIsLeftDrawerOpen(false)}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          <div className="p-2 border-b border-[#282d3f]">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-[#282d3f] hover:border-indigo-500 bg-[#090a0f] text-xs text-indigo-300 font-medium transition"
            >
              <Upload className="w-3.5 h-3.5" />
              {isUploading ? 'Queueing page…' : 'Upload Image'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {jobs.map((job) => {
              const isActive = job.id === activeJobId;
              return (
                <div
                  key={job.id}
                  onClick={() => setActiveJobId(job.id!)}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer text-xs transition ${
                    isActive
                      ? 'bg-indigo-600/20 border border-indigo-500/50 text-indigo-200'
                      : 'hover:bg-[#1c1f2e] text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileImage className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{job.srcUrl || `Page #${job.id}`}</span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteJob(job.id!, e)}
                    className="p-1 rounded text-slate-500 hover:text-red-400 transition"
                    title="Delete page"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Main Studio Viewport */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {uploadError && (
          <div role="alert" className="px-3 py-2 text-xs text-red-300 bg-red-950/40 border-b border-red-900/50">
            {uploadError}
          </div>
        )}
        {originalImageEl || cleanedImageEl ? (
          <Studio
            jobId={activeJobId ?? undefined}
            originalImage={originalImageEl}
            cleanedImage={cleanedImageEl}
            initialTextObjects={studioTextObjects}
            jobTitle={activeJob?.srcUrl || `Manga Page #${activeJobId}`}
            onUploadPage={handlePageUpload}
            isUploadingPage={isUploading}
            onBack={() => setIsLeftDrawerOpen(true)}
            onSave={async (blob, objs) => handleSaveToDb(blob, objs)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-2xl border border-[#282d3f] bg-[#12141c] flex items-center justify-center mb-4 shadow-xl">
              <Layers className="w-8 h-8 text-indigo-400" />
            </div>
            <h2 className="text-base font-semibold text-slate-100">Kites Manga Studio</h2>
            <p className="text-xs text-slate-400 max-w-sm mt-1">
              Upload a comic or manga page to edit inpainting, restore artwork, tweak CJK typography, or run local WebGPU translations.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 transition shadow-lg shadow-indigo-900/30"
            >
              <Upload className="w-4 h-4" />
              {isUploading ? 'Queueing page…' : 'Upload Manga Page'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
