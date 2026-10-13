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
  md: 'width-md',
  lg: 'width-lg',
  full: 'width-full',
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
      className="kites-reader-modal"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 1000000,
        backgroundColor: 'rgba(10, 10, 10, 0.98)',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Top Controls Header Bar */}
      <header
        className="kites-reader-header"
        style={{
          height: '48px',
          minHeight: '48px',
          backgroundColor: 'rgba(18, 18, 18, 0.95)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          flexShrink: 0,
          zIndex: 1000001,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* Left: Close & Title & Page counter */}
        <div className="kites-reader-header-left" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <button
            onClick={onClose}
            className="kites-reader-btn"
            style={{
              padding: '6px 8px',
              borderRadius: '6px',
              color: 'rgba(255, 255, 255, 0.8)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
            title="Exit Reader (Esc)"
          >
            <X size={15} />
            <kbd className="kites-reader-kbd" style={{ fontSize: '10px', padding: '1px 4px', borderRadius: '3px', background: 'rgba(255, 255, 255, 0.15)' }}>
              Esc
            </kbd>
          </button>

          <div style={{ height: '16px', width: '1px', backgroundColor: 'rgba(255, 255, 255, 0.2)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span
              className="kites-reader-title"
              style={{ fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}
              title={title || document.title}
            >
              {title || document.title}
            </span>
            <span
              className="kites-reader-page-counter"
              style={{ fontSize: '11px', fontFamily: 'monospace', color: 'rgba(255, 255, 255, 0.5)', whiteSpace: 'nowrap' }}
            >
              {viewMode === 'webtoon'
                ? `Page ${activeScrollPage} / ${totalPages}`
                : `Page ${currentIndex + 1}${viewMode === 'double' && currentIndex + 1 < totalPages ? `-${currentIndex + 2}` : ''} / ${totalPages}`}
            </span>
          </div>
        </div>

        {/* Center: View Mode Selector */}
        <div
          className="kites-reader-mode-group"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            padding: '2px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <button
            onClick={() => setViewMode('webtoon')}
            className={`kites-reader-btn ${viewMode === 'webtoon' ? 'active' : ''}`}
            style={{
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              border: 'none',
              backgroundColor: viewMode === 'webtoon' ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
              color: viewMode === 'webtoon' ? '#ffffff' : 'rgba(255, 255, 255, 0.6)',
            }}
            title="Continuous Vertical Stream (Webtoon)"
          >
            <BookOpen size={13} />
            <span>Webtoon</span>
          </button>
          <button
            onClick={() => setViewMode('single')}
            className={`kites-reader-btn ${viewMode === 'single' ? 'active' : ''}`}
            style={{
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              border: 'none',
              backgroundColor: viewMode === 'single' ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
              color: viewMode === 'single' ? '#ffffff' : 'rgba(255, 255, 255, 0.6)',
            }}
            title="Single Page Mode"
          >
            <FileText size={13} />
            <span>Single</span>
          </button>
          <button
            onClick={() => setViewMode('double')}
            className={`kites-reader-btn ${viewMode === 'double' ? 'active' : ''}`}
            style={{
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              border: 'none',
              backgroundColor: viewMode === 'double' ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
              color: viewMode === 'double' ? '#ffffff' : 'rgba(255, 255, 255, 0.6)',
            }}
            title="Double Page Spread Mode"
          >
            <Columns size={13} />
            <span>Double</span>
          </button>
        </div>

        {/* Right: Width / Flip / Direction / ZIP */}
        <div className="kites-reader-header-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Width Preset (Webtoon only) */}
          {viewMode === 'webtoon' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                padding: '2px',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {(['md', 'lg', 'full'] as WebtoonWidthPreset[]).map((preset) => (
                <button
                  key={preset}
                  onClick={() => setWebtoonWidth(preset)}
                  className={`kites-reader-btn ${webtoonWidth === preset ? 'active' : ''}`}
                  style={{
                    padding: '3px 6px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    fontFamily: 'monospace',
                    fontSize: '10px',
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: webtoonWidth === preset ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
                    color: webtoonWidth === preset ? '#ffffff' : 'rgba(255, 255, 255, 0.5)',
                    fontWeight: webtoonWidth === preset ? 700 : 400,
                  }}
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
              className="kites-reader-btn"
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                color: 'rgba(255, 255, 255, 0.7)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.06)',
              }}
              title={`Reading Direction: ${isRtl ? 'Right-to-Left (Manga)' : 'Left-to-Right (Webtoon)'}`}
            >
              <ArrowLeftRight size={13} />
              <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>{isRtl ? 'RTL' : 'LTR'}</span>
            </button>
          )}

          {/* Original vs Translated Flip Toggle */}
          <button
            onClick={() => setShowOriginal((prev) => !prev)}
            className="kites-reader-btn"
            style={{
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              border: showOriginal ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(255, 255, 255, 0.15)',
              backgroundColor: showOriginal ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.08)',
              color: showOriginal ? '#fbbf24' : '#ffffff',
            }}
            title="Toggle Original Artwork / Translation (F)"
          >
            {showOriginal ? <EyeOff size={13} /> : <Eye size={13} />}
            <span>{showOriginal ? 'Original' : 'Translated'}</span>
            <kbd className="kites-reader-kbd" style={{ fontSize: '9px', padding: '1px 4px', background: 'rgba(255, 255, 255, 0.2)' }}>
              F
            </kbd>
          </button>

          {/* ZIP Export Button */}
          {onExportZip && (
            <button
              onClick={onExportZip}
              className="kites-reader-btn"
              style={{
                padding: '6px 8px',
                borderRadius: '6px',
                color: 'rgba(255, 255, 255, 0.8)',
                cursor: 'pointer',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
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
        className="kites-reader-viewport"
        style={{
          flex: '1 1 0%',
          overflowY: 'auto',
          overflowX: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          backgroundColor: '#050505',
          width: '100%',
          height: 'calc(100vh - 48px)',
          scrollBehavior: 'smooth',
        }}
      >
        {records.length === 0 ? (
          <div
            style={{
              flex: '1 1 0%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px',
              textAlign: 'center',
              color: 'rgba(255, 255, 255, 0.5)',
            }}
          >
            <BookOpen size={36} style={{ marginBottom: '12px', opacity: 0.4 }} />
            <p style={{ fontSize: '14px', fontWeight: 500, margin: '0 0 6px 0' }}>No translated pages available in this chapter.</p>
            <p style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)', margin: 0 }}>Translate pages on the host site to view them here.</p>
          </div>
        ) : viewMode === 'webtoon' ? (
          /* Continuous Vertical Stream (Webtoon) */
          <div
            className={`kites-reader-webtoon-container ${WIDTH_CLASSES[webtoonWidth]}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: '100%',
              maxWidth: webtoonWidth === 'md' ? '768px' : webtoonWidth === 'lg' ? '1024px' : '100%',
              margin: '0 auto',
              padding: 0,
            }}
          >
            {records.map((page, idx) => {
              const src = showOriginal ? page.originalUrl : page.translatedUrl;
              return (
                <div
                  key={`${page.originalUrl}-${idx}`}
                  data-reader-page={idx + 1}
                  className="kites-reader-page-item"
                  style={{
                    position: 'relative',
                    width: '100%',
                    backgroundColor: '#000000',
                    lineHeight: 0,
                    margin: 0,
                    padding: 0,
                  }}
                >
                  <img
                    src={src}
                    alt={`Page ${idx + 1}`}
                    loading="lazy"
                    className="kites-reader-page-img"
                    style={{
                      width: '100%',
                      height: 'auto',
                      display: 'block',
                      userSelect: 'none',
                      margin: 0,
                      padding: 0,
                      border: 'none',
                    }}
                    draggable={false}
                  />
                  {/* Subtle page indicator badge */}
                  <div
                    className="kites-reader-page-badge"
                    style={{
                      position: 'absolute',
                      right: '12px',
                      bottom: '12px',
                      backgroundColor: 'rgba(0, 0, 0, 0.75)',
                      color: 'rgba(255, 255, 255, 0.75)',
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      pointerEvents: 'none',
                    }}
                  >
                    p. {idx + 1}
                  </div>
                </div>
              );
            })}
          </div>
        ) : viewMode === 'single' ? (
          /* Single Page View */
          <div
            className="kites-reader-panel-container"
            style={{
              flex: '1 1 0%',
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              padding: '16px',
              boxSizing: 'border-box',
            }}
          >
            {records[currentIndex] && (
              <img
                src={showOriginal ? records[currentIndex].originalUrl : records[currentIndex].translatedUrl}
                alt={`Page ${currentIndex + 1}`}
                className="kites-reader-single-img"
                style={{
                  maxHeight: 'calc(100vh - 80px)',
                  maxWidth: '100%',
                  objectFit: 'contain',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                  display: 'block',
                }}
                draggable={false}
              />
            )}

            {/* Click zones for navigation */}
            <button
              onClick={() => setCurrentIndex((prev) => (isRtl ? Math.min(totalPages - 1, prev + 1) : Math.max(0, prev - 1)))}
              disabled={isRtl ? currentIndex >= totalPages - 1 : currentIndex <= 0}
              className="kites-reader-nav-prev"
              style={{
                position: 'absolute',
                left: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '48px',
                height: '80px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                cursor: 'pointer',
                zIndex: 1000002,
              }}
              title={isRtl ? 'Next Page' : 'Previous Page'}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={() => setCurrentIndex((prev) => (isRtl ? Math.max(0, prev - 1) : Math.min(totalPages - 1, prev + 1)))}
              disabled={isRtl ? currentIndex <= 0 : currentIndex >= totalPages - 1}
              className="kites-reader-nav-next"
              style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '48px',
                height: '80px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                cursor: 'pointer',
                zIndex: 1000002,
              }}
              title={isRtl ? 'Previous Page' : 'Next Page'}
            >
              <ChevronRight size={24} />
            </button>
          </div>
        ) : (
          /* Double Page Spread View */
          <div
            className="kites-reader-panel-container"
            style={{
              flex: '1 1 0%',
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              padding: '16px',
              boxSizing: 'border-box',
            }}
          >
            <div
              className="kites-reader-double-container"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                maxHeight: 'calc(100vh - 80px)',
                maxWidth: '100%',
                flexDirection: isRtl ? 'row-reverse' : 'row',
              }}
            >
              {records[currentIndex] && (
                <img
                  src={showOriginal ? records[currentIndex].originalUrl : records[currentIndex].translatedUrl}
                  alt={`Page ${currentIndex + 1}`}
                  className="kites-reader-double-img"
                  style={{
                    maxHeight: 'calc(100vh - 80px)',
                    maxWidth: 'calc(50vw - 24px)',
                    objectFit: 'contain',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                    display: 'block',
                  }}
                  draggable={false}
                />
              )}
              {currentIndex + 1 < totalPages && records[currentIndex + 1] && (
                <img
                  src={showOriginal ? records[currentIndex + 1].originalUrl : records[currentIndex + 1].translatedUrl}
                  alt={`Page ${currentIndex + 2}`}
                  className="kites-reader-double-img"
                  style={{
                    maxHeight: 'calc(100vh - 80px)',
                    maxWidth: 'calc(50vw - 24px)',
                    objectFit: 'contain',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                    display: 'block',
                  }}
                  draggable={false}
                />
              )}
            </div>

            {/* Click navigation */}
            <button
              onClick={() => setCurrentIndex((prev) => (isRtl ? Math.min(totalPages - 1, prev + 2) : Math.max(0, prev - 2)))}
              disabled={isRtl ? currentIndex + 1 >= totalPages - 1 : currentIndex <= 0}
              className="kites-reader-nav-prev"
              style={{
                position: 'absolute',
                left: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '48px',
                height: '80px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                cursor: 'pointer',
                zIndex: 1000002,
              }}
              title={isRtl ? 'Next Spread' : 'Previous Spread'}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={() => setCurrentIndex((prev) => (isRtl ? Math.max(0, prev - 2) : Math.min(totalPages - 1, prev + 2)))}
              disabled={isRtl ? currentIndex <= 0 : currentIndex + 1 >= totalPages - 1}
              className="kites-reader-nav-next"
              style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '48px',
                height: '80px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                cursor: 'pointer',
                zIndex: 1000002,
              }}
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
