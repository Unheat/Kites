import { ocrRegistry, resolveOcrTier } from '../engines/ocr/ocrRegistry';

/**
 * Cache and download manager for OCR models and character dictionaries.
 * Stores weights in Cache API under 'kites-ocr-models-v1' to ensure 100% offline
 * loading and zero network latency during active translation jobs.
 */
export class OcrCacheManager {
  private static CACHE_NAME = 'kites-ocr-models-v1';

  /**
   * Checks if an exact URL is cached in the Cache API.
   *
   * @param url - The absolute URL of the model file or dictionary.
   * @returns Promise resolving to true if cached, false otherwise.
   */
  static async isUrlCached(url: string): Promise<boolean> {
    try {
      if (typeof caches === 'undefined') return false;
      const cache = await caches.open(this.CACHE_NAME);
      const response = await cache.match(url);
      return !!response;
    } catch (e) {
      console.warn(`[OcrCacheManager] Failed to check cache for ${url}:`, e);
      return false;
    }
  }

  /**
   * Checks if all 3 components of an OCR model (detection, recognition, dictionary)
   * are fully cached and ready for inference.
   *
   * @param modelId - The OCR model tier ID (e.g. 'v6-small').
   * @returns Promise resolving to true if completely cached, false otherwise.
   */
  static async isModelCached(modelId: string): Promise<boolean> {
    try {
      if (typeof caches === 'undefined') return false;
      const canonicalId = resolveOcrTier(modelId);
      const entry = ocrRegistry[canonicalId];
      if (!entry) return false;

      const cache = await caches.open(this.CACHE_NAME);
      const [detMatch, recMatch, dictMatch] = await Promise.all([
        cache.match(entry.detectionUrl),
        cache.match(entry.recognitionUrl),
        cache.match(entry.charactersDictionaryUrl)
      ]);

      return !!(detMatch && recMatch && dictMatch);
    } catch (e) {
      console.warn(`[OcrCacheManager] Failed to check model cache for ${modelId}:`, e);
      return false;
    }
  }

  /**
   * Retrieves an ArrayBuffer for a given model URL, serving from cache when available
   * or downloading and caching automatically.
   *
   * @param url - The absolute URL of the asset.
   * @returns ArrayBuffer of the requested asset.
   */
  static async getModelBuffer(url: string): Promise<ArrayBuffer> {
    if (typeof caches === 'undefined') {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
      return await response.arrayBuffer();
    }

    const cache = await caches.open(this.CACHE_NAME);
    let response = await cache.match(url);

    if (response) {
      console.log(`[OcrCacheManager] Loaded from cache: ${url}`);
      return await response.arrayBuffer();
    }

    console.log(`[OcrCacheManager] Not cached. Downloading: ${url}`);
    response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download resource from ${url}: ${response.statusText}`);
    }

    await cache.put(url, response.clone());
    return await response.arrayBuffer();
  }

  /**
   * Downloads a single resource while tracking streamed bytes to update progress.
   *
   * @param url - Resource URL to download.
   * @param progressCallback - Callback receiving fractional progress (0 to 1).
   */
  private static async downloadUrlWithStreamProgress(
    url: string,
    progressCallback: (fraction: number) => void
  ): Promise<void> {
    if (typeof caches === 'undefined') {
      progressCallback(1);
      return;
    }

    const cache = await caches.open(this.CACHE_NAME);
    const cachedResponse = await cache.match(url);
    if (cachedResponse) {
      progressCallback(1);
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      await cache.put(url, response.clone());
      progressCallback(1);
      return;
    }

    const totalBytes = parseInt(contentLength, 10);
    let loadedBytes = 0;
    const reader = response.body?.getReader();
    if (!reader) {
      await cache.put(url, response.clone());
      progressCallback(1);
      return;
    }

    const stream = new ReadableStream({
      async start(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          loadedBytes += value.length;
          progressCallback(loadedBytes / totalBytes);
          controller.enqueue(value);
        }
      }
    });

    const clonedResponse = new Response(stream, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });

    await cache.put(url, clonedResponse);
  }

  /**
   * Downloads the detection model, recognition model, and character dictionary
   * sequentially with monotonic progress reporting (0 to 1).
   *
   * @param modelId - OCR tier ID to download.
   * @param progressCallback - Callback receiving progress number (0 to 1).
   */
  static async downloadModelWithProgress(
    modelId: string,
    progressCallback: (progress: number) => void
  ): Promise<void> {
    const canonicalId = resolveOcrTier(modelId);
    const entry = ocrRegistry[canonicalId];
    if (!entry) {
      throw new Error(`[OcrCacheManager] Unknown OCR model: ${modelId}`);
    }

    // Allocation ratios for overall progress:
    // Detection (approx 30%), Recognition (approx 65%), Dictionary (approx 5%)
    const DET_WEIGHT = 0.30;
    const REC_WEIGHT = 0.65;
    const DICT_WEIGHT = 0.05;

    // 1. Download Detection Model
    await this.downloadUrlWithStreamProgress(entry.detectionUrl, (p) => {
      progressCallback(p * DET_WEIGHT);
    });

    // 2. Download Recognition Model
    await this.downloadUrlWithStreamProgress(entry.recognitionUrl, (p) => {
      progressCallback(DET_WEIGHT + p * REC_WEIGHT);
    });

    // 3. Download Character Dictionary
    await this.downloadUrlWithStreamProgress(entry.charactersDictionaryUrl, (p) => {
      progressCallback(DET_WEIGHT + REC_WEIGHT + p * DICT_WEIGHT);
    });

    progressCallback(1);
  }
}
