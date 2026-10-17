import { useEffect, useState, useRef } from 'react';
import { BookOpen, X } from 'lucide-react';

interface ChapterReaderFloatingPillProps {
  pageCount: number;
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * Discreet floating pill docked at the bottom-right of the manga reading page.
 * Appears when multiple translated pages exist, allowing immediate entry into
 * distraction-free chapter reader mode without opening the extension popup.
 *
 * @param props - Page count, open handler, and dismissal callback.
 * @returns Floating pill element or null.
 */
export default function ChapterReaderFloatingPill({
  pageCount,
  onOpen,
  onDismiss,
}: ChapterReaderFloatingPillProps) {
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolling(true);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 400);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  if (pageCount < 2) return null;

  return (
    <div
      className={`kites-reader-pill ${isScrolling ? 'kites-scrolling' : ''}`}
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 999998,
        display: 'flex',
        alignItems: 'center',
        backgroundColor: 'rgba(18, 18, 18, 0.92)',
        color: '#ffffff',
        fontSize: '12px',
        borderRadius: '9999px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        opacity: isScrolling ? 0.35 : 1,
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <button
        onClick={onOpen}
        className="kites-reader-pill-btn"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px 6px 14px',
          background: 'transparent',
          border: 'none',
          color: '#ffffff',
          cursor: 'pointer',
          fontWeight: 500,
          fontSize: '12px',
          lineHeight: 1,
        }}
        title="Open Distraction-Free Chapter Reader"
      >
        <BookOpen size={14} color="#f4446d" />
        <span>Open Reader</span>
        <span
          className="kites-reader-pill-count"
          style={{
            fontFamily: 'monospace',
            fontSize: '10px',
            fontWeight: 700,
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            padding: '2px 6px',
            borderRadius: '9999px',
          }}
        >
          {pageCount}
        </span>
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="kites-reader-pill-close"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 10px 6px 4px',
          background: 'transparent',
          border: 'none',
          color: 'rgba(255, 255, 255, 0.45)',
          cursor: 'pointer',
        }}
        title="Dismiss for this page"
      >
        <X size={12} />
      </button>
    </div>
  );
}
