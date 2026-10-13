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
      className={`fixed bottom-5 right-5 z-[999998] flex items-center bg-black/80 hover:bg-black/95 text-white text-xs rounded-full shadow-2xl border border-white/20 backdrop-blur-md transition-all duration-200 select-none ${
        isScrolling ? 'opacity-30 hover:opacity-100' : 'opacity-100'
      }`}
    >
      <button
        onClick={onOpen}
        className="flex items-center gap-2 pl-3.5 pr-2.5 py-1.5 hover:text-[var(--color-editorial)] transition-colors cursor-pointer font-medium"
        title="Open Distraction-Free Chapter Reader"
      >
        <BookOpen size={14} className="text-[var(--color-editorial)]" />
        <span>Read Chapter</span>
        <span className="font-mono text-[10px] bg-white/20 px-1.5 py-0.2 rounded-full font-bold">
          {pageCount}
        </span>
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="pr-2.5 pl-1 py-1.5 text-white/50 hover:text-white transition-colors cursor-pointer"
        title="Dismiss for this page"
      >
        <X size={12} />
      </button>
    </div>
  );
}
