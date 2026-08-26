export class InpaintCacheManager {
  private static CACHE_NAME = 'kites-inpaint-models-v1';

  /**
   * Checks if a model exists in the Cache API.
   * @param modelUrl The full URL to the ONNX model or data file.
   * @returns true if cached, false otherwise.
   */
  static async isModelCached(modelUrl: string): Promise<boolean> {
    try {
      const cache = await caches.open(this.CACHE_NAME);
      const response = await cache.match(modelUrl);
      return !!response;
    } catch (e) {
      console.warn(`[InpaintCacheManager] Failed to check cache for ${modelUrl}:`, e);
      return false;
    }
  }

  /**
   * Fetches the model as an ArrayBuffer, preferring the cache.
   * If not cached, it will download it (without progress tracking) and cache it.
   * @param modelUrl The full URL to the ONNX model or data file.
   * @returns ArrayBuffer of the model.
   */
  static async getModelBuffer(modelUrl: string): Promise<ArrayBuffer> {
    const cache = await caches.open(this.CACHE_NAME);
    let response = await cache.match(modelUrl);

    if (response) {
      console.log(`[InpaintCacheManager] Model loaded from cache: ${modelUrl}`);
      return await response.arrayBuffer();
    }

    console.log(`[InpaintCacheManager] Model not cached. Downloading: ${modelUrl}`);
    response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Failed to download model from ${modelUrl}: ${response.statusText}`);
    }

    // Cache a clone of the response
    await cache.put(modelUrl, response.clone());
    return await response.arrayBuffer();
  }

  /**
   * Downloads a model and streams progress back via the provided callback.
   * @param modelUrl The full URL to the ONNX model or data file.
   * @param progressCallback Callback with progress from 0 to 1.
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
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      // Cannot track progress
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
