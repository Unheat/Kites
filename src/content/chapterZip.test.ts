import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import {
  captureChapterPosition,
  createChapterTranslationRegistry,
  CHAPTER_ZIP_BYTE_LIMIT,
  orderChapterImages,
  createChapterExporter,
  downloadLocalBlob,
  type ChapterImageRecord,
} from './chapterZip';

describe('chapterZip', () => {
  describe('position capture and reading order', () => {
    it('captures DOM path and vertical scroll position for connected elements', () => {
      const container = document.createElement('div');
      const page1 = document.createElement('div');
      const page2 = document.createElement('div');
      container.appendChild(page1);
      container.appendChild(page2);
      document.body.appendChild(container);

      // In jsdom getBoundingClientRect returns zeros unless mocked or rect specified
      page2.getBoundingClientRect = () => ({
        top: 450,
        bottom: 950,
        left: 0,
        right: 800,
        width: 800,
        height: 500,
        x: 0,
        y: 450,
        toJSON: () => {},
      });

      const position = captureChapterPosition(page2, 'https://example.com/ch/1', 2);
      expect(position.sourcePage).toBe('https://example.com/ch/1');
      expect(position.sequence).toBe(2);
      expect(position.documentPath).toBeDefined();
      expect(position.documentY).toBe(450);

      document.body.removeChild(container);
    });

    it('orders images by DOM path and Y, not completion order', () => {
      const sourcePage = 'https://example.com/reader?ch=1';
      // Page 2 completed before Page 1
      const records: ChapterImageRecord[] = [
        {
          originalUrl: 'https://example.com/page2.jpg',
          translatedUrl: 'blob:https://example.com/page2-baked',
          sourcePage,
          documentPath: [0, 1],
          documentY: 1200,
          sequence: 2,
        },
        {
          originalUrl: 'https://example.com/page1.jpg',
          translatedUrl: 'blob:https://example.com/page1-baked',
          sourcePage,
          documentPath: [0, 0],
          documentY: 200,
          sequence: 1,
        },
      ];

      const ordered = orderChapterImages(records, sourcePage);
      expect(ordered.map((r) => r.originalUrl)).toEqual([
        'https://example.com/page1.jpg',
        'https://example.com/page2.jpg',
      ]);
    });

    it('interleaves reused slots across navigation sequences (ordered slot pattern)', () => {
      const sourcePage = 'https://example.com/reader?ch=1';
      // Single reusable canvas/viewer slot [0, 0] receiving page after page
      const records: ChapterImageRecord[] = [
        {
          originalUrl: 'https://example.com/slide2.jpg',
          translatedUrl: 'blob:https://example.com/slide2-baked',
          sourcePage,
          documentPath: [0, 0],
          documentY: 0,
          sequence: 2,
        },
        {
          originalUrl: 'https://example.com/slide1.jpg',
          translatedUrl: 'blob:https://example.com/slide1-baked',
          sourcePage,
          documentPath: [0, 0],
          documentY: 0,
          sequence: 1,
        },
      ];

      const ordered = orderChapterImages(records, sourcePage);
      expect(ordered.map((r) => r.originalUrl)).toEqual([
        'https://example.com/slide1.jpg',
        'https://example.com/slide2.jpg',
      ]);
    });

    it('interleaves alternating slots and keeps archived positions when a connected slot is recycled', () => {
      const sourcePage = 'https://example.com/ch';
      const surface = document.createElement('img');
      document.body.append(surface);
      surface.setAttribute('data-kites-applied-src', 'blob:new');
      const records = [4, 2, 3, 1].map((sequence): ChapterImageRecord => ({
        originalUrl: `page-${sequence}`, translatedUrl: `blob:${sequence}`, sourcePage,
        documentPath: [0, sequence % 2 === 0 ? 1 : 0], documentY: 0, sequence,
        surfaceElement: surface, sourceElement: surface,
      }));
      expect(orderChapterImages(records, sourcePage).map((record) => record.sequence)).toEqual([1, 2, 3, 4]);
      expect(orderChapterImages(records, sourcePage)[0].documentPath).toEqual([0, 0]);
      surface.remove();
    });

    it('distinguishes sibling shadow-root slots instead of treating them as one reused slot', () => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open' });
      const first = document.createElement('img');
      const second = document.createElement('img');
      root.append(first, second);
      document.body.append(host);
      const sourcePage = 'https://example.com/ch';
      const records = [second, first].map((surfaceElement, index): ChapterImageRecord => ({
        originalUrl: String(index), translatedUrl: `blob:${index}`, ...captureChapterPosition(surfaceElement, sourcePage, index + 1),
      }));
      expect(orderChapterImages(records, sourcePage).map((record) => record.originalUrl)).toEqual(['1', '0']);
      host.remove();
    });

    it('filters out records from other chapters or query/hash navigations', () => {
      const currentChapter = 'https://example.com/reader#ch2';
      const prevChapter = 'https://example.com/reader#ch1';

      const records: ChapterImageRecord[] = [
        {
          originalUrl: 'https://example.com/ch1-p1.jpg',
          translatedUrl: 'blob:https://example.com/ch1-p1-baked',
          sourcePage: prevChapter,
          documentPath: [0, 0],
          documentY: 100,
          sequence: 1,
        },
        {
          originalUrl: 'https://example.com/ch2-p1.jpg',
          translatedUrl: 'blob:https://example.com/ch2-p1-baked',
          sourcePage: currentChapter,
          documentPath: [0, 0],
          documentY: 100,
          sequence: 2,
        },
      ];

      const ordered = orderChapterImages(records, currentChapter);
      expect(ordered.length).toBe(1);
      expect(ordered[0].originalUrl).toBe('https://example.com/ch2-p1.jpg');
    });

    it('preserves detached records whose elements were removed from the DOM', () => {
      const sourcePage = 'https://example.com/infinite-scroll';
      // A detached page has no live element or unmeasurable element
      const records: ChapterImageRecord[] = [
        {
          originalUrl: 'https://example.com/detached-p1.jpg',
          translatedUrl: 'blob:https://example.com/detached-p1-baked',
          sourcePage,
          documentPath: [0, 0],
          documentY: 100,
          sequence: 1,
          surfaceElement: undefined,
        },
      ];

      const ordered = orderChapterImages(records, sourcePage);
      expect(ordered.length).toBe(1);
      expect(ordered[0].originalUrl).toBe('https://example.com/detached-p1.jpg');
    });
  });

  describe('queue-time registry lifecycle', () => {
    it('archives detached completion in its queued chapter, reuses duplicate blob, and scopes lookup', () => {
      let sourcePage = 'https://example.com/reader#one';
      const createTranslatedUrl = vi.fn().mockReturnValue('blob:first');
      const revokeTranslatedUrl = vi.fn();
      const registry = createChapterTranslationRegistry({ getSourcePage: () => sourcePage, createTranslatedUrl, revokeTranslatedUrl });
      const surface = document.createElement('img');
      document.body.append(surface);
      registry.remember('https://cdn/page.png', { surfaceElement: surface, sourceElement: surface });
      const queuedPath = captureChapterPosition(surface, sourcePage, 1).documentPath;
      surface.remove();
      sourcePage = 'https://example.com/reader#two';
      const record = registry.complete('https://cdn/page.png', 'data:first', 101)!;
      expect(record.sourcePage).toBe('https://example.com/reader#one');
      expect(record.documentPath).toEqual(queuedPath);
      expect(registry.get(record.originalUrl)).toBeUndefined();
      expect(orderChapterImages(registry.getRecords(), sourcePage)).toEqual([]);
      expect(registry.complete(record.originalUrl, 'data:first', 101)).toBe(record);
      expect(createTranslatedUrl).toHaveBeenCalledTimes(1);
      expect(revokeTranslatedUrl).not.toHaveBeenCalled();
    });

    it('clears failed queue context and replaces only the current chapter version without stale aliases', () => {
      let sourcePage = 'https://example.com/one';
      const createTranslatedUrl = vi.fn().mockReturnValueOnce('blob:two').mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two-new');
      const revokeTranslatedUrl = vi.fn();
      const registry = createChapterTranslationRegistry({ getSourcePage: () => sourcePage, createTranslatedUrl, revokeTranslatedUrl });
      const url = 'https://cdn/shared.png';
      registry.remember(url);
      registry.forget(url);
      sourcePage = 'https://example.com/two';
      registry.remember(url);
      const two = registry.complete(url, 'data:two', 2)!;
      expect(two.sourcePage).toBe(sourcePage);
      sourcePage = 'https://example.com/one';
      registry.remember(url);
      registry.complete(url, 'data:one', 3);
      sourcePage = 'https://example.com/two';
      registry.remember(url);
      const updated = registry.complete(url, 'data:two-new', 4)!;
      expect(updated.sequence).toBe(two.sequence);
      expect(registry.get(url)).toBe(updated);
      expect([...registry.getRecords()]).toHaveLength(2);
      expect(orderChapterImages(registry.getRecords(), sourcePage)[0].translatedUrl).toBe('blob:two-new');
      expect(revokeTranslatedUrl).toHaveBeenCalledExactlyOnceWith('blob:two');
      expect(registry.complete(url, 'data:old-event', 2)).toBeUndefined();
      expect(createTranslatedUrl).toHaveBeenCalledTimes(3);
    });

    it('captures native context-menu detachment but does not let an unrelated menu override a real queue', () => {
      let sourcePage = 'https://example.com/one';
      const registry = createChapterTranslationRegistry({ getSourcePage: () => sourcePage, createTranslatedUrl: () => 'blob:result', revokeTranslatedUrl: vi.fn() });
      const surface = document.createElement('img');
      document.body.append(surface);
      registry.rememberContextMenu('context', { surfaceElement: surface });
      surface.remove();
      sourcePage = 'https://example.com/two';
      expect(registry.complete('context', 'data:result', 1)?.sourcePage).toBe('https://example.com/one');
      registry.rememberContextMenu('overlay', { surfaceElement: surface });
      sourcePage = 'https://example.com/three';
      registry.remember('overlay');
      expect(registry.complete('overlay', 'data:result', 2)?.sourcePage).toBe(sourcePage);
      expect(registry.complete('untracked', 'data:result', 3)).toBeUndefined();
    });
  });

  describe('createChapterExporter', () => {
    it('generates a valid STORE ZIP, asserts contents, byte count, zero-padded names and order', async () => {
      const sourcePage = 'https://example.com/ch1';
      const samplePngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
      const sampleJpgBytes = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);

      const records: ChapterImageRecord[] = [
        {
          originalUrl: 'https://example.com/raw/page02.png',
          translatedUrl: 'blob:page2',
          sourcePage,
          documentPath: [0, 1],
          documentY: 500,
          sequence: 2,
        },
        {
          originalUrl: 'https://example.com/raw/page01.jpg',
          translatedUrl: 'blob:page1',
          sourcePage,
          documentPath: [0, 0],
          documentY: 100,
          sequence: 1,
        },
      ];

      const mockFetcher = vi.fn().mockImplementation((url: string) => {
        if (url === 'blob:page1') {
          return Promise.resolve(
            new Response(sampleJpgBytes, {
              status: 200,
              headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(sampleJpgBytes.byteLength) },
            })
          );
        }
        if (url === 'blob:page2') {
          return Promise.resolve(
            new Response(samplePngBytes, {
              status: 200,
              headers: { 'Content-Type': 'image/png', 'Content-Length': String(samplePngBytes.byteLength) },
            })
          );
        }
        return Promise.reject(new Error('not found'));
      });

      let downloadedBlob: Blob | null = null;
      let downloadedFilename: string | null = null;

      const exporter = createChapterExporter({
        getRecords: () => records,
        getSourcePage: () => sourcePage,
        getTitle: () => 'My Manga Chapter 1',
        fetcher: mockFetcher,
        download: (blob, filename) => {
          downloadedBlob = blob;
          downloadedFilename = filename;
        },
      });

      const initialStatus = exporter.getStatus();
      expect(initialStatus.total).toBe(2);
      expect(initialStatus.phase).toBe('idle');

      const result = await exporter.exportChapter();
      expect(result.phase).toBe('success');
      expect(result.included).toBe(2);
      expect(result.failed).toBe(0);
      expect(downloadedFilename).toBe('My-Manga-Chapter-1-translated.zip');
      expect(downloadedBlob).toBeInstanceOf(Blob);

      // Unpack and assert ZIP entries
      const zip = await JSZip.loadAsync(await downloadedBlob!.arrayBuffer());
      const fileNames = Object.keys(zip.files);
      expect(fileNames).toEqual(['001_page01.jpg', '002_page02.png']);

      // Check extracted content
      const file1 = zip.file('001_page01.jpg');
      const file2 = zip.file('002_page02.png');
      expect(file1).not.toBeNull();
      expect(file2).not.toBeNull();

      const content1 = await file1!.async('uint8array');
      const content2 = await file2!.async('uint8array');
      expect(content1).toEqual(sampleJpgBytes);
      expect(content2).toEqual(samplePngBytes);
    });

    it('reports partial success and skips failed fetches without failing the whole archive', async () => {
      const sourcePage = 'https://example.com/ch1';
      const validBytes = new Uint8Array([1, 2, 3, 4, 5]);

      const records: ChapterImageRecord[] = [
        {
          originalUrl: 'https://example.com/p1.png',
          translatedUrl: 'blob:p1',
          sourcePage,
          documentPath: [0, 0],
          documentY: 10,
          sequence: 1,
        },
        {
          originalUrl: 'https://example.com/p2.png',
          translatedUrl: 'blob:p2',
          sourcePage,
          documentPath: [0, 1],
          documentY: 20,
          sequence: 2,
        },
      ];

      const mockFetcher = vi.fn().mockImplementation((url: string) => {
        if (url === 'blob:p1') {
          return Promise.resolve(
            new Response(validBytes, {
              status: 200,
              headers: { 'Content-Type': 'image/png' },
            })
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      let downloadedBlob: Blob | null = null;
      const exporter = createChapterExporter({
        getRecords: () => records,
        getSourcePage: () => sourcePage,
        getTitle: () => 'Partial Chapter',
        fetcher: mockFetcher,
        download: (blob) => {
          downloadedBlob = blob;
        },
      });

      const result = await exporter.exportChapter();
      expect(result.phase).toBe('partial');
      expect(result.included).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(downloadedBlob).not.toBeNull();

      const zip = await JSZip.loadAsync(await downloadedBlob!.arrayBuffer());
      expect(Object.keys(zip.files)).toEqual(['001_p1.png']);
    });

    it('fails gracefully with phase error when all fetches fail; nothing downloaded', async () => {
      const sourcePage = 'https://example.com/ch1';
      const records: ChapterImageRecord[] = [
        {
          originalUrl: 'https://example.com/p1.png',
          translatedUrl: 'blob:p1',
          sourcePage,
          documentPath: [0, 0],
          documentY: 10,
          sequence: 1,
        },
      ];

      const mockFetcher = vi.fn().mockRejectedValue(new Error('Network error'));
      let downloaded = false;

      const exporter = createChapterExporter({
        getRecords: () => records,
        getSourcePage: () => sourcePage,
        getTitle: () => 'Failed Chapter',
        fetcher: mockFetcher,
        download: () => {
          downloaded = true;
        },
      });

      const result = await exporter.exportChapter();
      expect(result.phase).toBe('error');
      expect(result.included).toBe(0);
      expect(downloaded).toBe(false);
      expect(result.message).toContain('No translated images could be loaded');
    });

    it('returns empty phase when no records match current page; no download occurs', async () => {
      let downloaded = false;
      const exporter = createChapterExporter({
        getRecords: () => [],
        getSourcePage: () => 'https://example.com/empty',
        getTitle: () => 'Empty Chapter',
        download: () => {
          downloaded = true;
        },
      });

      const result = await exporter.exportChapter();
      expect(result.phase).toBe('empty');
      expect(downloaded).toBe(false);
      expect(result.message).toContain('No translated pages');
    });

    it('enforces byte limit cap and prevents oversized downloads', async () => {
      const sourcePage = 'https://example.com/ch1';
      const bigPayload = new Uint8Array(2000);

      const records: ChapterImageRecord[] = [
        {
          originalUrl: 'https://example.com/p1.png',
          translatedUrl: 'blob:p1',
          sourcePage,
          documentPath: [0, 0],
          documentY: 10,
          sequence: 1,
        },
      ];

      const mockFetcher = vi.fn().mockResolvedValue(
        new Response(bigPayload, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': '2000' },
        })
      );

      let downloaded = false;
      const exporter = createChapterExporter({
        getRecords: () => records,
        getSourcePage: () => sourcePage,
        getTitle: () => 'Oversized Chapter',
        fetcher: mockFetcher,
        byteLimit: 1000, // Small limit
        download: () => {
          downloaded = true;
        },
      });

      const result = await exporter.exportChapter();
      expect(result.phase).toBe('error');
      expect(result.message).toContain('256 MiB ZIP limit');
      expect(downloaded).toBe(false);
    });

    it('bounds unknown-length streams cumulatively and cancels before downloading an arbitrary subset', async () => {
      expect(CHAPTER_ZIP_BYTE_LIMIT).toBe(256 * 1024 * 1024);
      const sourcePage = 'https://example.com/ch';
      const records = [1, 2].map((sequence): ChapterImageRecord => ({
        originalUrl: `page-${sequence}`, translatedUrl: `blob:${sequence}`, sourcePage,
        documentPath: [sequence], documentY: sequence, sequence,
      }));
      const cancel = vi.fn();
      const fetcher = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(500), { headers: { 'content-type': 'image/png' } }))
        .mockResolvedValueOnce(new Response(new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array(500)); }, cancel,
        }), { headers: { 'content-type': 'image/png' } }));
      const download = vi.fn();
      const exporter = createChapterExporter({ getRecords: () => records, getSourcePage: () => sourcePage, getTitle: () => 'ch', fetcher, download, byteLimit: 2800 });
      const result = await exporter.exportChapter();
      expect(result.phase).toBe('error');
      expect(result.message).toContain('256 MiB ZIP limit');
      expect(result.included).toBe(1);
      expect(cancel).toHaveBeenCalledOnce();
      expect(download).not.toHaveBeenCalled();
    });

    it('snapshots title, context and page list before an SPA navigation during export', async () => {
      let sourcePage = 'https://example.com/ch1';
      let title = 'Chapter One';
      const records: ChapterImageRecord[] = [{ originalUrl: 'https://cdn/one.jpg', translatedUrl: 'blob:one', sourcePage, documentPath: [0], documentY: 1, sequence: 1 }];
      let resolveFetch!: (response: Response) => void;
      const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
      const download = vi.fn();
      const exporter = createChapterExporter({ getRecords: () => records, getSourcePage: () => sourcePage, getTitle: () => title, fetcher, download });
      const result = exporter.exportChapter();
      sourcePage = 'https://example.com/ch2';
      title = 'Chapter Two';
      records.push({ ...records[0], originalUrl: 'two', sourcePage, translatedUrl: 'blob:two' });
      resolveFetch(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }));
      expect((await result).total).toBe(1);
      expect(download.mock.calls[0][1]).toBe('Chapter-One-translated.zip');
      expect(fetcher).toHaveBeenCalledOnce();
      expect(exporter.getStatus()).toMatchObject({ phase: 'idle', total: 1, included: 0 });
    });

    it('skips remote, empty and non-image translations and never downloads an empty ZIP', async () => {
      const sourcePage = 'https://example.com/ch';
      const records = ['https://remote/image.png', 'blob:empty', 'blob:html'].map((translatedUrl, sequence): ChapterImageRecord => ({
        originalUrl: `page-${sequence}`, translatedUrl, sourcePage, documentPath: [sequence], documentY: 0, sequence,
      }));
      const fetcher = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(), { headers: { 'content-type': 'image/png' } }))
        .mockResolvedValueOnce(new Response('not an image', { headers: { 'content-type': 'text/html' } }));
      const download = vi.fn();
      const exporter = createChapterExporter({ getRecords: () => records, getSourcePage: () => sourcePage, getTitle: () => 'ch', fetcher, download });
      expect(await exporter.exportChapter()).toMatchObject({ phase: 'error', included: 0, failed: 3 });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(download).not.toHaveBeenCalled();
    });

    it('guards against concurrent re-entry while export is in progress', async () => {
      const sourcePage = 'https://example.com/ch1';
      let resolveFirstFetch!: (res: Response) => void;
      const firstFetchPromise = new Promise<Response>((resolve) => {
        resolveFirstFetch = resolve;
      });

      const records: ChapterImageRecord[] = [
        {
          originalUrl: 'https://example.com/p1.png',
          translatedUrl: 'blob:p1',
          sourcePage,
          documentPath: [0, 0],
          documentY: 10,
          sequence: 1,
        },
      ];

      const mockFetcher = vi.fn().mockReturnValue(firstFetchPromise);
      let downloadCount = 0;

      const exporter = createChapterExporter({
        getRecords: () => records,
        getSourcePage: () => sourcePage,
        getTitle: () => 'Concurrent Test',
        fetcher: mockFetcher,
        download: () => {
          downloadCount++;
        },
      });

      // Launch first export
      const p1 = exporter.exportChapter();
      expect(exporter.getStatus().busy).toBe(true);

      // Re-entry call while busy
      const p2 = exporter.exportChapter();
      expect(exporter.getStatus().busy).toBe(true);

      resolveFirstFetch(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      );

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(downloadCount).toBe(1);
      expect(res1.phase).toBe('success');
      expect(res2.busy).toBe(true); // second call returned snapshot of busy state
    });
  });

  describe('downloadLocalBlob', () => {
    it('creates object URL, triggers anchor click, and revokes after delay', () => {
      vi.useFakeTimers();
      try {
        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-zip');
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const blob = new Blob(['mock data'], { type: 'application/zip' });
        downloadLocalBlob(blob, 'test.zip');
        expect(click).toHaveBeenCalledOnce();
        expect(document.querySelector('a[download="test.zip"]')).toBeNull();
        click.mockRestore();

        expect(createObjectURL).toHaveBeenCalledWith(blob);
        expect(revokeObjectURL).not.toHaveBeenCalled();

        // Advance timers by 60s
        vi.advanceTimersByTime(60_000);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-zip');

        createObjectURL.mockRestore();
        revokeObjectURL.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
