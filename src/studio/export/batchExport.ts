import JSZip from 'jszip';
import { db } from '../../db';
import { exportPageToPsdBlob } from './psdExport';

/** Supported batch archive export variants. */
export type BatchExportFormat = 'images' | 'cbz' | 'psd';

/** Callback progress function reporting completed page count and total. */
export type BatchExportProgressCallback = (current: number, total: number, statusText: string) => void;

/**
 * Initiates an automatic file download in the browser.
 *
 * @param blob - Binary blob payload to save.
 * @param filename - Target filename for the saved file.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Formats a sequential page index into a 3-digit zero-padded number (e.g. 001, 002).
 *
 * @param index - 1-based page number.
 * @returns Zero-padded string.
 */
export function formatPageNumber(index: number): string {
  return String(index).padStart(3, '0');
}

/**
 * Builds standard ComicInfo.xml metadata for CBZ comic archives.
 *
 * @param seriesTitle - Name of the comic or project.
 * @param pageCount - Total number of pages included.
 * @returns XML string.
 */
export function generateComicInfoXml(seriesTitle: string, pageCount: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>${seriesTitle}</Title>
  <Series>${seriesTitle}</Series>
  <PageCount>${pageCount}</PageCount>
  <Manga>Yes</Manga>
</ComicInfo>`;
}

/**
 * Compiles and downloads an entire manga project as a ZIP, CBZ, or layered PSD bundle.
 *
 * @param projectId - Primary key ID of the project to export.
 * @param format - Export format: 'images' (ZIP of PNGs), 'cbz' (Comic Book ZIP), or 'psd' (ZIP of PSDs).
 * @param onProgress - Optional callback for updating download progress UI.
 * @returns Resolves once download is triggered.
 */
export async function exportProjectBundle(
  projectId: number,
  format: BatchExportFormat = 'images',
  onProgress?: BatchExportProgressCallback
): Promise<void> {
  const project = await db.projectFolders.get(projectId);
  const projectTitle = project?.title || 'manga-project';

  // Read member jobs ordered by projectOrder or timestamp
  const jobs = await db.translationJobs.where('folderId').equals(projectId).sortBy('projectOrder');
  if (jobs.length === 0) {
    throw new Error('Project contains no pages to export.');
  }

  const zip = new JSZip();
  const total = jobs.length;

  for (let i = 0; i < total; i++) {
    const job = jobs[i];
    const pageNum = formatPageNumber(i + 1);
    const progressLabel = `Processing page ${i + 1} of ${total}`;
    if (onProgress) onProgress(i + 1, total, progressLabel);

    if (!job.id) continue;
    const imageRecord = await db.images.where({ jobId: job.id }).first();
    if (!imageRecord) continue;

    if (format === 'psd') {
      const textBlocks = imageRecord.id
        ? await db.textBlocks.where({ imageId: imageRecord.id }).toArray()
        : [];
      const psdBlob = await exportPageToPsdBlob(
        imageRecord.rawImageBlob,
        imageRecord.translatedImageBlob || null,
        textBlocks
      );
      zip.file(`${pageNum}.psd`, psdBlob);
    } else {
      // images or cbz: prefer translated raster, fallback to raw original
      const rasterBlob = imageRecord.translatedImageBlob || imageRecord.rawImageBlob;
      const extension = rasterBlob.type.includes('jpeg') ? 'jpg' : 'png';
      zip.file(`${pageNum}.${extension}`, rasterBlob);
    }
  }

  // Include ComicInfo.xml for CBZ packages
  if (format === 'cbz') {
    zip.file('ComicInfo.xml', generateComicInfoXml(projectTitle, total));
  }

  if (onProgress) onProgress(total, total, 'Compressing archive...');

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const safeFilename = projectTitle.replace(/[/\\?%*:|"<>]/g, '_');
  const extension = format === 'cbz' ? 'cbz' : 'zip';
  triggerBrowserDownload(zipBlob, `${safeFilename}.${extension}`);
}
