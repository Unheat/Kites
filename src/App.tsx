import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db, type TranslationJob, type ImageRecord, type TextBlock } from './db';
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
  Moon 
} from 'lucide-react';
import './index.css';

type ViewMode = 'final' | 'cleaned' | 'original';

export default function App() {
  // Theme state
  const [isDark, setIsDark] = useState<boolean>(() => {
    return document.documentElement.classList.contains('dark') || 
      window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

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
      if (allJobs.length > 0 && !activeJobId) {
        setActiveJobId(allJobs[0].id || null);
      }
    } catch (err) {
      console.error('[Dashboard] Failed to load jobs:', err);
    }
  }, [activeJobId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Load image & text blocks for activeJobId
  useEffect(() => {
    if (!activeJobId) {
      setImageRecord(null);
      setTextBlocks([]);
      setSelectedBlockId(null);
      return;
    }

    let isSubscribed = true;

    async function loadJobDetails() {
      try {
        const img = await db.images.where({ jobId: activeJobId! }).first();
        if (!isSubscribed) return;
        setImageRecord(img || null);

        if (img?.id) {
          const blocks = await db.textBlocks.where({ imageId: img.id }).toArray();
          if (!isSubscribed) return;
          setTextBlocks(blocks);
        } else {
          setTextBlocks([]);
        }
      } catch (error) {
        console.error('[Dashboard] Failed loading active job details:', error);
      }
    }

    loadJobDetails();

    return () => {
      isSubscribed = false;
    };
  }, [activeJobId]);

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
   * Deletes a translation job and its associated images and text blocks from IndexedDB.
   *
   * @param jobId - Numeric identifier of the TranslationJob to delete.
   * @param e - React mouse click event.
   */
  const handleDeleteJob = async (jobId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await db.translationJobs.delete(jobId);
      const remaining = jobs.filter((j) => j.id !== jobId);
      setJobs(remaining);
      if (activeJobId === jobId) {
        setActiveJobId(remaining.length > 0 ? remaining[0].id || null : null);
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

      // 2. Save raw blob in db.images
      await db.images.add({
        jobId: Number(jobId),
        rawImageBlob: file
      });

      // 3. Trigger Offscreen Pipeline
      await db.translationJobs.update(jobId, { status: 'processing' });
      chrome.runtime.sendMessage({
        type: 'PROCESS_JOB',
        payload: { jobId: Number(jobId) }
      }, async (response) => {
        console.log('[Dashboard] Pipeline response for local file:', response);
        await loadJobs();
        setActiveJobId(Number(jobId));
      });

      await loadJobs();
      setActiveJobId(Number(jobId));
    } catch (err) {
      console.error('[Dashboard] Local upload failed:', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * Persists real-time inline text edits for a selected speech bubble block into Dexie.
   *
   * @param blockId - Numeric identifier of the edited TextBlock record.
   * @param newText - Updated translated text content.
   */
  const handleTextChange = async (blockId: number, newText: string) => {
    // When text is edited, clear cached static lines so the live preview updates immediately with newText
    setTextBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, translatedText: newText, lines: undefined } : b))
    );
    try {
      await db.textBlocks.update(blockId, { translatedText: newText, lines: undefined });
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
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = block.color || '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Draw stroke outline
      ctx.lineWidth = Math.max(1, fontSize * 0.1);
      ctx.strokeStyle = '#FFFFFF';
      const cx = block.posX + block.width / 2;
      const cy = block.posY + block.height / 2;
      const lines = block.lines?.filter((line) => line.trim()) || [block.translatedText];
      const lineHeight = fontSize * 1.2;
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
    <div className="flex h-screen w-full font-body overflow-hidden selection:bg-editorial selection:text-vellum bg-paper text-ink">
      
      {/* 1. LEFT SIDEBAR: History & Jobs */}
      <aside className="w-[300px] h-full bg-paper flex flex-col border-r border-dust/30 z-10 shrink-0">
        <div className="p-4 border-b border-dust/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-bold tracking-widest text-ink">KITES</h1>
            <span className="text-[10px] font-mono uppercase bg-editorial/10 text-editorial px-2 py-0.5 rounded">STUDIO</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-1.5 text-dust hover:text-ink hover:bg-dust/20 rounded transition-colors"
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
                  onClick={() => setActiveJobId(job.id!)}
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
                    onClick={(e) => handleDeleteJob(job.id!, e)}
                    className={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500 hover:text-white transition-opacity ${
                      isActive ? 'text-dust hover:text-white' : 'text-dust'
                    }`}
                    title="Delete Job"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-dust/20 text-[11px] font-mono text-dust flex items-center justify-between">
          <span>Dexie v4 IndexedDB</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Ready
          </span>
        </div>
      </aside>

      {/* 2. CENTER STAGE: Canvas Viewport (XianScan Style) */}
      <main className="flex-1 h-full bg-glass relative flex flex-col overflow-hidden">
        
        {/* Top Control Bar */}
        <header className="h-12 border-b border-dust/20 bg-paper/80 backdrop-blur px-4 flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-dust uppercase">View:</span>
            <div className="flex items-center bg-dust/20 p-0.5 rounded text-xs">
              <button
                onClick={() => setViewMode('final')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  viewMode === 'final' ? 'bg-ink text-vellum shadow-xs' : 'text-ink hover:text-editorial'
                }`}
              >
                Typeset Preview
              </button>
              <button
                onClick={() => setViewMode('cleaned')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  viewMode === 'cleaned' ? 'bg-ink text-vellum shadow-xs' : 'text-ink hover:text-editorial'
                }`}
              >
                Clean Inpaint
              </button>
              <button
                onClick={() => setViewMode('original')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  viewMode === 'original' ? 'bg-ink text-vellum shadow-xs' : 'text-ink hover:text-editorial'
                }`}
              >
                Original Scan
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-dust/20 p-0.5 rounded">
              <button
                onClick={() => setZoom((z) => Math.max(z / 1.2, 0.2))}
                className="p-1 text-ink hover:text-editorial rounded transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono px-1 min-w-11 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(z * 1.2, 5))}
                className="p-1 text-ink hover:text-editorial rounded transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={resetViewport}
                className="p-1 text-ink hover:text-editorial rounded transition-colors ml-0.5"
                title="Reset View"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={handleExportPng}
              disabled={!imageRecord}
              className="flex items-center gap-1.5 px-3 py-1 bg-editorial text-white hover:bg-editorial/90 disabled:opacity-50 text-xs font-medium rounded transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export PNG</span>
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
                <div className="absolute inset-0 pointer-events-auto">
                  {textBlocks.map((block) => {
                    const isSelected = selectedBlockId === block.id;
                    const isHovered = hoveredBlockId === block.id;

                    return (
                      <div
                        key={block.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBlockId(block.id || null);
                        }}
                        onMouseEnter={() => setHoveredBlockId(block.id || null)}
                        onMouseLeave={() => setHoveredBlockId(null)}
                        className={`absolute transition-all cursor-pointer group ${
                          isSelected
                            ? 'ring-2 ring-editorial bg-editorial/15 z-20'
                            : isHovered
                            ? 'ring-1 ring-editorial/80 bg-editorial/10 z-10'
                            : 'border border-dust/40 hover:border-editorial/60 z-0'
                        }`}
                        style={{
                          left: `${block.posX}px`,
                          top: `${block.posY}px`,
                          width: `${block.width}px`,
                          height: `${block.height}px`,
                        }}
                      >
                        {/* Corner markers */}
                        <div className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-editorial opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-editorial opacity-0 group-hover:opacity-100 transition-opacity" />

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
      <aside className="w-[340px] h-full bg-paper flex flex-col border-l border-dust/30 z-10 shrink-0">
        <div className="p-4 border-b border-dust/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-editorial" />
            <h2 className="text-xs font-mono tracking-widest text-dust uppercase">Detected Regions</h2>
          </div>
          <span className="text-xs font-mono bg-dust/20 px-2 py-0.5 rounded text-ink">
            {textBlocks.length} blocks
          </span>
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
                    <span>{Math.round(block.width)}×{Math.round(block.height)}px</span>
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
              className="text-xs font-mono text-editorial hover:underline"
            >
              Deselect
            </button>
          </div>
        )}
      </aside>

    </div>
  );
}
