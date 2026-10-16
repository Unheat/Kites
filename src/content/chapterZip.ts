import JSZip from 'jszip';
import { getChapterScopeId } from '../shared/siteRules';

// JSZip holds inputs and output in memory. This bounds archive bytes, not peak heap usage.
export const CHAPTER_ZIP_BYTE_LIMIT = 256 * 1024 * 1024;
// Bounded retention budget for the content-side session asset pool (128 MiB default).
export const SESSION_IMAGE_BYTE_LIMIT = 128 * 1024 * 1024;

/**
 * Accurately estimates binary payload byte count from a data URL without decoding to string or Uint8Array.
 * @param dataUrl - data:image/...;base64,... string.
 * @returns Estimated binary byte length.
 */
export function estimateDataUrlBytes(dataUrl: string): number {
  if (!dataUrl) return 0;
  if (!dataUrl.startsWith('data:')) return 0;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return 0;
  const b64Length = dataUrl.length - commaIdx - 1;
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64Length * 3) / 4) - padding);
}

// STORE local header, descriptor, central header and conservative UTF-8 filename overhead.
const ZIP_ENTRY_OVERHEAD_BYTES = 1024;
const ZIP_END_OVERHEAD_BYTES = 22;
const FILENAME_PAD_WIDTH = 3;
const SAFE_NAME_MAX_LENGTH = 80;
const DOWNLOAD_REVOKE_DELAY_MS = 60_000;
const IMAGE_FETCH_TIMEOUT_MS = 30_000;
// JSZip writes classic ZIP entry counts; larger chapters require ZIP64 support we do not provide.
const ZIP_MAX_ENTRIES = 65_535;
const ZIP_LIMIT_MESSAGE = 'Chapter exceeds the 256 MiB ZIP limit';

export interface ChapterImageRecord {
  originalUrl: string;
  translatedUrl: string;
  sourcePage: string;
  documentPath: number[] | null;
  documentY: number | null;
  sequence: number;
  surfaceElement?: Element;
  sourceElement?: Element;
}

export interface ChapterTranslationRecord extends ChapterImageRecord {
  jobId?: number;
  showOriginal: boolean;
}

interface ChapterTranslationRegistryOptions {
  getSourcePage: () => string;
  createTranslatedUrl: (dataUrl: string) => string;
  revokeTranslatedUrl: (url: string) => void;
  maxSessionBytes?: number;
}

type ChapterSurface = Pick<ChapterImageRecord, 'surfaceElement' | 'sourceElement'>;

/**
 * Owns queue-time chapter context and one completed version per document/source pair.
 * Enforces a bounded session encoded-result retention budget (128 MiB default).
 * @param options - Current context and shared DOM blob lifecycle callbacks.
 * @returns Scoped lookup, queue/failure/completion commands, and archive records.
 */
export function createChapterTranslationRegistry(options: ChapterTranslationRegistryOptions) {
  const chapters = new Map<string, Map<string, ChapterTranslationRecord>>();
  const pending = new Map<string, ReturnType<typeof captureChapterPosition> & ChapterSurface>();
  const completedJobs = new Map<number, ChapterTranslationRecord | undefined>();
  const byteSizes = new Map<string, number>();
  let currentSessionBytes = 0;
  const maxSessionBytes = options.maxSessionBytes ?? SESSION_IMAGE_BYTE_LIMIT;
  let sequence = 0;
  let contextMenu: { originalUrl: string; position: ReturnType<typeof captureChapterPosition> & ChapterSurface } | undefined;

  /**
   * Captures the latest native context-menu candidate without blocking later overlay requests.
   * @param originalUrl - Right-clicked source URL.
   * @param target - Right-clicked page elements.
   * @returns Nothing; at most one unconfirmed candidate is retained.
   */
  function rememberContextMenu(originalUrl: string, target: ChapterSurface): void {
    contextMenu = { originalUrl, position: {
      ...captureChapterPosition(target.surfaceElement, options.getSourcePage(), get(originalUrl)?.sequence ?? ++sequence),
      ...target,
    } };
  }

  /** @param originalUrl - Image source. @returns Latest result in the current document only. */
  function get(originalUrl: string): ChapterTranslationRecord | undefined {
    return chapters.get(options.getSourcePage())?.get(originalUrl);
  }

  /** @returns All completed records, including detached pages and earlier SPA chapters. */
  function* getRecords(): IterableIterator<ChapterTranslationRecord> {
    for (const chapter of chapters.values()) yield* chapter.values();
  }

  /**
   * Locks context before queueing; duplicate requests cannot relabel an in-flight result.
   * @param originalUrl - Requested source URL.
   * @param target - Queue-time page elements, if available.
   * @returns Nothing.
   */
  function remember(originalUrl: string, target: ChapterSurface = {}): void {
    if (pending.has(originalUrl)) return;
    const previous = get(originalUrl);
    pending.set(originalUrl, {
      ...captureChapterPosition(target.surfaceElement, options.getSourcePage(), previous?.sequence ?? ++sequence),
      ...target,
    });
  }

  /** @param originalUrl - Rejected/failed request. @returns Nothing; retries capture fresh context. */
  function forget(originalUrl: string): void {
    pending.delete(originalUrl);
    if (contextMenu?.originalUrl === originalUrl) contextMenu = undefined;
  }

  /**
   * Archives terminal bytes without requiring a live element; duplicate jobs reuse their blob.
   * Untracked events require a live target (e.g. native context-menu translation); they cannot
   * be assigned to an unrelated chapter merely because the tab navigated before completion.
   * @param originalUrl - Completed image source.
   * @param dataUrl - Translated local bytes.
   * @param jobId - Background job identity, when available.
   * @param target - Fallback live elements for requests not initiated by the overlay.
   * @returns Completed record, or undefined when neither queue context nor a target is known.
   */
  function complete(originalUrl: string, dataUrl: string, jobId?: number, target: ChapterSurface = {}): ChapterTranslationRecord | undefined {
    if (jobId !== undefined && completedJobs.has(jobId)) return completedJobs.get(jobId);
    const position = pending.get(originalUrl) ?? (contextMenu?.originalUrl === originalUrl ? contextMenu.position : undefined);
    const current = get(originalUrl);
    if (!position && current && current.jobId === jobId) return current;
    if (!position && !target.surfaceElement?.isConnected) return undefined;
    const sourcePage = position?.sourcePage ?? options.getSourcePage();
    let chapter = chapters.get(sourcePage);
    if (!chapter) chapters.set(sourcePage, chapter = new Map());
    const previous = chapter.get(originalUrl);

    // Enforce the bounded session encoded-result retention budget (128 MiB default)
    const dataSize = estimateDataUrlBytes(dataUrl);
    const previousSize = previous ? (byteSizes.get(previous.translatedUrl) || 0) : 0;
    const netChange = dataSize - previousSize;
    if (netChange > 0 && currentSessionBytes + netChange > maxSessionBytes) {
      console.warn(
        `[ChapterTranslationRegistry] Result not retained: session image limit reached (${((currentSessionBytes + netChange) / (1024 * 1024)).toFixed(1)} MiB > ${(maxSessionBytes / (1024 * 1024)).toFixed(0)} MiB)`
      );
      forget(originalUrl);
      return undefined;
    }

    const metadata = position ?? {
      ...captureChapterPosition(target.surfaceElement, sourcePage, previous?.sequence ?? ++sequence),
      ...target,
    };
    const translatedUrl = options.createTranslatedUrl(dataUrl);
    const record: ChapterTranslationRecord = {
      originalUrl, translatedUrl, jobId, showOriginal: false,
      ...metadata,
    };
    chapter.set(originalUrl, record);
    currentSessionBytes = Math.max(0, currentSessionBytes + netChange);
    byteSizes.set(translatedUrl, dataSize);
    forget(originalUrl);
    if (jobId !== undefined) completedJobs.set(jobId, record);
    if (previous && previous.translatedUrl !== record.translatedUrl) {
      byteSizes.delete(previous.translatedUrl);
      options.revokeTranslatedUrl(previous.translatedUrl);
      // Remember superseded identities without retaining their revoked bytes or DOM elements.
      if (previous.jobId !== undefined) completedJobs.set(previous.jobId, undefined);
    }
    return record;
  }

  function getCurrentSessionBytes(): number {
    return currentSessionBytes;
  }

  function getSessionByteLimit(): number {
    return maxSessionBytes;
  }

  function isLimitReached(candidateBytes: number = 0): boolean {
    return currentSessionBytes + candidateBytes > maxSessionBytes;
  }

  function clearChapter(sourcePage: string): number {
    const chapter = chapters.get(sourcePage);
    if (!chapter) return 0;
    let freedBytes = 0;
    for (const record of chapter.values()) {
      const size = byteSizes.get(record.translatedUrl) || 0;
      freedBytes += size;
      byteSizes.delete(record.translatedUrl);
      options.revokeTranslatedUrl(record.translatedUrl);
      if (record.jobId !== undefined) completedJobs.delete(record.jobId);
    }
    chapters.delete(sourcePage);
    currentSessionBytes = Math.max(0, currentSessionBytes - freedBytes);
    return freedBytes;
  }

  function clearEarlierChapters(exceptSourcePage: string): number {
    let totalFreed = 0;
    for (const sourcePage of Array.from(chapters.keys())) {
      if (sourcePage !== exceptSourcePage) {
        totalFreed += clearChapter(sourcePage);
      }
    }
    return totalFreed;
  }

  return {
    get,
    getRecords,
    remember,
    rememberContextMenu,
    forget,
    complete,
    getCurrentSessionBytes,
    getSessionByteLimit,
    isLimitReached,
    clearChapter,
    clearEarlierChapters,
  };
}

export type ChapterZipPhase = 'idle' | 'preparing' | 'packing' | 'success' | 'partial' | 'empty' | 'error';
export interface ChapterZipStatus {
  phase: ChapterZipPhase;
  busy: boolean;
  total: number;
  processed: number;
  included: number;
  failed: number;
  percent: number;
  message: string;
  errors: string[];
}

/**
 * Captures stable reading position before a virtual reader can detach or reuse its slot.
 * @param element - Visible page surface, if available.
 * @param sourcePage - Queue-time document URL, including chapter query/hash.
 * @param sequence - First request order, used only for reused slots and ties.
 * @returns Stored document path and measurable Y position.
 */
export function captureChapterPosition(element: Element | undefined, sourcePage: string, sequence: number) {
  let documentPath: number[] | null = null;
  let documentY: number | null = null;
  if (element?.isConnected) {
    const path: number[] = [];
    let node: Element | null = element;
    while (node) {
      const parent: Element | null = node.parentElement;
      if (parent) {
        path.push(Array.prototype.indexOf.call(parent.children, node));
        node = parent;
      } else {
        const host: Element | undefined = (node.getRootNode() as ShadowRoot).host;
        if (!host) break;
        // Shadow children have no light-DOM sibling index; distinguish siblings before crossing host.
        const root = node.getRootNode() as ShadowRoot;
        path.push(Array.prototype.indexOf.call(root.children, node), -1);
        node = host;
      }
    }
    documentPath = path.reverse();
    const rect = element.getBoundingClientRect();
    const y = rect.top + (element.ownerDocument.defaultView?.scrollY || 0);
    if (rect.height > 0 && Number.isFinite(y)) documentY = y;
  }
  return { documentPath, documentY, sourcePage, sequence };
}

/**
 * Compares stored child-index paths lexicographically, matching DOM reading order.
 * @param a - First path or unknown position.
 * @param b - Second path or unknown position.
 * @returns Negative when the first path precedes the second.
 */
function comparePaths(a: number[] | null, b: number[] | null): number {
  if (!a || !b) return 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Snapshots current-context records, refreshing live positions without losing detached ones.
 * Slot occurrence ordering interleaves reused slots; distinct slots follow DOM paths.
 * @param records - Completed registry records; original-display state is deliberately irrelevant.
 * @param sourcePage - Current document URL, not database history.
 * @returns Unique translated pages in reading order, independent of completion order.
 */
export function orderChapterImages(records: Iterable<ChapterImageRecord>, sourcePage: string): ChapterImageRecord[] {
  const unique = new Map<string, ChapterImageRecord>();
  const targetScope = getChapterScopeId(sourcePage);
  for (const record of records) {
    const isMatchingScope = record.sourcePage === sourcePage || (Boolean(targetScope) && getChapterScopeId(record.sourcePage) === targetScope);
    if (!isMatchingScope || !record.translatedUrl) continue;
    // A recycled element belongs to its new page. Never refresh the archived page from that slot.
    const live = record.surfaceElement?.isConnected &&
      record.sourceElement?.getAttribute('data-kites-applied-src') === record.translatedUrl;
    const position = live ? captureChapterPosition(record.surfaceElement, sourcePage, record.sequence) : null;
    unique.set(record.originalUrl, {
      ...record,
      documentPath: position?.documentPath ?? record.documentPath,
      documentY: position?.documentY ?? record.documentY,
    });
  }
  const entries = [...unique.values()].sort((a, b) => a.sequence - b.sequence);
  const slots = new Map<string, number>();
  const occurrences = new Map<ChapterImageRecord, number>();
  for (const entry of entries) {
    // Unknown paths are not a shared reader slot.
    const key = entry.documentPath?.join('.') ?? `unknown-${entry.sequence}`;
    const occurrence = slots.get(key) || 0;
    occurrences.set(entry, occurrence);
    slots.set(key, occurrence + 1);
  }
  return entries.sort((a, b) =>
    (occurrences.get(a)! - occurrences.get(b)!) || comparePaths(a.documentPath, b.documentPath) ||
    (a.documentY !== null && b.documentY !== null ? a.documentY - b.documentY : 0) ||
    a.sequence - b.sequence);
}

/**
 * Builds filesystem-safe ASCII names; ordinals prevent duplicate source basenames colliding.
 * @param value - Untrusted document title or image basename.
 * @returns Safe short filename stem without paths, controls, or reserved punctuation.
 */
function safeStem(value: string): string {
  return value.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^[-.]+|[-.]+$/g, '').slice(0, SAFE_NAME_MAX_LENGTH) || 'page';
}

/**
 * Names image bytes from their MIME type, never from an original URL's misleading extension.
 * @param record - Completed image record.
 * @param type - Fetched Blob MIME type.
 * @param index - One-based chapter index.
 * @param total - Snapshot size, determining zero padding.
 * @returns Unique safe archive entry name.
 */
function imageFilename(record: ChapterImageRecord, type: string, index: number, total: number): string {
  const extensions: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
  };
  const extension = extensions[type.toLowerCase().split(';')[0]];
  if (!extension) throw new Error(`Unsupported image MIME type: ${type || 'missing'}`);
  let basename = 'page';
  try {
    if (!record.originalUrl.startsWith('data:') && !record.originalUrl.startsWith('blob:')) {
      basename = decodeURIComponent(new URL(record.originalUrl).pathname.split('/').pop() || 'page');
    }
  } catch { /* A malformed source name must not prevent saving valid translated bytes. */ }
  return `${String(index).padStart(Math.max(FILENAME_PAD_WIDTH, String(total).length), '0')}_${safeStem(basename)}.${extension}`;
}

/**
 * Reads one local translation with a timeout and streaming byte budget before materializing it.
 * @param url - Registry blob/data URL; remote sources are never fetched for export.
 * @param remaining - Remaining conservative archive budget.
 * @param fetcher - Fetch implementation, injectable for tests.
 * @returns Bounded translated image Blob.
 */
async function readImage(url: string, remaining: number, fetcher: typeof fetch): Promise<Blob> {
  if (!url.startsWith('blob:') && !url.startsWith('data:image/')) throw new Error('Translation is not a local image');
  if (remaining <= 0) throw new Error(ZIP_LIMIT_MESSAGE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > remaining) {
      await response.body?.cancel();
      throw new Error(ZIP_LIMIT_MESSAGE);
    }
    if (!response.body) throw new Error('Image response has no readable body');
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > remaining) throw new Error(ZIP_LIMIT_MESSAGE);
        chunks.push(new Uint8Array(value));
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally { reader.releaseLock(); }
    if (!size) throw new Error('Translated image is empty');
    return new Blob(chunks, { type: response.headers.get('content-type') || '' });
  } finally { clearTimeout(timer); }
}

/**
 * Hands a Blob to the browser's download UI and revokes its URL after consumption has started.
 * @param blob - Locally generated ZIP or translated image.
 * @param filename - Safe suggested download name.
 * @returns Nothing; download initiation errors propagate to the caller.
 */
export function downloadLocalBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_DELAY_MS);
  }
}

interface ChapterExporterOptions {
  getRecords: () => Iterable<ChapterImageRecord>;
  getSourcePage: () => string;
  getTitle: () => string;
  fetcher?: typeof fetch;
  download?: (blob: Blob, filename: string) => void;
  byteLimit?: number;
}

/**
 * Creates a per-document export controller with synchronous reentry protection and queryable progress.
 * @param options - Live registry/context getters and optional test dependencies.
 * @returns Status query and asynchronous export command; no DB writes or external uploads.
 */
export function createChapterExporter(options: ChapterExporterOptions) {
  let status: ChapterZipStatus = {
    phase: 'idle', busy: false, total: 0, processed: 0, included: 0, failed: 0,
    percent: 0, message: 'Translate pages in this chapter to export them.', errors: [],
  };
  let lastSourcePage = options.getSourcePage();
  /** @returns Current progress plus the count of available pages when idle. */
  function getStatus(): ChapterZipStatus {
    const sourcePage = options.getSourcePage();
    if (!status.busy && sourcePage !== lastSourcePage) {
      status = { ...status, phase: 'idle', processed: 0, included: 0, failed: 0, percent: 0, errors: [], message: 'Translate pages in this chapter to export them.' };
      lastSourcePage = sourcePage;
    }
    return { ...status, errors: [...status.errors], total: status.busy ? status.total : orderChapterImages(options.getRecords(), sourcePage).length };
  }
  /** @returns Terminal result, or current busy status if another request already owns the export. */
  async function exportChapter(specificRecords?: ChapterImageRecord[]): Promise<ChapterZipStatus> {
    if (status.busy) return getStatus();
    const sourcePage = options.getSourcePage();
    const records = specificRecords && specificRecords.length > 0
      ? specificRecords
      : orderChapterImages(options.getRecords(), sourcePage);
    const title = options.getTitle();
    lastSourcePage = sourcePage;
    status = { phase: 'preparing', busy: true, total: records.length, processed: 0, included: 0, failed: 0, percent: 0, message: 'Preparing translated pages…', errors: [] };
    if (!records.length) {
      status = { ...status, phase: 'empty', busy: false, message: 'No translated pages in this chapter yet.' };
      return getStatus();
    }
    console.log('[Chapter ZIP] Preparing', records.length, 'pages');
    try {
      const zip = new JSZip();
      const limit = Math.min(options.byteLimit ?? CHAPTER_ZIP_BYTE_LIMIT, CHAPTER_ZIP_BYTE_LIMIT);
      if (!Number.isFinite(limit) || limit <= ZIP_END_OVERHEAD_BYTES) throw new Error(ZIP_LIMIT_MESSAGE);
      if (records.length > ZIP_MAX_ENTRIES) throw new Error('Chapter exceeds the ZIP entry count limit. Nothing downloaded.');
      let bytes = ZIP_END_OVERHEAD_BYTES;
      for (let i = 0; i < records.length; i++) {
        try {
          const blob = await readImage(records[i].translatedUrl, limit - bytes - ZIP_ENTRY_OVERHEAD_BYTES, options.fetcher ?? fetch);
          const name = imageFilename(records[i], blob.type, i + 1, records.length);
          // Convert sequentially: JSZip's browser Blob reader needs FileReader; ArrayBuffer also works in tests.
          const data = await blob.arrayBuffer();
          bytes += data.byteLength + ZIP_ENTRY_OVERHEAD_BYTES;
          if (bytes > limit) throw new Error(ZIP_LIMIT_MESSAGE);
          zip.file(name, data, { compression: 'STORE' });
          status.included++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // A cap failure aborts the whole archive, rather than silently exporting an arbitrary subset.
          if (message.includes('ZIP limit')) throw error;
          status.failed++;
          status.errors.push(`Page ${i + 1}: ${message}`);
          console.error('[Chapter ZIP] Page could not be loaded:', message);
        }
        status.processed = i + 1;
        status.message = `Preparing pages ${status.processed}/${status.total}…`;
      }
      if (!status.included) throw new Error('No translated images could be loaded. Nothing downloaded.');
      status.phase = 'packing';
      status.message = 'Building ZIP…';
      const archive = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (progress) => {
        status.percent = Math.round(progress.percent);
      });
      if (archive.size > limit) throw new Error(ZIP_LIMIT_MESSAGE);
      (options.download ?? downloadLocalBlob)(archive, `${safeStem(title)}-translated.zip`);
      status.phase = status.failed ? 'partial' : 'success';
      status.percent = 100;
      status.message = `Download started: ${status.included}/${status.total} pages${status.failed ? `; ${status.failed} could not be loaded.` : '.'}`;
      console.log('[Chapter ZIP]', status.message);
    } catch (error) {
      status.phase = 'error';
      status.message = error instanceof Error ? error.message : 'ZIP export failed. Nothing downloaded.';
      console.error('[Chapter ZIP] Export failed:', error);
    } finally { status.busy = false; }
    return { ...status, errors: [...status.errors] };
  }
  return { getStatus, exportChapter };
}
