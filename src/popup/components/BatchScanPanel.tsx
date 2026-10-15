import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap,
  RotateCcw,
  CheckSquare,
  Square,
  Loader,
  BookOpen,
  Check,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import type { ScannedPageImage } from '../../content/scanner';

interface QueueJobStatus {
  srcUrl: string;
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
}

/**
 * XianScan-inspired Batch Chapter Page Scanner and Queue Manager panel.
 * Discovers comic strip images on the active reading tab, displays a scrollable
 * thumbnail gallery, and lets users select and queue pages for translation.
 *
 * @returns The rendered batch scanner panel.
 */
export default function BatchScanPanel() {
  const [pages, setPages] = useState<ScannedPageImage[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [isFastScanning, setIsFastScanning] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [needsTabReload, setNeedsTabReload] = useState(false);
  const [activeJobs, setActiveJobs] = useState<Map<string, string>>(new Map());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const mountedRef = useRef(true);

  // Resolves the active tab ID
  const getActiveTab = useCallback(async (): Promise<chrome.tabs.Tab | null> => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch {
      return null;
    }
  }, []);

  // Polls background queue for job statuses
  const pollQueueStatus = useCallback(async () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_QUEUE_STATUS' });
      if (mountedRef.current && res?.status === 'success' && Array.isArray(res.jobs)) {
        const jobMap = new Map<string, string>();
        for (const job of res.jobs as QueueJobStatus[]) {
          if (job.srcUrl) {
            jobMap.set(job.srcUrl, job.status);
          }
        }
        setActiveJobs(jobMap);
      }
    } catch {}
  }, []);

  // Performs snapshot scan on the active tab
  const scanPages = useCallback(async () => {
    setIsScanning(true);
    setStatusMessage(null);
    try {
      const tab = await getActiveTab();
      if (!tab?.id) {
        setIsScanning(false);
        return;
      }
      setActiveTabId(tab.id);

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'SCAN_CHAPTER_PAGES',
        target: 'content',
        source: 'popup',
        request: true,
      }, { frameId: 0 });

      if (mountedRef.current && response?.status === 'success' && Array.isArray(response.pages)) {
        const scanned: ScannedPageImage[] = response.pages;
        setPages(scanned);

        // Pre-select untranslated pages by default
        const initialSelected = new Set<string>();
        for (const page of scanned) {
          if (!page.isTranslated) {
            initialSelected.add(page.url);
          }
        }
        // If all are translated or none, select all
        if (initialSelected.size === 0 && scanned.length > 0) {
          for (const page of scanned) initialSelected.add(page.url);
        }
        setSelectedUrls(initialSelected);
      }
    } catch (err: any) {
      console.warn('[BatchScan] Snapshot scan failed:', err);
      const msg = err?.message || String(err);
      if (msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist')) {
        setNeedsTabReload(true);
      }
    } finally {
      if (mountedRef.current) setIsScanning(false);
    }
  }, [getActiveTab]);

  // Triggers XianScan fast-scroll preload to un-lazy and mount all panels
  const handleFastScan = async () => {
    if (isFastScanning) return;
    setIsFastScanning(true);
    setStatusMessage('Auto-scrolling page to mount lazy comic panels...');
    try {
      const tab = await getActiveTab();
      if (!tab?.id) return;

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'FAST_SCROLL_PRELOAD',
        target: 'content',
        source: 'popup',
        request: true,
      }, { frameId: 0 });

      if (mountedRef.current && response?.status === 'success' && Array.isArray(response.pages)) {
        const scanned: ScannedPageImage[] = response.pages;
        setPages(scanned);

        // Update selections to include newly discovered pages
        setSelectedUrls((prev) => {
          const next = new Set(prev);
          for (const page of scanned) {
            if (!page.isTranslated) next.add(page.url);
          }
          return next;
        });
        setStatusMessage(`Found ${scanned.length} chapter pages`);
        setTimeout(() => {
          if (mountedRef.current) setStatusMessage(null);
        }, 3000);
      }
    } catch (err: any) {
      console.warn('[BatchScan] Fast scan failed:', err);
      const msg = err?.message || String(err);
      if (msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist')) {
        setNeedsTabReload(true);
      } else {
        setStatusMessage('Fast scan timed out or reader is restricted');
      }
    } finally {
      if (mountedRef.current) setIsFastScanning(false);
    }
  };

  // Dispatches batch translation request to background
  const handleQueueSelected = async () => {
    if (isQueueing || selectedUrls.size === 0) return;
    setIsQueueing(true);
    const urlsToQueue = Array.from(selectedUrls).filter((url) => {
      const jobStatus = activeJobs.get(url);
      const isAlreadyActive = jobStatus === 'queued' || jobStatus === 'downloading' || jobStatus === 'processing';
      const isPageTranslated = pages.find((p) => p.url === url)?.isTranslated;
      return !isAlreadyActive && !isPageTranslated;
    });

    if (urlsToQueue.length === 0) {
      setStatusMessage('All selected pages are already translated or queued');
      setIsQueueing(false);
      return;
    }

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'BATCH_QUEUE_TRANSLATIONS',
        payload: { urls: urlsToQueue },
        tabId: activeTabId || undefined,
      });

      if (res?.status === 'success') {
        setStatusMessage(`Queued ${res.queuedCount} pages for translation!`);
        void pollQueueStatus();
        setTimeout(() => {
          if (mountedRef.current) setStatusMessage(null);
        }, 4000);
      } else {
        setStatusMessage(res?.error || 'Failed to queue translations');
      }
    } catch (err) {
      console.error('[BatchScan] Failed to queue batch translations:', err);
      setStatusMessage('Failed to queue translations');
    } finally {
      if (mountedRef.current) setIsQueueing(false);
    }
  };

  // Toggle selection for a single page
  const togglePageSelection = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  // Select all or deselect all
  const toggleSelectAll = () => {
    if (selectedUrls.size === pages.length) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(pages.map((p) => p.url)));
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void scanPages();
    void pollQueueStatus();
    const timer = setInterval(() => {
      void pollQueueStatus();
    }, 2000);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [scanPages, pollQueueStatus]);

  const totalPages = pages.length;
  const selectedCount = selectedUrls.size;
  const allSelected = totalPages > 0 && selectedCount === totalPages;

  return (
    <div className="flex flex-col gap-2.5 text-xs">
      {/* Top Controls Toolbar */}
      <div className="p-2.5 rounded bg-[var(--color-vellum)] border border-[var(--color-dust)] border-opacity-30 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer font-medium select-none min-w-0">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            disabled={totalPages === 0}
            className="rounded border-[var(--color-dust)] text-[var(--color-editorial)] focus:ring-0 cursor-pointer"
          />
          <span className="font-mono text-[11px] text-[var(--color-ink)] truncate">
            {selectedCount} / {totalPages} pages
          </span>
        </label>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={scanPages}
            disabled={isScanning || isFastScanning}
            className="p-1 rounded hover:bg-[var(--color-paper)] text-[var(--color-dust)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
            title="Rescan current page DOM"
          >
            <RotateCcw size={14} className={isScanning ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={handleFastScan}
            disabled={isFastScanning || isScanning}
            className="px-2 py-1 rounded bg-[var(--color-paper)] hover:bg-[var(--color-editorial)] hover:text-white border border-[var(--color-dust)] border-opacity-30 font-semibold transition-all flex items-center gap-1 text-[11px] cursor-pointer shadow-sm disabled:opacity-50"
            title="Auto-scroll reader page to mount all lazy-loaded comic panels"
          >
            {isFastScanning ? <Loader size={12} className="animate-spin" /> : <Zap size={12} className="text-amber-500" />}
            <span>{isFastScanning ? 'Scanning…' : 'Fast Scan'}</span>
          </button>
        </div>
      </div>

      {/* Tab Reload Needed Prompt */}
      {needsTabReload && (
        <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-500" />
            <div className="text-[11px] leading-snug">
              <p className="font-semibold text-[var(--color-ink)]">Extension Updated</p>
              <p className="opacity-80 mt-0.5">Please reload this tab to connect the updated extension.</p>
            </div>
          </div>
          <button
            onClick={async () => {
              const tab = await getActiveTab();
              if (tab?.id) {
                chrome.tabs.reload(tab.id);
                window.close();
              }
            }}
            className="w-full py-1 bg-amber-500 text-black font-bold rounded text-[11px] cursor-pointer hover:bg-amber-400 transition-colors shadow-sm"
          >
            Reload Tab Now
          </button>
        </div>
      )}

      {/* Status banner */}
      {statusMessage && (
        <div className="px-2.5 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] leading-snug">
          {statusMessage}
        </div>
      )}

      {/* Thumbnail Gallery Grid */}
      <div className="max-h-[340px] overflow-y-auto pr-0.5 rounded border border-[var(--color-dust)] border-opacity-20 bg-[var(--color-paper)] p-1.5">
        {isScanning && pages.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center text-[var(--color-dust)]">
            <Loader size={24} className="animate-spin mb-2 text-[var(--color-editorial)]" />
            <p className="font-medium text-xs">Scanning reader page...</p>
          </div>
        ) : pages.length === 0 ? (
          <div className="py-8 px-4 flex flex-col items-center justify-center text-center text-[var(--color-dust)]">
            <BookOpen size={28} className="mb-2 opacity-50" />
            <p className="font-semibold text-xs text-[var(--color-ink)]">No reader images detected</p>
            <p className="text-[11px] mt-1 leading-relaxed opacity-80">
              Open a manga or webtoon chapter reader tab. If panels are lazy-loaded, click <b>Fast Scan</b> above to auto-scroll.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {pages.map((page, idx) => {
              const isSelected = selectedUrls.has(page.url);
              const jobStatus = activeJobs.get(page.url);
              const isBusy = jobStatus === 'queued' || jobStatus === 'downloading' || jobStatus === 'processing';

              return (
                <div
                  key={page.id || `${page.url}-${idx}`}
                  onClick={() => togglePageSelection(page.url)}
                  className={`relative rounded border transition-all cursor-pointer select-none overflow-hidden flex flex-col bg-[var(--color-vellum)] ${
                    isSelected
                      ? 'border-[var(--color-editorial)] shadow-md ring-1 ring-[var(--color-editorial)]'
                      : 'border-[var(--color-dust)] border-opacity-30 opacity-80 hover:opacity-100'
                  }`}
                >
                  {/* Top Badges Bar */}
                  <div className="absolute top-1 left-1 z-10 bg-black/75 backdrop-blur text-white text-[9px] font-mono px-1.5 py-0.5 rounded font-bold">
                    #{idx + 1}
                  </div>

                  <div className="absolute top-1 right-1 z-10 bg-black/60 backdrop-blur rounded p-0.5">
                    {isSelected ? (
                      <CheckSquare size={14} className="text-[var(--color-editorial)]" />
                    ) : (
                      <Square size={14} className="text-white/60" />
                    )}
                  </div>

                  {/* Image Preview Container */}
                  <div className="w-full h-32 bg-black/20 flex items-center justify-center overflow-hidden relative">
                    <img
                      src={page.translatedUrl || page.url}
                      alt={`Page ${idx + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = '0.3';
                      }}
                    />

                    {/* Status Overlay Badge */}
                    <div className="absolute bottom-1 right-1 bg-black/80 backdrop-blur text-white text-[9px] font-mono px-1 py-0.5 rounded flex items-center gap-1">
                      {page.isTranslated ? (
                        <>
                          <Check size={10} className="text-emerald-400" />
                          <span className="text-emerald-300 font-semibold">Done</span>
                        </>
                      ) : isBusy ? (
                        <>
                          <Loader size={10} className="animate-spin text-amber-400" />
                          <span className="text-amber-300 capitalize">{jobStatus}</span>
                        </>
                      ) : jobStatus === 'error' ? (
                        <>
                          <AlertCircle size={10} className="text-red-400" />
                          <span className="text-red-300">Failed</span>
                        </>
                      ) : (
                        <span className="opacity-75">Ready</span>
                      )}
                    </div>
                  </div>

                  {/* Dimension Footer */}
                  <div className="px-1.5 py-1 flex items-center justify-between text-[10px] font-mono text-[var(--color-dust)] bg-[var(--color-paper)] border-t border-[var(--color-dust)] border-opacity-20">
                    <span>{page.width > 0 ? `${page.width}×${page.height}` : '...'}</span>
                    {page.isTranslated && <span className="text-emerald-500 font-bold">Translated</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="flex flex-col gap-2 pt-1">
        <button
          onClick={handleQueueSelected}
          disabled={isQueueing || selectedCount === 0 || pages.length === 0}
          className="w-full py-2 bg-[var(--color-editorial)] text-white font-bold rounded hover:opacity-90 transition-opacity flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-xs"
        >
          {isQueueing ? (
            <Loader size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          <span>
            {isQueueing
              ? 'Queueing Pages…'
              : selectedCount > 0
              ? `Translate ${selectedCount} Selected Pages`
              : 'Select Pages to Translate'}
          </span>
        </button>
      </div>
    </div>
  );
}
