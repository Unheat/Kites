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
  Layers,
  History,
  Archive,
} from 'lucide-react';
import type { ScannedPageImage } from '../../content/scanner';
import type { ChapterReaderPage } from '../../content/ChapterReaderModal';
import { db, type ImageRecord } from '../../db';
import { getChapterScopeId } from '../../shared/siteRules';

export interface UnifiedGalleryItem {
  id: string; // `page:${url}` or `history:${jobId}`
  source: 'page' | 'history';
  url: string;
  thumbnailUrl: string;
  translatedUrl?: string;
  isTranslated: boolean;
  status: 'idle' | 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
  width: number;
  height: number;
  timestamp?: number;
  jobId?: number;
}

interface QueueJobStatus {
  srcUrl: string;
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
}

/**
 * XianScan-inspired Batch Chapter Page Scanner, History Gallery, and Queue Manager.
 * Discovers comic strip images on the active reading tab or loads from saved history,
 * displays a unified thumbnail gallery with source provenance, and lets users select
 * and queue pages for translation or launch into distraction-free reader mode.
 *
 * @returns The rendered batch scanner panel.
 */
export default function BatchScanPanel() {
  const [activeSource, setActiveSource] = useState<'page' | 'history'>('page');
  const [pageItems, setPageItems] = useState<UnifiedGalleryItem[]>([]);
  const [historyItems, setHistoryItems] = useState<UnifiedGalleryItem[]>([]);
  const [selectedMap, setSelectedMap] = useState<Map<string, UnifiedGalleryItem>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [isFastScanning, setIsFastScanning] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [needsTabReload, setNeedsTabReload] = useState(false);
  const [activeJobs, setActiveJobs] = useState<Map<string, string>>(new Map());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const createdUrlsRef = useRef<string[]>([]);
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

  // Loads translation history records from Dexie
  const loadHistoryItems = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      if (!db || !db.translationJobs) {
        if (mountedRef.current) setHistoryItems([]);
        return;
      }
      const jobs = await db.translationJobs.orderBy('timestamp').reverse().limit(60).toArray();
      if (!jobs || jobs.length === 0) {
        if (mountedRef.current) setHistoryItems([]);
        return;
      }

      const jobIds = jobs.map((j) => j.id).filter((id): id is number => typeof id === 'number');
      const images = await db.images.where('jobId').anyOf(jobIds).toArray();
      const imageMap = new Map<number, ImageRecord>();
      for (const img of images) {
        imageMap.set(img.jobId, img);
      }

      const items: UnifiedGalleryItem[] = [];
      for (const job of jobs) {
        if (!job.id) continue;
        const img = imageMap.get(job.id);
        let rawUrl: string | undefined;
        let transUrl: string | undefined;

        if (img?.translatedImageBlob) {
          transUrl = URL.createObjectURL(img.translatedImageBlob);
          createdUrlsRef.current.push(transUrl);
        }
        if (img?.rawImageBlob) {
          rawUrl = URL.createObjectURL(img.rawImageBlob);
          createdUrlsRef.current.push(rawUrl);
        }

        const effectiveUrl = job.srcUrl || rawUrl || '';
        const thumb = transUrl || rawUrl || job.srcUrl || '';
        const isTranslated = Boolean(transUrl) && job.status === 'completed';

        items.push({
          id: `history:${job.id}`,
          source: 'history',
          url: effectiveUrl,
          thumbnailUrl: thumb,
          translatedUrl: transUrl,
          isTranslated,
          status: job.status || (isTranslated ? 'completed' : 'idle'),
          width: 800,
          height: 1200,
          timestamp: job.timestamp,
          jobId: job.id,
        });
      }

      if (mountedRef.current) {
        setHistoryItems(items);
      }
    } catch (err) {
      console.warn('[BatchScanPanel] Failed to load history items:', err);
    } finally {
      if (mountedRef.current) setIsLoadingHistory(false);
    }
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

      const response = await chrome.tabs.sendMessage(
        tab.id,
        {
          type: 'SCAN_CHAPTER_PAGES',
          target: 'content',
          source: 'popup',
          request: true,
        },
        { frameId: 0 }
      );

      if (mountedRef.current && response?.status === 'success' && Array.isArray(response.pages)) {
        const scanned: ScannedPageImage[] = response.pages;
        const items: UnifiedGalleryItem[] = scanned.map((page) => ({
          id: `page:${page.url}`,
          source: 'page',
          url: page.url,
          thumbnailUrl: page.translatedUrl || page.url,
          translatedUrl: page.translatedUrl,
          isTranslated: page.isTranslated,
          status: page.isTranslated ? 'completed' : 'idle',
          width: page.width,
          height: page.height,
        }));
        setPageItems(items);

        // Pre-select untranslated pages by default
        setSelectedMap((prev) => {
          const next = new Map(prev);
          for (const item of items) {
            if (!item.isTranslated) {
              next.set(item.id, item);
            }
          }
          if (next.size === 0 && items.length > 0) {
            for (const item of items) next.set(item.id, item);
          }
          return next;
        });
      }
    } catch (err: any) {
      console.warn('[BatchScan] Snapshot scan failed:', err);
      const msg = err?.message || String(err);
      if (
        msg.includes('Could not establish connection') ||
        msg.includes('Receiving end does not exist')
      ) {
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

      const response = await chrome.tabs.sendMessage(
        tab.id,
        {
          type: 'FAST_SCROLL_PRELOAD',
          target: 'content',
          source: 'popup',
          request: true,
        },
        { frameId: 0 }
      );

      if (mountedRef.current && response?.status === 'success' && Array.isArray(response.pages)) {
        const scanned: ScannedPageImage[] = response.pages;
        const items: UnifiedGalleryItem[] = scanned.map((page) => ({
          id: `page:${page.url}`,
          source: 'page',
          url: page.url,
          thumbnailUrl: page.translatedUrl || page.url,
          translatedUrl: page.translatedUrl,
          isTranslated: page.isTranslated,
          status: page.isTranslated ? 'completed' : 'idle',
          width: page.width,
          height: page.height,
        }));
        setPageItems(items);

        // Update selections to include newly discovered untranslated pages
        setSelectedMap((prev) => {
          const next = new Map(prev);
          for (const item of items) {
            if (!item.isTranslated) next.set(item.id, item);
          }
          return next;
        });
        setStatusMessage(`Discovered ${items.length} panels total.`);
      }
    } catch (err: any) {
      console.warn('[BatchScan] Fast-scroll preload failed:', err);
      setStatusMessage('Fast-scan encountered an error.');
    } finally {
      if (mountedRef.current) setIsFastScanning(false);
    }
  };

  // Toggle selection for a single gallery item
  const toggleItemSelection = (item: UnifiedGalleryItem) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, item);
      }
      return next;
    });
  };

  // Select all or deselect all items in current view
  const currentViewItems = activeSource === 'page' ? pageItems : historyItems;
  const isAllInViewSelected =
    currentViewItems.length > 0 && currentViewItems.every((item) => selectedMap.has(item.id));

  const toggleSelectAllCurrentView = () => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (isAllInViewSelected) {
        for (const item of currentViewItems) {
          next.delete(item.id);
        }
      } else {
        for (const item of currentViewItems) {
          next.set(item.id, item);
        }
      }
      return next;
    });
  };

  // Smart partition of selected items into pending (untranslated + error) vs already completed
  const selectedList = Array.from(selectedMap.values());
  const pendingToTranslate = selectedList.filter(
    (item) => !item.isTranslated || item.status === 'error'
  );
  const skippedCount = selectedList.length - pendingToTranslate.length;

  // Dispatches batch queue translation only for pending items
  const handleQueueSelected = async () => {
    if (isQueueing || pendingToTranslate.length === 0) return;
    setIsQueueing(true);
    setStatusMessage('Queueing pages for translation...');

    try {
      const urlsToQueue = pendingToTranslate.map((item) => item.url).filter(Boolean);
      const tab = await getActiveTab();
      const res = await chrome.runtime.sendMessage({
        type: 'BATCH_QUEUE_TRANSLATIONS',
        payload: { urls: urlsToQueue },
        tabId: tab?.id,
      });

      if (res?.status === 'success') {
        const count = res.queuedCount ?? urlsToQueue.length;
        setStatusMessage(`Queued ${count} pages. Starting sequential translation.`);
        const queuedUrls = new Set(urlsToQueue);

        setPageItems((prev) =>
          prev.map((item) =>
            queuedUrls.has(item.url) ? { ...item, status: 'queued' as const } : item
          )
        );
        setHistoryItems((prev) =>
          prev.map((item) =>
            queuedUrls.has(item.url) ? { ...item, status: 'queued' as const } : item
          )
        );
      } else {
        setStatusMessage(res?.error || 'Failed to queue translations.');
      }
    } catch (err: any) {
      console.warn('[BatchScan] Queue dispatch failed:', err);
      setStatusMessage('Error sending translations to background queue.');
    } finally {
      if (mountedRef.current) setIsQueueing(false);
    }
  };

  // Opens Chapter Reader for selected pages, or all pages in view if none selected
  const handleOpenReaderForSelected = async () => {
    try {
      const tab = await getActiveTab();
      if (!tab?.id) return;

      const targetItems = selectedList.length > 0 ? selectedList : currentViewItems;

      if (targetItems.length === 0) {
        await chrome.tabs.sendMessage(
          tab.id,
          {
            type: 'OPEN_CHAPTER_READER',
            target: 'content',
            source: 'popup',
            request: true,
          },
          { frameId: 0 }
        );
        window.close();
        return;
      }

      const pagesPayload: ChapterReaderPage[] = targetItems.map((item, idx) => ({
        id: item.id,
        url: item.url,
        width: item.width || 800,
        height: item.height || 1200,
        top: idx * (item.height || 1200),
        isTranslated: item.isTranslated,
        translatedUrl: item.translatedUrl,
        jobId: item.jobId,
        status: item.status === 'downloading' ? 'processing' : item.status,
      }));

      await chrome.tabs.sendMessage(
        tab.id,
        {
          type: 'OPEN_CHAPTER_READER',
          target: 'content',
          source: 'popup',
          request: true,
          payload: { pages: pagesPayload },
        },
        { frameId: 0 }
      );
      window.close();
    } catch (err) {
      console.warn('[Popup] Failed to open chapter reader from batch panel:', err);
    }
  };

  // Exports selected or available translated pages as ZIP archive
  const handleExportZipForSelected = async () => {
    try {
      const tab = await getActiveTab();
      if (!tab?.id) return;

      const targetItems = selectedList.length > 0 ? selectedList : currentViewItems;
      const readyItems = targetItems.filter((item) => item.isTranslated && item.translatedUrl);

      if (readyItems.length === 0) {
        setStatusMessage('No translated pages ready to export.');
        return;
      }

      setIsExportingZip(true);
      setStatusMessage(`Preparing ${readyItems.length} pages for ZIP export…`);

      const recordsToExport = readyItems.map((item, idx) => ({
        originalUrl: item.url,
        translatedUrl: item.translatedUrl!,
        sourcePage: item.source === 'page' ? getChapterScopeId(tab.url || '') : 'history',
        documentPath: null,
        documentY: idx * 1000,
        sequence: idx + 1,
      }));

      const res = await chrome.tabs.sendMessage(
        tab.id,
        {
          type: 'EXPORT_CHAPTER_ZIP',
          target: 'content',
          source: 'popup',
          request: true,
          payload: { records: recordsToExport },
        },
        { frameId: 0 }
      );

      if (res?.phase === 'error') {
        setStatusMessage(res.message || 'ZIP Export failed.');
      } else {
        setStatusMessage(`ZIP Download started (${readyItems.length} pages).`);
      }
    } catch (err: any) {
      console.warn('[BatchScan] Export ZIP dispatch failed:', err);
      setStatusMessage('Failed to trigger ZIP export on active tab.');
    } finally {
      if (mountedRef.current) setIsExportingZip(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void scanPages();
    void loadHistoryItems();
    void pollQueueStatus();
    const timer = setInterval(() => {
      void pollQueueStatus();
    }, 2000);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      for (const u of createdUrlsRef.current) {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      }
      createdUrlsRef.current = [];
    };
  }, [scanPages, loadHistoryItems, pollQueueStatus]);

  const selectedCountInView = currentViewItems.filter((item) => selectedMap.has(item.id)).length;
  const totalTranslatedInView = currentViewItems.filter((item) => item.isTranslated).length;
  const readyToExportCount = selectedList.length > 0
    ? selectedList.filter((item) => item.isTranslated && item.translatedUrl).length
    : totalTranslatedInView;

  return (
    <div className="flex flex-col gap-2.5 text-xs">
      {/* Dual-Source Segmented Control Switcher */}
      <div className="flex p-0.5 rounded-lg bg-[var(--color-paper)] border border-[var(--color-dust)] border-opacity-30 text-xs">
        <button
          type="button"
          onClick={() => setActiveSource('page')}
          className={`flex-1 py-1 px-1.5 rounded-md font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap text-[11px] ${
            activeSource === 'page'
              ? 'bg-[var(--color-vellum)] text-[var(--color-ink)] shadow-sm'
              : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
          }`}
        >
          <Layers size={13} className={activeSource === 'page' ? 'text-[var(--color-editorial)]' : ''} />
          <span>Current Page</span>
          <span className="font-mono text-[10px] opacity-75 font-normal">({pageItems.length})</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveSource('history');
            void loadHistoryItems();
          }}
          className={`flex-1 py-1 px-1.5 rounded-md font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap text-[11px] ${
            activeSource === 'history'
              ? 'bg-[var(--color-vellum)] text-[var(--color-ink)] shadow-sm'
              : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
          }`}
        >
          <History size={13} className={activeSource === 'history' ? 'text-[var(--color-editorial)]' : ''} />
          <span>History</span>
          <span className="font-mono text-[10px] opacity-75 font-normal">({historyItems.length})</span>
        </button>
      </div>

      {/* Top Controls Toolbar */}
      <div className="p-2.5 rounded bg-[var(--color-vellum)] border border-[var(--color-dust)] border-opacity-30 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer font-medium select-none min-w-0">
          <input
            type="checkbox"
            checked={isAllInViewSelected}
            onChange={toggleSelectAllCurrentView}
            disabled={currentViewItems.length === 0}
            className="rounded border-[var(--color-dust)] text-[var(--color-editorial)] focus:ring-0 cursor-pointer"
          />
          <span className="font-mono text-[11px] text-[var(--color-ink)] truncate">
            {selectedCountInView} / {currentViewItems.length} pages
            {selectedList.length > 0 && selectedList.length !== selectedCountInView && (
              <span className="text-[var(--color-editorial)] font-semibold ml-1">
                ({selectedList.length} total selected)
              </span>
            )}
          </span>
        </label>

        <div className="flex items-center gap-1.5 shrink-0">
          {activeSource === 'page' ? (
            <>
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
                {isFastScanning ? (
                  <Loader size={12} className="animate-spin" />
                ) : (
                  <Zap size={12} className="text-amber-500" />
                )}
                <span>{isFastScanning ? 'Scanning…' : 'Fast Scan'}</span>
              </button>
            </>
          ) : (
            <button
              onClick={loadHistoryItems}
              disabled={isLoadingHistory}
              className="px-2 py-1 rounded bg-[var(--color-paper)] hover:bg-[var(--color-editorial)] hover:text-white border border-[var(--color-dust)] border-opacity-30 font-semibold transition-all flex items-center gap-1 text-[11px] cursor-pointer shadow-sm disabled:opacity-50"
              title="Refresh saved translation history"
            >
              <RotateCcw size={12} className={isLoadingHistory ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab Reload Needed Prompt */}
      {needsTabReload && activeSource === 'page' && (
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

      {/* Status Feedback Banner */}
      {statusMessage && (
        <div className="py-1 px-2 rounded bg-[var(--color-paper)] text-[10px] text-[var(--color-dust)] border border-[var(--color-dust)] border-opacity-20 flex items-center gap-1.5 animate-fadeIn">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-editorial)] shrink-0 animate-ping" />
          <span className="truncate">{statusMessage}</span>
        </div>
      )}

      {/* Scrollable Thumbnail Gallery */}
      <div className="max-h-72 overflow-y-auto pr-1">
        {isScanning || (activeSource === 'history' && isLoadingHistory && historyItems.length === 0) ? (
          <div className="py-12 flex flex-col items-center justify-center text-[var(--color-dust)] gap-2">
            <Loader size={20} className="animate-spin text-[var(--color-editorial)]" />
            <span className="text-[11px]">
              {activeSource === 'page' ? 'Detecting comic panels on page…' : 'Loading saved history…'}
            </span>
          </div>
        ) : currentViewItems.length === 0 ? (
          <div className="py-8 px-4 flex flex-col items-center justify-center text-center text-[var(--color-dust)]">
            <BookOpen size={28} className="mb-2 opacity-50" />
            <p className="font-semibold text-xs text-[var(--color-ink)]">
              {activeSource === 'page' ? 'No Comic Panels Detected' : 'No Saved History Yet'}
            </p>
            <p className="text-[11px] mt-1 leading-relaxed opacity-80">
              {activeSource === 'page'
                ? 'Try running Fast Scan to scroll through virtualized readers, or check page elements.'
                : 'Translated images will automatically save here so you can re-open or export them later.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {currentViewItems.map((item, idx) => {
              const isSelected = selectedMap.has(item.id);
              const jobStatus = activeJobs.get(item.url) || item.status;
              const isBusy = jobStatus === 'queued' || jobStatus === 'processing' || jobStatus === 'downloading';

              return (
                <div
                  key={item.id}
                  onClick={() => toggleItemSelection(item)}
                  className={`group relative rounded-lg border overflow-hidden cursor-pointer transition-all select-none ${
                    isSelected
                      ? 'border-[var(--color-editorial)] shadow-md ring-1 ring-[var(--color-editorial)] ring-opacity-50'
                      : 'border-[var(--color-dust)] border-opacity-30 hover:border-opacity-60 bg-[var(--color-paper)]'
                  }`}
                >
                  {/* Badge: Index & Source Provenance */}
                  <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
                    <span className="bg-black/75 backdrop-blur text-white text-[9px] font-mono px-1.5 py-0.5 rounded font-bold">
                      #{idx + 1}
                    </span>
                    <span
                      className={`text-[8px] font-semibold uppercase px-1 py-0.5 rounded backdrop-blur ${
                        item.source === 'history'
                          ? 'bg-purple-900/80 text-purple-200 border border-purple-400/30'
                          : 'bg-slate-900/80 text-slate-300 border border-slate-500/30'
                      }`}
                    >
                      {item.source}
                    </span>
                  </div>

                  {/* Checkbox */}
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
                      src={item.thumbnailUrl}
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
                      {item.isTranslated ? (
                        <>
                          <Check size={10} className="text-emerald-400" />
                          <span className="text-emerald-300 font-semibold">Done</span>
                        </>
                      ) : isBusy ? (
                        <>
                          <Loader size={10} className="animate-spin text-amber-400" />
                          <span className="text-amber-300 capitalize">{jobStatus}</span>
                        </>
                      ) : item.status === 'error' ? (
                        <>
                          <AlertCircle size={10} className="text-rose-400" />
                          <span className="text-rose-300 font-semibold">Retry</span>
                        </>
                      ) : (
                        <span className="opacity-75">Ready</span>
                      )}
                    </div>
                  </div>

                  {/* Dimension / Timestamp Footer */}
                  <div className="px-1.5 py-1 flex items-center justify-between text-[10px] font-mono text-[var(--color-dust)] bg-[var(--color-paper)] border-t border-[var(--color-dust)] border-opacity-20">
                    <span>
                      {item.source === 'history' && item.timestamp
                        ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : item.width > 0
                        ? `${item.width}×${item.height}`
                        : '...'}
                    </span>
                    {item.isTranslated ? (
                      <span className="text-emerald-500 font-bold">Translated</span>
                    ) : item.status === 'error' ? (
                      <span className="text-rose-400 font-bold">Failed</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="flex flex-col gap-2 pt-1">
        {/* Smart Translate Button (Skips Already Translated, Retries Failed) */}
        <button
          onClick={handleQueueSelected}
          disabled={isQueueing || pendingToTranslate.length === 0 || selectedList.length === 0}
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
              : selectedList.length === 0
              ? 'Select Pages to Translate'
              : pendingToTranslate.length > 0
              ? skippedCount > 0
                ? `Translate ${pendingToTranslate.length} Pages (${skippedCount} already done)`
                : `Translate ${pendingToTranslate.length} Selected Pages`
              : `All ${selectedList.length} Selected Pages Done`}
          </span>
        </button>

        {/* Secondary Action Row: Open Reader & Export ZIP (Permanent, Never Disappears) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleOpenReaderForSelected}
            className="py-1.5 px-2 bg-[var(--color-vellum)] text-[var(--color-ink)] border border-[var(--color-dust)] border-opacity-30 font-semibold rounded hover:border-[var(--color-editorial)] hover:text-[var(--color-editorial)] transition-colors flex items-center justify-center gap-1.5 text-xs cursor-pointer shadow-sm truncate"
            title={
              selectedList.length > 0
                ? `Open reader displaying ${selectedList.length} selected pages`
                : `Open reader displaying all ${currentViewItems.length} pages`
            }
          >
            <BookOpen size={13} className="text-[var(--color-editorial)] shrink-0" />
            <span className="truncate">
              {selectedList.length > 0
                ? `Reader (${selectedList.length})`
                : `Open Reader (${currentViewItems.length})`}
            </span>
          </button>

          <button
            onClick={handleExportZipForSelected}
            disabled={isExportingZip || readyToExportCount === 0}
            className="py-1.5 px-2 bg-[var(--color-vellum)] text-[var(--color-ink)] border border-[var(--color-dust)] border-opacity-30 font-semibold rounded hover:border-[var(--color-editorial)] hover:text-[var(--color-editorial)] transition-colors flex items-center justify-center gap-1.5 text-xs cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed truncate"
            title={
              readyToExportCount === 0
                ? 'No translated pages ready to export yet'
                : `Download ${readyToExportCount} translated page${readyToExportCount === 1 ? '' : 's'} as ZIP`
            }
          >
            {isExportingZip ? (
              <Loader size={13} className="animate-spin text-[var(--color-editorial)] shrink-0" />
            ) : (
              <Archive size={13} className="text-[var(--color-editorial)] shrink-0" />
            )}
            <span className="truncate">
              {isExportingZip
                ? 'Exporting…'
                : `Export ZIP (${readyToExportCount})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
