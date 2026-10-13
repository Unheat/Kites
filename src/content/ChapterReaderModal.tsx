import { useEffect, useState, useRef, useCallback } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Columns,
  FileText,
  Download,
  BookOpen,
  ArrowLeftRight,
} from 'lucide-react';
import type { ChapterTranslationRecord } from './chapterZip';

export type ReaderViewMode = 'webtoon' | 'single' | 'double';
export type WebtoonWidthPreset = 'md' | 'lg' | 'full';

export interface ChapterReaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: ChapterTranslationRecord[];
  title?: string;
  onExportZip?: () => void;
}

const WIDTH_CLASSES: Record<WebtoonWidthPreset, string> = {
  md: 'max-w-2xl',  // ~672px
  lg: 'max-w-4xl',  // ~896px
  full: 'w-full',   // 100%
};

/**
 * Distraction-free full-screen chapter reader modal displaying translated manga/webtoon pages.
 * Collects pages directly from in-memory translated registry and isolates from host site clutter.
 *
 * @param props - Component props containing open state, close callback, and chapter records.
 * @returns The rendered full-screen reader modal or null.
 */
export default function ChapterReaderModal({
  isOpen,
  onClose,
  records,
  title,
  onExportZip,
}: ChapterReaderModalProps) {
  const [viewMode, setViewMode] = useState<ReaderViewMode>('webtoon');
  const [webtoonWidth, setWebtoonWidth] = useState<WebtoonWidthPreset>('md');
  const [showOriginal, setShowOriginal] = useState(false);
  const [isRtl, setIsRtl] = useState(true); // Default RTL for Japanese manga
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeScrollPage, setActiveScrollPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalPages = records.length;

  // Lock body scroll while modal is mounted
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing inside an editable field
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        if (!e.altKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setShowOriginal((prev) => !prev);
          return;
        }
      }

      if (e.key === 'w' || e.key === 'W') {
        if (!e.altKey && !e.ctrlKey && !e.metaKey && viewMode === 'webtoon') {
          e.preventDefault();
          setWebtoonWidth((prev) => (prev === 'md' ? 'lg' : prev === 'lg' ? 'full' : 'md'));
          return;
        }
      }

      if (viewMode === 'single' || viewMode === 'double') {
        const step = viewMode === 'double' ? 2 : 1;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (isRtl) {
            // RTL: ArrowRight = previous page
            setCurrentIndex((prev) => Math.max(0, prev - step));
          } else {
            // LTR: ArrowRight = next page
            setCurrentIndex((prev) => Math.min(totalPages - 1, prev + step));
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (isRtl) {
            // RTL: ArrowLeft = next page
            setCurrentIndex((prev) => Math.min(totalPages - 1, prev + step));
          } else {
            // LTR: ArrowLeft = previous page
            setCurrentIndex((prev) => Math.max(0, prev - step));
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, viewMode, totalPages, isRtl]);

  // Track active page during continuous vertical scrolling
  const handleScroll = useCallback(() => {
    if (viewMode !== 'webtoon' || !containerRef.current) return;
    const container = containerRef.current;
    const pageElements = container.querySelectorAll<HTMLElement>('[data-reader-page]');
    const viewportMiddle = container.scrollTop + container.clientHeight / 2;

    for (const el of Array.from(pageElements)) {
      const top = el.offsetTop;
      const height = el.offsetHeight;
      if (viewportMiddle >= top && viewportMiddle <= top + height) {
        const pageNum = Number(el.getAttribute('data-reader-page'));
        if (pageNum) setActiveScrollPage(pageNum);
        break;
      }
    }
  }, [viewMode]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Distraction-Free Chapter Reader"
      className="fixed inset-0 z-[1000000] bg-black/95 text-white flex flex-col select-none font-sans"
    >
      {/* Top Controls Header Bar */}
      <header className="h-12 bg-black/80 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between text-xs shrink-0 z-30">
        {/* Left: Close & Title & Page counter */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
            title="Exit Reader (Esc)"
          >
            <X size={16} />
            <kbd className="hidden sm:inline px-1 py-0.5 rounded text-[10px] font-mono bg-white/15 text-white/80">
              Esc
            </kbd>
          </button>

          <div className="h-4 w-px bg-white/20 hidden sm:block" />

          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold truncate max-w-[200px] sm:max-w-xs text-white" title={title || document.title}>
              {title || document.title}
            </span>
            <span className="text-[11px] font-mono text-white/50 shrink-0">
              {viewMode === 'webtoon'
                ? `Page ${activeScrollPage} / ${totalPages}`
                : `Page ${currentIndex + 1}${viewMode === 'double' && currentIndex + 1 < totalPages ? `-${currentIndex + 2}` : ''} / ${totalPages}`}
            </span>
          </div>
        </div>

        {/* Center: View Mode Selector */}
        <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10">
          <button
            onClick={() => setViewMode('webtoon')}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
              viewMode === 'webtoon' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'
            }`}
            title="Continuous Vertical Stream (Webtoon)"
          >
            <BookOpen size={13} />
            <span className="hidden md:inline">Webtoon</span>
          </button>
          <button
            onClick={() => setViewMode('single')}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
              viewMode === 'single' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'
            }`}
            title="Single Page Mode"
          >
            <FileText size={13} />
            <span className="hidden md:inline">Single</span>
          </button>
          <button
            onClick={() => setViewMode('double')}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
              viewMode === 'double' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'
            }`}
            title="Double Page Spread Mode"
          >
            <Columns size={13} />
            <span className="hidden md:inline">Double</span>
          </button>
        </div>

        {/* Right: Width / Flip / Direction / ZIP */}
        <div className="flex items-center gap-2">
          {/* Width Preset (Webtoon only) */}
          {viewMode === 'webtoon' && (
            <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded border border-white/10 text-[11px]">
              {(['md', 'lg', 'full'] as WebtoonWidthPreset[]).map((preset) => (
                <button
                  key={preset}
                  onClick={() => setWebtoonWidth(preset)}
                  className={`px-1.5 py-0.5 rounded uppercase font-mono text-[10px] cursor-pointer ${
                    webtoonWidth === preset ? 'bg-white/20 text-white font-bold' : 'text-white/50 hover:text-white'
                  }`}
                  title={`Width: ${preset}`}
                >
                  {preset}
                </button>
              ))}
            </div>
          )}

          {/* Reading Direction Toggle (Single/Double mode) */}
          {(viewMode === 'single' || viewMode === 'double') && (
            <button
              onClick={() => setIsRtl((prev) => !prev)}
              className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
              title={`Reading Direction: ${isRtl ? 'Right-to-Left (Manga)' : 'Left-to-Right (Webtoon)'}`}
            >
              <ArrowLeftRight size={13} />
              <span className="font-mono text-[10px]">{isRtl ? 'RTL' : 'LTR'}</span>
            </button>
          )}

          {/* Original vs Translated Flip Toggle */}
          <button
            onClick={() => setShowOriginal((prev) => !prev)}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer border ${
              showOriginal
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                : 'bg-white/10 border-white/15 text-white hover:bg-white/20'
            }`}
            title="Toggle Original Artwork / Translation (F)"
          >
            {showOriginal ? <EyeOff size={13} /> : <Eye size={13} />}
            <span className="hidden sm:inline">{showOriginal ? 'Original' : 'Translated'}</span>
            <kbd className="px-1 py-0.2 rounded text-[9px] font-mono bg-white/20">F</kbd>
          </button>

          {/* ZIP Export Button */}
          {onExportZip && (
            <button
              onClick={onExportZip}
              className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Download Chapter ZIP"
            >
              <Download size={14} />
            </button>
          )}
        </div>
      </header>

      {/* Main Reading Viewport Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col items-center bg-black/95 scroll-smooth"
      >
        {records.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-white/50">
            <BookOpen size={36} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">No translated pages available in this chapter.</p>
            <p className="text-xs text-white/40 mt-1">Translate pages on the host site to view them here.</p>
          </div>
        ) : viewMode === 'webtoon' ? (
          /* Continuous Vertical Stream (Webtoon) */
          <div className={`flex flex-col items-center w-full ${WIDTH_CLASSES[webtoonWidth]}`}>
            {records.map((page, idx) => {
              const src = showOriginal ? page.originalUrl : page.translatedUrl;
              return (
                <div
                  key={`${page.originalUrl}-${idx}`}
                  data-reader-page={idx + 1}
                  className="relative w-full bg-black leading-none m-0 p-0 group"
                >
                  <img
                    src={src}
                    alt={`Page ${idx + 1}`}
                    loading="lazy"
                    className="w-full h-auto block select-none"
                    draggable={false}
                  />
                  {/* Subtle page indicator badge on hover */}
                  <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur text-white/70 text-[10px] font-mono px-2 py-0.5 rounded pointer-events-none">
                    p. {idx + 1}
                  </div>
                </div>
              );
            })}
          </div>
        ) : viewMode === 'single' ? (
          /* Single Page View */
          <div className="flex-1 w-full flex items-center justify-center relative p-2">
            {records[currentIndex] && (
              <img
                src={showOriginal ? records[currentIndex].originalUrl : records[currentIndex].translatedUrl}
                alt={`Page ${currentIndex + 1}`}
                className="max-h-[calc(100vh-64px)] max-w-full object-contain shadow-2xl"
                draggable={false}
              />
            )}

            {/* Click zones for navigation */}
            <button
              onClick={() => setCurrentIndex((prev) => (isRtl ? Math.min(totalPages - 1, prev + 1) : Math.max(0, prev - 1)))}
              disabled={isRtl ? currentIndex >= totalPages - 1 : currentIndex <= 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/60 hover:bg-black/90 text-white/70 hover:text-white transition-all disabled:opacity-0 cursor-pointer shadow-xl border border-white/10"
              title={isRtl ? 'Next Page' : 'Previous Page'}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={() => setCurrentIndex((prev) => (isRtl ? Math.max(0, prev - 1) : Math.min(totalPages - 1, prev + 1)))}
              disabled={isRtl ? currentIndex <= 0 : currentIndex >= totalPages - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/60 hover:bg-black/90 text-white/70 hover:text-white transition-all disabled:opacity-0 cursor-pointer shadow-xl border border-white/10"
              title={isRtl ? 'Previous Page' : 'Next Page'}
            >
              <ChevronRight size={24} />
            </button>
          </div>
        ) : (
          /* Double Page Spread View */
          <div className="flex-1 w-full flex items-center justify-center relative p-2">
            <div className={`flex items-center justify-center gap-1 max-h-[calc(100vh-64px)] max-w-full ${isRtl ? 'flex-row-reverse' : 'flex-row'}`}>
              {records[currentIndex] && (
                <img
                  src={showOriginal ? records[currentIndex].originalUrl : records[currentIndex].translatedUrl}
                  alt={`Page ${currentIndex + 1}`}
                  className="max-h-[calc(100vh-64px)] max-w-[50vw] object-contain shadow-2xl"
                  draggable={false}
                />
              )}
              {currentIndex + 1 < totalPages && records[currentIndex + 1] && (
                <img
                  src={showOriginal ? records[currentIndex + 1].originalUrl : records[currentIndex + 1].translatedUrl}
                  alt={`Page ${currentIndex + 2}`}
                  className="max-h-[calc(100vh-64px)] max-w-[50vw] object-contain shadow-2xl"
                  draggable={false}
                />
              )}
            </div>

            {/* Click navigation */}
            <button
              onClick={() => setCurrentIndex((prev) => (isRtl ? Math.min(totalPages - 1, prev + 2) : Math.max(0, prev - 2)))}
              disabled={isRtl ? currentIndex + 1 >= totalPages - 1 : currentIndex <= 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/60 hover:bg-black/90 text-white/70 hover:text-white transition-all disabled:opacity-0 cursor-pointer shadow-xl border border-white/10"
              title={isRtl ? 'Next Spread' : 'Previous Spread'}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={() => setCurrentIndex((prev) => (isRtl ? Math.max(0, prev - 2) : Math.min(totalPages - 1, prev + 2)))}
              disabled={isRtl ? currentIndex <= 0 : currentIndex + 1 >= totalPages - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/60 hover:bg-black/90 text-white/70 hover:text-white transition-all disabled:opacity-0 cursor-pointer shadow-xl border border-white/10"
              title={isRtl ? 'Previous Spread' : 'Next Spread'}
            >
              <ChevronRight size={24} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
