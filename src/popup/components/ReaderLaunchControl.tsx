import { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen } from 'lucide-react';
import type { ChapterZipStatus } from '../../content/chapterZip';

const POLL_INTERVAL_MS = 2500;

async function sendToTopFrame<T>(type: string): Promise<T | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    return await chrome.tabs.sendMessage(tab.id, {
      target: 'content',
      source: 'popup',
      request: true,
      type,
    }, { frameId: 0 });
  } catch {
    return null;
  }
}

/**
 * Launch button rendered in the extension popup footer when translated chapter pages exist.
 * Triggers the in-page distraction-free reader mode modal.
 *
 * @returns Launch button or null when no translated pages are available on the active tab.
 */
export default function ReaderLaunchControl() {
  const [pageCount, setPageCount] = useState(0);
  const mountedRef = useRef(true);

  const checkStatus = useCallback(async () => {
    const status = await sendToTopFrame<ChapterZipStatus>('GET_CHAPTER_ZIP_STATUS');
    if (mountedRef.current && status) {
      setPageCount(status.total || 0);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void checkStatus();
    const interval = setInterval(checkStatus, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [checkStatus]);

  if (pageCount === 0) return null;

  const handleOpenReader = async () => {
    try {
      await sendToTopFrame('OPEN_CHAPTER_READER');
      window.close();
    } catch (err) {
      console.warn('[Popup] Failed to open chapter reader:', err);
    }
  };

  return (
    <button
      onClick={handleOpenReader}
      className="w-full py-2 bg-[var(--color-ink)] text-[var(--color-paper)] font-bold rounded hover:bg-[var(--color-editorial)] transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm shadow-md"
      title="Open distraction-free fullscreen reader for this chapter"
    >
      <BookOpen size={16} className="text-[var(--color-editorial)]" />
      <span>Open Chapter Reader</span>
      <span className="font-mono text-xs opacity-80 font-normal">({pageCount})</span>
    </button>
  );
}
