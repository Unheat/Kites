/**
 * Cache manager for neural speech bubble detector ONNX models using the browser Cache API.
 */
export class BubbleCacheManager {
  private static CACHE_NAME = 'kites-bubble-models-v1';

  /**
   * Checks if a bubble detector model exists in the Cache API.
   *
   * @param modelUrl - The full remote URL to the ONNX model file.
   * @returns True if cached and resident on disk, false otherwise.
   */
  static async isModelCached(modelUrl: string): Promise<boolean> {
    try {
      if (typeof caches === 'undefined') return false;
      const cache = await caches.open(this.CACHE_NAME);
      const response = await cache.match(modelUrl);
      return Boolean(response);
    } catch (error) {
      console.warn(`[BubbleCacheManager] Failed to check cache for ${modelUrl}:`, error);
      return false;
    }
  }

  /**
   * Retrieves the model binary as an ArrayBuffer, reading from cache first and fetching if absent.
   *
   * @param modelUrl - The full remote URL to the ONNX model file.
   * @returns An ArrayBuffer holding the model weights.
   */
  static async getModelBuffer(modelUrl: string): Promise<ArrayBuffer> {
    const cache = await caches.open(this.CACHE_NAME);
    let response = await cache.match(modelUrl);

    if (response) {
      console.log(`[BubbleCacheManager] Model loaded from cache: ${modelUrl}`);
      return await response.arrayBuffer();
    }

    console.log(`[BubbleCacheManager] Model not cached. Downloading: ${modelUrl}`);
    response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Failed to download bubble detector model from ${modelUrl}: ${response.statusText}`);
    }

    await cache.put(modelUrl, response.clone());
    return await response.arrayBuffer();
  }

  /**
   * Downloads a model and streams download progress back via the provided callback.
   *
   * @param modelUrl - The full remote URL to the ONNX model file.
   * @param progressCallback - Callback receiving monotonic progress from 0.0 to 1.0.
   */
  static async downloadModelWithProgress(
    modelUrl: string,
    progressCallback: (progress: number) => void
  ): Promise<void> {
    const cache = await caches.open(this.CACHE_NAME);
    const cachedResponse = await cache.match(modelUrl);

    if (cachedResponse) {
      progressCallback(1);
      return;
    }

    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`HTTP error downloading bubble detector! status: ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      await cache.put(modelUrl, response.clone());
      progressCallback(1);
      return;
    }

    const total = parseInt(contentLength, 10);
    let loaded = 0;

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

    const stream = new ReadableStream({
      async start(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          loaded += value.length;
          progressCallback(loaded / total);
          controller.enqueue(value);
        }
      }
    });

    const newResponse = new Response(stream, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });

    await cache.put(modelUrl, newResponse);
  }
}
