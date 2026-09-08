import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cleanupOldJobs, db, deleteJobs, type TranslationJob, type ImageRecord, type TextBlock } from './db';
import { 
  Upload, 
  Trash2, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Languages, 
  Check, 
  AlertCircle, 
  Clock, 
  Loader2, 
  FileImage, 
  Layers, 
  Sun, 
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';
import './index.css';
import { fitFontSizeWithLines, fontSpec } from './offscreen/utils/typesetLayout';

type ViewMode = 'final' | 'cleaned' | 'original';

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

/** Box margin inset ratio for binary font fitting. */
const BOX_INSET_RATIO = 0.05;

/** Maximum font size boundary during interactive resizing. */
const MAX_FONT_SIZE_CEILING = 64;

/** Eight-point resize handles configuration for selected text blocks. */
const RESIZE_HANDLES: { handle: DragHandle; cursor: string; posClass: string }[] = [
  { handle: 'nw', cursor: 'cursor-nwse-resize', posClass: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2' },
  { handle: 'n', cursor: 'cursor-ns-resize', posClass: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2' },
  { handle: 'ne', cursor: 'cursor-nesw-resize', posClass: 'top-0 right-0 translate-x-1/2 -translate-y-1/2' },
  { handle: 'e', cursor: 'cursor-ew-resize', posClass: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2' },
  { handle: 'se', cursor: 'cursor-nwse-resize', posClass: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2' },
  { handle: 's', cursor: 'cursor-ns-resize', posClass: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2' },
  { handle: 'sw', cursor: 'cursor-nesw-resize', posClass: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2' },
  { handle: 'w', cursor: 'cursor-ew-resize', posClass: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2' },
];

/** Cached offscreen 2D canvas context for text measurement in the Studio UI thread. */
let sharedMeasureCtx: CanvasRenderingContext2D | null = null;
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (!sharedMeasureCtx && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    sharedMeasureCtx = canvas.getContext('2d');
  }
  return sharedMeasureCtx;
}

/**
 * Fits font size and wraps text into balanced diamond line envelopes using the shared
 * typesetting engine for immediate visual feedback during box resize or text edits.
 *
 * @param text - Translated text string to typeset.
 * @param fontFamily - CSS font family stack.
 * @param width - Available block width in image pixels.
 * @param height - Available block height in image pixels.
 * @param fallbackSize - Baseline starting font size.
 * @returns Fitted font size and wrapped lines.
 */
function recalculateBlockTypeset(
  text: string,
  fontFamily: string,
  width: number,
  height: number,
  fallbackSize: number = 14
): { fontSize: number; lines: string[] } {
  const ctx = getMeasureContext();
  if (!ctx || !text || !text.trim() || width <= 10 || height <= 10) {
    return { fontSize: fallbackSize, lines: text ? [text] : [] };
  }
  const fitted = fitFontSizeWithLines(
    ctx,
    text,
    fontFamily || 'sans-serif',
    width,
    height,
    fallbackSize,
    Math.max(fallbackSize, MAX_FONT_SIZE_CEILING),
    BOX_INSET_RATIO
  );
  return {
    fontSize: fitted.size,
    lines: fitted.lines.length > 0 ? fitted.lines : [text],
  };
}

/**
 * Computes bounded rectangle coordinates and dimensions based on handle movement.
 *
 * @param drag - Snapshot of initial drag geometry.
 * @param deltaX - Pointer displacement along X axis in image coordinate space.
 * @param deltaY - Pointer displacement along Y axis in image coordinate space.
 * @param maxImageW - Outer boundary width.
 * @param maxImageH - Outer boundary height.
 * @returns Clamped coordinate rectangle { x, y, w, h }.
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

  // Horizontal edge adjustment
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

  // Vertical edge adjustment
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
  // Theme state
  const [isDark, setIsDark] = useState<boolean>(() => {
    return document.documentElement.classList.contains('dark') || 
      window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Responsive sidebars state (persisted in localStorage)
  const [isLeftOpen, setIsLeftOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('kites_studio_sidebar_left');
    if (stored !== null) return stored === 'true';
    return window.innerWidth >= 1024;
  });

  const [isRightOpen, setIsRightOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('kites_studio_sidebar_right');
    if (stored !== null) return stored === 'true';
    return window.innerWidth >= 1280;
  });

  const [isCompact, setIsCompact] = useState<boolean>(() => {
    return typeof window !== 'undefined' ? window.innerWidth < 1024 : false;
  });

  const toggleLeftSidebar = useCallback(() => {
    setIsLeftOpen((prev) => {
      const next = !prev;
      localStorage.setItem('kites_studio_sidebar_left', String(next));
      return next;
    });
  }, []);

  const toggleRightSidebar = useCallback(() => {
    setIsRightOpen((prev) => {
      const next = !prev;
      localStorage.setItem('kites_studio_sidebar_right', String(next));
      return next;
    });
  }, []);

  // Monitor window resize for responsive drawer mode
  useEffect(() => {
    const handleResize = () => {
      setIsCompact(window.innerWidth < 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Global Cmd+B / Ctrl+B shortcut to toggle left history sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleLeftSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleLeftSidebar]);

  // DB State
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [imageRecord, setImageRecord] = useState<ImageRecord | null>(null);
  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);
  
  // UI Selection State
  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('final');

  // Object URLs for Blobs
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Pan & Zoom Viewport
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active Drag & Resize state for Speech Bubbles
  const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);
  const latestBlockRef = useRef<TextBlock | null>(null);

  // Sync dark class on root html
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Load all jobs from Dexie
  const loadJobs = useCallback(async () => {
    try {
      const allJobs = await db.translationJobs.orderBy('timestamp').reverse().toArray();
      setJobs(allJobs);
      if (allJobs.length > 0) {
        setActiveJobId((currentJobId) => currentJobId ?? allJobs[0].id ?? null);
      }
      return allJobs;
    } catch (err) {
      console.error('[Dashboard] Failed to load jobs:', err);
      return [];
    }
  }, []);

  /**
   * Loads image binary and extracted text blocks for the specified or active job.
   *
   * @param jobIdToLoad - Numeric ID of the translation job to load.
   */
  const loadJobDetails = useCallback(async (jobIdToLoad: number | null) => {
    if (!jobIdToLoad) {
      setImageRecord(null);
      setTextBlocks([]);
      setSelectedBlockId(null);
      return;
    }

    try {
      const img = await db.images.where({ jobId: jobIdToLoad }).first();
      setImageRecord(img || null);

      if (img?.id) {
        const blocks = await db.textBlocks.where({ imageId: img.id }).toArray();
        setTextBlocks(blocks);
      } else {
        setTextBlocks([]);
      }
    } catch (error) {
      console.error('[Dashboard] Failed loading active job details:', error);
    }
  }, []);

  useEffect(() => {
    let isSubscribed = true;

    /**
     * Removes expired jobs before loading Studio history.
     *
     * @returns Resolves after cleanup and the initial history load complete.
     */
    async function initializeStudio(): Promise<void> {
      await cleanupOldJobs();
      if (isSubscribed) {
        await loadJobs();
      }
    }

    void initializeStudio();

    return () => {
      isSubscribed = false;
    };
  }, [loadJobs]);

  // Load image & text blocks whenever activeJobId changes
  useEffect(() => {
    void loadJobDetails(activeJobId);
  }, [activeJobId, loadJobDetails]);

  // Listen for pipeline completion or job updates from background / offscreen
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
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [activeJobId, loadJobs, loadJobDetails]);

  // Create Object URLs for image blobs
  useEffect(() => {
    let origUrl: string | null = null;
    let cleanUrl: string | null = null;

    if (imageRecord?.rawImageBlob) {
      origUrl = URL.createObjectURL(imageRecord.rawImageBlob);
      setOriginalUrl(origUrl);

      // Measure natural dimensions
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = origUrl;
    } else {
      setOriginalUrl(null);
    }

    if (imageRecord?.translatedImageBlob) {
      cleanUrl = URL.createObjectURL(imageRecord.translatedImageBlob);
      setCleanedUrl(cleanUrl);
    } else {
      setCleanedUrl(null);
    }

    return () => {
      if (origUrl) URL.revokeObjectURL(origUrl);
      if (cleanUrl) URL.revokeObjectURL(cleanUrl);
    };
  }, [imageRecord]);

  /**
   * Adjusts canvas viewport zoom level via mouse wheel events.
   *
   * @param e - Wheel event triggered over the interactive canvas viewport.
   */
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    if (e.deltaY < 0) {
      setZoom((z) => Math.min(z * zoomFactor, 5));
    } else {
      setZoom((z) => Math.max(z / zoomFactor, 0.2));
    }
  };

  /**
   * Begins viewport panning drag when primary mouse button is pressed.
   *
   * @param e - Mouse event from the viewport canvas container.
   */
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  /**
   * Updates viewport pan offset during mouse drag.
   *
   * @param e - Mouse move event.
   */
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    });
  };

  /**
   * Concludes viewport panning drag on mouse release.
   */
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  /**
   * Resets viewport zoom and panning offsets back to default center (100% scale).
   */
  const resetViewport = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  /**
   * Initiates text block position drag or handle resizing on primary pointer down.
   *
   * @param e - React PointerEvent triggered over the block body or a resize handle.
   * @param block - Target TextBlock instance.
   * @param handle - Cardinal direction of resize handle or 'move' for position translation.
   */
  const handleStartDrag = (
    e: React.PointerEvent,
    block: TextBlock,
    handle: DragHandle
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    setSelectedBlockId(block.id || null);

    const initialDrag: ActiveDragState = {
      blockId: block.id!,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      origX: block.posX,
      origY: block.posY,
      origW: block.width,
      origH: block.height,
      origFontSize: block.fontSize || 14,
      origLines: block.lines && block.lines.length > 0 ? block.lines : (block.translatedText ? [block.translatedText] : []),
      translatedText: block.translatedText || '',
      fontFamily: block.fontFamily || 'sans-serif',
    };

    latestBlockRef.current = block;
    setActiveDrag(initialDrag);
  };

  // Window-level pointer tracking for smooth box dragging and resizing with live typesetting
  useEffect(() => {
    if (!activeDrag) return;

    const onPointerMove = (e: PointerEvent) => {
      const deltaX = (e.clientX - activeDrag.startX) / zoom;
      const deltaY = (e.clientY - activeDrag.startY) / zoom;

      const bounds = computeNewBounds(
        activeDrag,
        deltaX,
        deltaY,
        imageDimensions.width,
        imageDimensions.height
      );

      let nextFontSize = activeDrag.origFontSize;
      let nextLines = activeDrag.origLines;

      if (activeDrag.handle !== 'move') {
        const fitted = recalculateBlockTypeset(
          activeDrag.translatedText,
          activeDrag.fontFamily,
          bounds.w,
          bounds.h,
          activeDrag.origFontSize
        );
        nextFontSize = fitted.fontSize;
        nextLines = fitted.lines;
      }

      setTextBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== activeDrag.blockId) return b;
          const updated: TextBlock = {
            ...b,
            posX: bounds.x,
            posY: bounds.y,
            width: bounds.w,
            height: bounds.h,
            fontSize: nextFontSize,
            lines: nextLines,
          };
          latestBlockRef.current = updated;
          return updated;
        })
      );
    };

    const onPointerUp = async () => {
      const targetBlock = latestBlockRef.current;
      const dragInfo = activeDrag;
      setActiveDrag(null);

      if (targetBlock && targetBlock.id === dragInfo.blockId) {
        try {
          await db.textBlocks.update(targetBlock.id, {
            posX: targetBlock.posX,
            posY: targetBlock.posY,
            width: targetBlock.width,
            height: targetBlock.height,
            fontSize: targetBlock.fontSize,
            lines: targetBlock.lines,
          });
        } catch (err) {
          console.error('[Dashboard] Failed to persist text block layout:', err);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [activeDrag, zoom, imageDimensions]);

  /**
   * Confirms and deletes a translation job plus its associated image and text records.
   *
   * @param jobId - Numeric identifier of the TranslationJob to delete.
   * @returns Resolves after deletion, or immediately when the user cancels.
   */
  const deleteJob = async (jobId: number): Promise<void> => {
    const shouldDelete = window.confirm('Delete this job, its stored image, and all text edits? This cannot be undone.');
    if (!shouldDelete) return;

    try {
      await deleteJobs([jobId]);
      const remaining = jobs.filter((job) => job.id !== jobId);
      setJobs(remaining);
      if (activeJobId === jobId) {
        setActiveJobId(remaining[0]?.id ?? null);
      }
    } catch (err) {
      console.error('[Dashboard] Failed deleting job:', err);
    }
  };

  /**
   * Handles local image file upload, creates a new job record, and triggers offscreen processing.
   *
   * @param e - Form file input change event.
   */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // 1. Create Job in Dexie
      const jobId = await db.translationJobs.add({
        timestamp: Date.now(),
        status: 'queued',
        srcUrl: file.name
      });
      const numericJobId = Number(jobId);

      // 2. Save raw blob in db.images
      await db.images.add({
        jobId: numericJobId,
        rawImageBlob: file
      });

      // 3. Mark processing and display immediately in editing panel
      await db.translationJobs.update(numericJobId, { status: 'processing' });
      await loadJobs();
      setActiveJobId(numericJobId);
      await loadJobDetails(numericJobId);

      // Ensure offscreen document is ready before dispatching task
      try {
        await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' });
      } catch {
        // Ignored if runtime is not ready
      }

      // 4. Trigger Offscreen Pipeline
      chrome.runtime.sendMessage({
        type: 'PROCESS_JOB',
        target: 'background',
        source: 'dashboard',
        request: true,
        payload: { jobId: numericJobId }
      }, async (response) => {
        console.log('[Dashboard] Pipeline response for local file:', response);
        await loadJobs();
        await loadJobDetails(numericJobId);
      });
    } catch (err) {
      console.error('[Dashboard] Local upload failed:', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * Persists real-time inline text edits for a selected speech bubble block into Dexie,
   * dynamically reflowing lines and fitting font size.
   *
   * @param blockId - Numeric identifier of the edited TextBlock record.
   * @param newText - Updated translated text content.
   */
  const handleTextChange = async (blockId: number, newText: string) => {
    const targetBlock = textBlocks.find((b) => b.id === blockId);
    let fittedSize = targetBlock?.fontSize || 14;
    let fittedLines: string[] = [];

    if (targetBlock) {
      const fitted = recalculateBlockTypeset(
        newText,
        targetBlock.fontFamily,
        targetBlock.width,
        targetBlock.height,
        targetBlock.fontSize || 14
      );
      fittedSize = fitted.fontSize;
      fittedLines = fitted.lines;
    }

    setTextBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? { ...b, translatedText: newText, fontSize: fittedSize, lines: fittedLines }
          : b
      )
    );
    try {
      await db.textBlocks.update(blockId, {
        translatedText: newText,
        fontSize: fittedSize,
        lines: fittedLines,
      });
    } catch (err) {
      console.error('[Dashboard] Failed updating text block:', err);
    }
  };

  /**
   * Bakes current text blocks over the cleaned/original image and triggers a PNG download.
   */
  const handleExportPng = async () => {
    if (!imageDimensions.width || !imageDimensions.height) return;
    const baseBlob = imageRecord?.translatedImageBlob || imageRecord?.rawImageBlob;
    if (!baseBlob) return;

    const bitmap = await createImageBitmap(baseBlob);
    const canvas = document.createElement('canvas');
    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw clean or original image
    ctx.drawImage(bitmap, 0, 0);

    // Draw text blocks
    textBlocks.forEach((block) => {
      if (!block.translatedText) return;
      ctx.save();
      const fontSize = block.fontSize || 16;
      const blockFontFamily = block.fontFamily || 'sans-serif';
      ctx.font = fontSpec(fontSize, blockFontFamily, block.translatedText);
      ctx.fillStyle = block.color || '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Draw stroke outline
      ctx.lineWidth = Math.max(1, fontSize * 0.1);
      ctx.strokeStyle = block.strokeColor || '#FFFFFF';
      const cx = block.posX + block.width / 2;
      const cy = block.posY + block.height / 2;

      // If the user edited text after rendering, `lines` is empty — rewrap using the
      // shared typesetting engine so the export matches the pipeline's layout policy.
      // fitFontSizeWithLines mutates ctx.font during its binary search, so re-set
      // both the font and the derived line height from the fitted size afterwards.
      let lines: string[];
      let drawFontSize = fontSize;
      if (block.lines && block.lines.length > 0) {
        lines = block.lines;
      } else {
        const fitted = fitFontSizeWithLines(ctx, block.translatedText, blockFontFamily, block.width, block.height, fontSize, Math.max(fontSize, 48), 0.05);
        lines = fitted.lines.length > 0 ? fitted.lines : [block.translatedText];
        drawFontSize = fitted.size;
        ctx.font = fontSpec(drawFontSize, blockFontFamily, block.translatedText);
      }
      const lineHeight = drawFontSize * 1.2;
      const startY = cy - ((lines.length - 1) * lineHeight) / 2;

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineY = startY + lineIndex * lineHeight;
        ctx.strokeText(lines[lineIndex], cx, lineY);
        ctx.fillText(lines[lineIndex], cx, lineY);
      }
      ctx.restore();
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kites-translated-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const activeJob = jobs.find((j) => j.id === activeJobId);

  return (
    <div className="flex h-screen w-full font-body overflow-hidden selection:bg-editorial selection:text-vellum bg-paper text-ink relative">
      
      {/* 1. LEFT SIDEBAR: History & Jobs */}
      {/* Backdrop for compact overlay */}
      {isCompact && isLeftOpen && (
        <div
          onClick={() => setIsLeftOpen(false)}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-30 transition-opacity"
          aria-hidden="true"
        />
      )}

      <aside
        className={
          isCompact
            ? `fixed inset-y-0 left-0 z-40 w-[290px] max-w-[85vw] bg-paper shadow-2xl flex flex-col border-r border-dust/30 transition-transform duration-300 ease-in-out ${
                isLeftOpen ? 'translate-x-0' : '-translate-x-full'
              }`
            : `h-full bg-paper flex flex-col border-r border-dust/30 z-10 shrink-0 transition-all duration-300 ease-in-out ${
                isLeftOpen ? 'w-[290px]' : 'w-0 border-r-0 overflow-hidden'
              }`
        }
      >
        <div className="w-[290px] max-w-[85vw] h-full flex flex-col shrink-0">
          <div className="p-3.5 border-b border-dust/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg font-bold tracking-widest text-ink">KITES</h1>
              <span className="text-[9px] font-mono uppercase bg-editorial/10 text-editorial px-1.5 py-0.5 rounded font-semibold">STUDIO</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsDark(!isDark)}
                className="p-1.5 text-dust hover:text-ink hover:bg-dust/20 rounded transition-colors cursor-pointer"
                title="Toggle theme"
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2 py-1 bg-ink text-vellum hover:bg-editorial text-xs rounded transition-colors font-medium cursor-pointer"
                title="Import image from disk"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import</span>
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept="image/*" 
                className="hidden" 
              />
              <button
                onClick={toggleLeftSidebar}
                className="p-1.5 text-dust hover:text-ink hover:bg-dust/20 rounded transition-colors cursor-pointer ml-0.5"
                title="Close history sidebar (Cmd+B)"
                aria-label="Close history sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* History List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
            <div className="text-[11px] font-mono tracking-wider text-dust uppercase px-2 mb-1">
              History ({jobs.length})
            </div>

            {jobs.length === 0 ? (
              <div className="p-8 text-center text-dust text-xs">
                <FileImage className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No translation jobs yet.</p>
                <p className="mt-1 opacity-75">Click "Import" or translate images on websites.</p>
              </div>
            ) : (
              jobs.map((job) => {
                const isActive = job.id === activeJobId;
                const title = job.srcUrl ? job.srcUrl.split('/').pop()?.split('?')[0] || 'Image' : `Job #${job.id}`;
                const timeStr = new Date(job.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                return (
                  <div
                    key={job.id}
                    onClick={() => {
                      setActiveJobId(job.id!);
                      if (isCompact) {
                        setIsLeftOpen(false);
                      }
                    }}
                    className={`group relative flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-all border ${
                      isActive
                        ? 'bg-ink text-vellum border-ink shadow-sm'
                        : 'border-transparent hover:bg-dust/20 text-ink'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-6">
                      {job.status === 'completed' && <Check className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-emerald-400' : 'text-emerald-600'}`} />}
                      {job.status === 'processing' && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-editorial" />}
                      {job.status === 'queued' && <Clock className="w-3.5 h-3.5 shrink-0 text-amber-500" />}
                      {job.status === 'error' && <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />}
                      
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{title}</div>
                        <div className={`text-[10px] font-mono ${isActive ? 'text-dust' : 'text-dust'}`}>{timeStr}</div>
                      </div>
                    </div>

                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteJob(job.id!);
                      }}
                      className={`opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-red-500 hover:text-white transition-opacity ${
                        isActive ? 'text-dust hover:text-white' : 'text-dust'
                      }`}
                      title="Delete job"
                      aria-label="Delete job"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer info */}
          <div className="p-3 border-t border-dust/20 text-[11px] font-mono text-dust flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span>Dexie v4 IndexedDB</span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Ready
              </span>
            </div>
            <div className="text-[10px] ">
              Images will be deleted after 7 days
            </div>
          </div>
        </div>
      </aside>

      {/* 2. CENTER STAGE: Canvas Viewport (XianScan Style) */}
      <main className="flex-1 min-w-0 h-full bg-glass relative flex flex-col overflow-hidden">
        
        {/* Top Control Bar */}
        <header className="h-12 border-b border-dust/20 bg-paper/80 backdrop-blur px-3 sm:px-4 flex items-center justify-between gap-2 z-10 shrink-0 min-w-0 overflow-x-auto custom-scrollbar">
          <div className="flex items-center gap-2 shrink-0">
            {/* Sidebar open button when collapsed */}
            {!isLeftOpen && (
              <button
                onClick={toggleLeftSidebar}
                className="p-1.5 text-dust hover:text-ink hover:bg-dust/20 rounded transition-colors cursor-pointer"
                title="Open history sidebar (Cmd+B)"
                aria-label="Open history sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}

            {/* View Mode Switcher */}
            <span className="text-xs font-mono text-dust uppercase hidden sm:inline">View:</span>
            <div className="flex items-center bg-dust/20 p-0.5 rounded text-xs">
              <button
                onClick={() => setViewMode('final')}
                className={`px-2 sm:px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
                  viewMode === 'final' ? 'bg-ink text-vellum shadow-xs' : 'text-ink hover:text-editorial'
                }`}
                title="Typeset translation preview"
              >
                <span className="hidden md:inline">Typeset Preview</span>
                <span className="md:hidden">Typeset</span>
              </button>
              <button
                onClick={() => setViewMode('cleaned')}
                className={`px-2 sm:px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
                  viewMode === 'cleaned' ? 'bg-ink text-vellum shadow-xs' : 'text-ink hover:text-editorial'
                }`}
                title="Cleaned inpainted scan"
              >
                <span className="hidden md:inline">Clean Inpaint</span>
                <span className="md:hidden">Inpaint</span>
              </button>
              <button
                onClick={() => setViewMode('original')}
                className={`px-2 sm:px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
                  viewMode === 'original' ? 'bg-ink text-vellum shadow-xs' : 'text-ink hover:text-editorial'
                }`}
                title="Original unmodified scan"
              >
                <span className="hidden md:inline">Original Scan</span>
                <span className="md:hidden">Original</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Zoom Controls */}
            <div className="flex items-center gap-0.5 bg-dust/20 p-0.5 rounded">
              <button
                onClick={() => setZoom((z) => Math.max(z / 1.2, 0.2))}
                className="p-1 text-ink hover:text-editorial rounded transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono px-1 min-w-9 sm:min-w-11 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(z * 1.2, 5))}
                className="p-1 text-ink hover:text-editorial rounded transition-colors cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={resetViewport}
                className="p-1 text-ink hover:text-editorial rounded transition-colors ml-0.5 cursor-pointer"
                title="Reset View"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={() => activeJobId !== null && void deleteJob(activeJobId)}
              disabled={activeJobId === null}
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-red-600 dark:disabled:hover:text-red-400 text-xs font-medium rounded transition-colors cursor-pointer disabled:cursor-not-allowed"
              title="Delete active job"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Delete</span>
            </button>

            <button
              onClick={handleExportPng}
              disabled={!imageRecord}
              className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 bg-editorial text-white hover:bg-editorial/90 disabled:opacity-50 text-xs font-medium rounded transition-colors cursor-pointer"
              title="Export translated image as PNG"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export PNG</span>
            </button>

            {/* Right Inspector Toggle */}
            <button
              onClick={toggleRightSidebar}
              className={`p-1.5 rounded transition-colors flex items-center gap-1 text-xs font-mono cursor-pointer ${
                isRightOpen
                  ? 'bg-ink text-vellum shadow-xs'
                  : 'text-dust hover:text-ink hover:bg-dust/20'
              }`}
              title={isRightOpen ? "Close detected regions panel" : "Open detected regions panel"}
              aria-label="Toggle detected regions panel"
            >
              {isRightOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
              <span className="hidden lg:inline">{textBlocks.length}</span>
            </button>
          </div>
        </header>

        {/* Viewport Area */}
        <div
          ref={viewportRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className={`flex-1 relative overflow-hidden flex items-center justify-center cursor-${
            isDragging ? 'grabbing' : 'grab'
          }`}
        >
          {/* Subtle Grid Background */}
          <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(circle_at_center,var(--color-dust)_1px,transparent_1px)] bg-[size:24px_24px]"></div>

          {/* Floating Processing Indicator */}
          {activeJob?.status === 'processing' && (
            <div className="absolute top-4 z-20 flex items-center gap-2 px-3.5 py-1.5 bg-paper/90 dark:bg-paper/90 backdrop-blur-md border border-editorial/40 text-editorial rounded-full shadow-lg text-xs font-mono animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Processing translation pipeline...</span>
            </div>
          )}

          {activeJob ? (
            <div
              className="relative transition-transform duration-75 select-none shadow-2xl origin-center"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              {/* Raster Image Layer */}
              {originalUrl ? (
                <img
                  src={
                    viewMode === 'original'
                      ? originalUrl
                      : (cleanedUrl || originalUrl)
                  }
                  alt="Comic Page"
                  className="max-w-none block pointer-events-none"
                  style={{
                    width: imageDimensions.width || 'auto',
                    height: imageDimensions.height || 'auto'
                  }}
                  draggable={false}
                />
              ) : (
                <div className="w-[600px] h-[800px] bg-paper flex items-center justify-center border border-dust/30">
                  <span className="text-dust font-mono text-xs">Loading image binary...</span>
                </div>
              )}

              {/* XianScan Style SVG & DOM Bounding Box Overlays */}
              {viewMode === 'final' && imageDimensions.width > 0 && (
                <div
                  className="absolute inset-0 pointer-events-auto"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      setSelectedBlockId(null);
                    }
                  }}
                >
                  {textBlocks.map((block) => {
                    const isSelected = selectedBlockId === block.id;
                    const isHovered = hoveredBlockId === block.id;
                    const isDraggingThis = activeDrag?.blockId === block.id;

                    return (
                      <div
                        key={block.id}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => handleStartDrag(e, block, 'move')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBlockId(block.id || null);
                        }}
                        onMouseEnter={() => setHoveredBlockId(block.id || null)}
                        onMouseLeave={() => setHoveredBlockId(null)}
                        className={`absolute transition-colors ${
                          isSelected
                            ? 'ring-2 ring-editorial bg-editorial/15 z-20 cursor-move shadow-md'
                            : isHovered
                            ? 'ring-1 ring-editorial/80 bg-editorial/10 z-10 cursor-pointer'
                            : 'border border-dust/40 hover:border-editorial/60 z-0 cursor-pointer'
                        } ${isDraggingThis ? 'ring-editorial select-none shadow-lg' : ''}`}
                        style={{
                          left: `${block.posX}px`,
                          top: `${block.posY}px`,
                          width: `${block.width}px`,
                          height: `${block.height}px`,
                        }}
                      >
                        {/* Corner markers when not selected */}
                        {!isSelected && (
                          <>
                            <div className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-editorial opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                            <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-editorial opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                          </>
                        )}

                        {/* Selected overlay: Floating dimension tag + 8 resize handles */}
                        {isSelected && (
                          <>
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-ink/90 text-paper text-[10px] font-mono rounded-xs shadow-xs whitespace-nowrap pointer-events-none z-30 flex items-center gap-1.5 select-none">
                              <span>{Math.round(block.width)}×{Math.round(block.height)}</span>
                              <span className="opacity-40">•</span>
                              <span>{Math.round(block.fontSize || 14)}px</span>
                            </div>

                            {RESIZE_HANDLES.map((rh) => (
                              <div
                                key={rh.handle}
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => handleStartDrag(e, block, rh.handle)}
                                className={`absolute w-2.5 h-2.5 bg-paper border-1.5 border-editorial rounded-xs z-30 shadow-xs hover:scale-125 transition-transform ${rh.cursor} ${rh.posClass}`}
                              />
                            ))}
                          </>
                        )}

                        {/* Rendered Text Inside Box */}
                        <div 
                          className="w-full h-full flex flex-col items-center justify-center p-1 text-center overflow-hidden pointer-events-none select-none"
                          style={{
                            fontSize: `${block.fontSize || 14}px`,
                            color: block.color || '#000000',
                            fontFamily: block.fontFamily || 'sans-serif',
                            fontWeight: 'bold',
                            lineHeight: 1.2,
                            textShadow: '0 0 2px #fff, 0 0 4px #fff'
                          }}
                        >
                          {(block.lines?.length ? block.lines : [block.translatedText]).map((line, index) => (
                            <span key={index} className={`block ${block.lines?.length ? 'whitespace-nowrap' : 'break-words'}`}>{line}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-dust">
              <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-sm">Select a job from history</p>
              <p className="text-xs opacity-75 mt-1">Or import a manga page to start translating</p>
            </div>
          )}
        </div>
      </main>

      {/* 3. RIGHT SIDEBAR: Text Block Inspector */}
      {/* Backdrop for compact overlay */}
      {isCompact && isRightOpen && (
        <div
          onClick={() => setIsRightOpen(false)}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-30 transition-opacity"
          aria-hidden="true"
        />
      )}

      <aside
        className={
          isCompact
            ? `fixed inset-y-0 right-0 z-40 w-[340px] max-w-[90vw] bg-paper shadow-2xl flex flex-col border-l border-dust/30 transition-transform duration-300 ease-in-out ${
                isRightOpen ? 'translate-x-0' : 'translate-x-full'
              }`
            : `h-full bg-paper flex flex-col border-l border-dust/30 z-10 shrink-0 transition-all duration-300 ease-in-out ${
                isRightOpen ? 'w-[340px]' : 'w-0 border-l-0 overflow-hidden'
              }`
        }
      >
        <div className="w-[340px] max-w-[90vw] h-full flex flex-col shrink-0">
          <div className="p-3.5 border-b border-dust/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-editorial" />
              <h2 className="text-xs font-mono tracking-widest text-dust uppercase">Detected Regions</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono bg-dust/20 px-2 py-0.5 rounded text-ink">
                {textBlocks.length} blocks
              </span>
              <button
                onClick={toggleRightSidebar}
                className="p-1 text-dust hover:text-ink hover:bg-dust/20 rounded transition-colors cursor-pointer"
                title="Close inspector"
                aria-label="Close inspector"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Region items list */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
            {textBlocks.length === 0 ? (
              <div className="p-8 text-center text-dust text-xs">
                <p>No text regions detected.</p>
                <p className="mt-1 opacity-75">Click a completed job to inspect translation boxes.</p>
              </div>
            ) : (
              textBlocks.map((block, index) => {
                const isSelected = selectedBlockId === block.id;

                return (
                  <div
                    key={block.id}
                    onClick={() => setSelectedBlockId(block.id || null)}
                    onMouseEnter={() => setHoveredBlockId(block.id || null)}
                    onMouseLeave={() => setHoveredBlockId(null)}
                    className={`p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'border-editorial bg-editorial/5 shadow-xs'
                        : 'border-dust/30 hover:border-dust bg-vellum/50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono text-dust mb-1.5">
                      <span className="font-semibold text-ink">#{index + 1}</span>
                      <span>{Math.round(block.width)}×{Math.round(block.height)}px • {Math.round(block.fontSize || 14)}px</span>
                    </div>

                    {/* Original OCR Text */}
                    <div className="mb-2">
                      <div className="text-[10px] uppercase font-mono text-dust mb-0.5">Original (OCR)</div>
                      <div className="text-xs font-medium text-ink bg-dust/10 px-2 py-1 rounded select-text">
                        {block.originalText || '<Empty>'}
                      </div>
                    </div>

                    {/* Localized Editable Text */}
                    <div>
                      <div className="text-[10px] uppercase font-mono text-editorial font-semibold mb-0.5 flex items-center justify-between">
                        <span>Translated</span>
                        {isSelected && <span className="text-[9px] font-normal text-dust">Editing</span>}
                      </div>
                      <textarea
                        value={block.translatedText}
                        onChange={(e) => handleTextChange(block.id!, e.target.value)}
                        rows={2}
                        className="w-full text-xs p-2 rounded bg-paper border border-dust/40 focus:border-editorial focus:ring-1 focus:ring-editorial outline-none resize-none transition-colors text-ink"
                        placeholder="Enter translation..."
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Selected block quick actions */}
          {selectedBlockId && (
            <div className="p-3 border-t border-dust/20 bg-vellum/30 flex items-center justify-between">
              <span className="text-xs font-mono text-dust">Block #{textBlocks.findIndex((b) => b.id === selectedBlockId) + 1} Selected</span>
              <button
                onClick={() => setSelectedBlockId(null)}
                className="text-xs font-mono text-editorial hover:underline cursor-pointer"
              >
                Deselect
              </button>
            </div>
          )}
        </div>
      </aside>

    </div>
  );
}
