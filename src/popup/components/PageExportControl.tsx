import { useState, useEffect, useRef, useCallback } from 'react';
import { Archive, Loader } from 'lucide-react';
import type { ChapterZipStatus, ChapterZipPhase } from '../../content/chapterZip';

/** Milliseconds between status polls while the popup is open and export is not busy. */
const POLL_INTERVAL_MS = 2000;
/** Milliseconds between progress polls while an export is in flight. */
const BUSY_POLL_INTERVAL_MS = 400;

/**
 * Sends an addressed message to the content script's top frame only, avoiding
 * duplicate ZIP archives when the manifest declares all_frames: true.
 *
 * @param type - Message type identifier.
 * @returns Content response or null when unreachable.
 */
async function sendToTopFrame<T>(type: string): Promise<T | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    return await chrome.tabs.sendMessage(tab.id, {
      type, target: 'content', source: 'popup', request: true,
    }, { frameId: 0 }) as T;
  } catch {
    return null;
  }
}

/**
 * Shows export readiness, triggers chapter ZIP download, and displays live progress.
 * Renders nothing when no translated pages are available, preventing an empty download action.
 *
 * @returns Self-contained popup section or null when inactive.
 */
export default function PageExportControl() {
  const [status, setStatus] = useState<ChapterZipStatus | null>(null);
  const [exporting, setExporting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const mountedRef = useRef(true);
  const exportingRef = useRef(false);
  const responseSequenceRef = useRef(0);

  /** @returns Nothing; only the newest request may update the active-tab readiness. */
  const poll = useCallback(async () => {
    const sequence = ++responseSequenceRef.current;
    const result = await sendToTopFrame<ChapterZipStatus>('GET_CHAPTER_ZIP_STATUS');
    if (mountedRef.current && sequence === responseSequenceRef.current) setStatus(result);
  }, []);

  const pollInterval = exporting || status?.busy ? BUSY_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
  useEffect(() => {
    mountedRef.current = true;
    void poll();
    timerRef.current = setInterval(poll, pollInterval);
    return () => {
      mountedRef.current = false;
      clearInterval(timerRef.current);
    };
  }, [poll, pollInterval]);

  /** @returns Nothing after exporting; content owns the archive even if the popup closes. */
  const handleExport = useCallback(async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    const sequence = ++responseSequenceRef.current;
    setExporting(true);
    try {
      const result = await sendToTopFrame<ChapterZipStatus>('EXPORT_CHAPTER_ZIP');
      if (mountedRef.current && sequence === responseSequenceRef.current) setStatus(result);
    } finally {
      exportingRef.current = false;
      if (mountedRef.current) {
        setExporting(false);
        void poll();
      }
    }
  }, [poll]);

  // Nothing to show when content script is not reachable.
  if (!status) return null;

  const total = status.total ?? 0;
  const busy = status.busy || exporting;
  const phase: ChapterZipPhase = status.phase ?? 'idle';
  const done = phase === 'success' || phase === 'partial';

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={handleExport}
        disabled={busy || total === 0}
        className={`w-full py-2 border font-semibold rounded flex items-center justify-center gap-2 text-sm transition-colors ${
          total === 0
            ? 'bg-[var(--color-vellum)] text-[var(--color-dust)] border-[var(--color-dust)] border-opacity-20 opacity-60 cursor-not-allowed'
            : done
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 cursor-pointer'
            : busy
            ? 'bg-[var(--color-vellum)] border-[var(--color-dust)] border-opacity-30 text-[var(--color-dust)] cursor-wait'
            : 'bg-[var(--color-vellum)] text-[var(--color-ink)] border-[var(--color-dust)] border-opacity-30 hover:border-[var(--color-editorial)] hover:text-[var(--color-editorial)] cursor-pointer'
        }`}
        title={
          total === 0
            ? 'No translated pages on this tab yet. Translate images to export chapter as ZIP.'
            : 'Download all translated pages as a ZIP archive'
        }
      >
        {busy ? <Loader size={16} className="animate-spin" /> : <Archive size={16} />}
        {busy
          ? `Exporting${status && status.percent > 0 ? ` ${status.percent}%` : '…'}`
          : done
          ? 'Re-download Chapter ZIP'
          : total > 0
          ? `Download ${total} Translated Pages`
          : 'Download Chapter ZIP (0 pages)'}
      </button>
      {status?.message && (phase !== 'idle') && (
        <p className={`text-xs px-1 leading-relaxed ${
          phase === 'error' ? 'text-red-500 dark:text-red-400' : 'text-[var(--color-dust)]'
        }`}>
          {status.message}
        </p>
      )}
    </div>
  );
}
