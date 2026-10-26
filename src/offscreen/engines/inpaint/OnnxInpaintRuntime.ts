import { checkWebGPUAvailability } from '../../utils/hardware';
import { inpaintRegistry } from './inpaintRegistry';
import { InpaintCacheManager } from '../../services/InpaintCacheManager';

const ONNX_WARNING_LOG_LEVEL = 2;
const ONNX_ERROR_LOG_LEVEL = 3;

export type OnnxInpaintProvider = 'cpu' | 'webgpu' | 'wasm';

export interface OnnxInpaintRuntimeConfig {
  /** Canonical model identifier from inpaintRegistry (e.g. 'aotgan', 'lama-base', 'lama-manga'). */
  modelId: string;
  /** Filesystem path to model binary in Node.js test environment. */
  modelPath: string;
  /** Optional logging tag prefix. */
  logTag?: string;
}

/**
 * Encapsulates ONNX Runtime session lifecycle, model loading, WebGPU setup,
 * and automatic one-way WASM runtime fallback retry for inpainting engines.
 * Enables composition over inheritance for distinct ML architectures.
 */
export class OnnxInpaintRuntime {
  private session: any = null;
  private ort: any = null;
  private activeProvider: OnnxInpaintProvider | null = null;
  private forcedProvider: OnnxInpaintProvider | null = null;
  private browserModelBuffer: ArrayBuffer | null = null;
  private browserExternalData: Array<{ data: ArrayBuffer; path: string }> | undefined;
  private config: OnnxInpaintRuntimeConfig;

  constructor(config: OnnxInpaintRuntimeConfig) {
    this.config = config;
  }

  get ortInstance(): any {
    return this.ort;
  }

  set ortInstance(val: any) {
    this.ort = val;
  }

  get sessionInstance(): any {
    return this.session;
  }

  set sessionInstance(val: any) {
    this.session = val;
  }

  get activeProviderName(): OnnxInpaintProvider | null {
    return this.activeProvider;
  }

  set activeProviderName(val: OnnxInpaintProvider | null) {
    this.activeProvider = val;
  }

  get modelBuffer(): ArrayBuffer | null {
    return this.browserModelBuffer;
  }

  set modelBuffer(val: ArrayBuffer | null) {
    this.browserModelBuffer = val;
  }

  /**
   * Resolves the provider currently requested by user settings and hardware.
   *
   * @returns WebGPU when enabled and available; otherwise WASM.
   */
  async getRequestedProvider(): Promise<Exclude<OnnxInpaintProvider, 'cpu'>> {
    if (typeof window === 'undefined') return 'wasm';
    const popupState = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => resolve(response || {}));
    });
    const gpuEnabled = popupState.webgpuMaster === true && popupState.webgpuOverrides?.inpaint !== false;
    const webgpuAvailable = gpuEnabled ? await checkWebGPUAvailability() : false;
    const requestedProvider = gpuEnabled && webgpuAvailable ? 'webgpu' : 'wasm';
    const tag = this.config.logTag || `[OnnxInpaintRuntime:${this.config.modelId}]`;
    console.log(`${tag} Provider decision:`, { gpuEnabled, webgpuAvailable, requestedProvider });
    return requestedProvider;
  }

  /**
   * Checks whether the active provider matches the currently requested user hardware setting.
   *
   * @returns True when the cached session provider remains current.
   */
  async isProviderCurrent(): Promise<boolean> {
    if (this.forcedProvider) {
      return this.activeProvider === this.forcedProvider;
    }
    const requested = await this.getRequestedProvider();
    return this.activeProvider === requested;
  }

  /**
   * Initializes the ONNX Runtime session and loads the model weights.
   * In Node.js, loads the model from the local filesystem. In the browser,
   * fetches the model from the extension's cached model registry and configures
   * WebGPU or WASM execution providers based on hardware availability and user settings.
   */
  async init(): Promise<void> {
    if (this.session) return;
    const tag = this.config.logTag || `[OnnxInpaintRuntime:${this.config.modelId}]`;
    const isNode = typeof window === 'undefined';
    if (isNode) {
      this.ort = await import('onnxruntime-node');
      this.activeProvider = 'cpu';
      this.session = await this.ort.InferenceSession.create(this.config.modelPath, {
        executionProviders: [this.activeProvider],
        logSeverityLevel: ONNX_ERROR_LOG_LEVEL,
      });
      console.log(`${tag} Model loaded with provider: ${this.activeProvider}.`);
      return;
    }

    const requestedProvider = await this.getRequestedProvider();
    const ortUrl = chrome.runtime.getURL('/ort-wasm/ort.webgpu.mjs');
    this.ort = await import(/* @vite-ignore */ ortUrl);
    if (this.ort.env.webgpu) this.ort.env.webgpu.powerPreference = 'high-performance';
    this.ort.env.wasm.wasmPaths = chrome.runtime.getURL('/ort-wasm/');

    const registryEntry = inpaintRegistry[this.config.modelId];
    if (!registryEntry) throw new Error(`${tag} Model ID ${this.config.modelId} not found in registry.`);

    this.browserModelBuffer = await InpaintCacheManager.getModelBuffer(registryEntry.onnxUrl);
    if (registryEntry.dataUrl) {
      const data = await InpaintCacheManager.getModelBuffer(registryEntry.dataUrl);
      const dataFileName = new URL(registryEntry.dataUrl).pathname.split('/').pop()!;
      this.browserExternalData = [{ data, path: dataFileName }];
    }

    // WORKAROUND: ORT WebGPU can pass adapter validation but fail during graph compilation.
    // Try user-requested GPU provider first, then recreate session on WASM so image job survives.
    try {
      await this.createBrowserSession(requestedProvider);
    } catch (error) {
      if (requestedProvider !== 'webgpu') throw error;
      console.error(`${tag} WebGPU session creation failed; falling back to WASM:`, error);
      await this.createBrowserSession('wasm');
    }
  }

  /**
   * Creates a browser inference session for one explicit execution provider.
   */
  async createBrowserSession(provider: Exclude<OnnxInpaintProvider, 'cpu'>): Promise<void> {
    const tag = this.config.logTag || `[OnnxInpaintRuntime:${this.config.modelId}]`;
    if (!this.browserModelBuffer) throw new Error(`${tag} Browser model is not loaded.`);
    this.session = await this.ort.InferenceSession.create(this.browserModelBuffer, {
      executionProviders: [provider],
      logSeverityLevel: (import.meta as any).env?.DEV ? ONNX_WARNING_LOG_LEVEL : ONNX_ERROR_LOG_LEVEL,
      externalData: this.browserExternalData,
    });
    this.activeProvider = provider;
    console.log(`${tag} Browser model loaded with provider: ${this.activeProvider}.`);
  }

  /**
   * Permanently switches this engine instance from WebGPU to WASM after device loss.
   */
  async fallbackToWasm(): Promise<void> {
    if (this.activeProvider !== 'webgpu') return;
    const tag = this.config.logTag || `[OnnxInpaintRuntime:${this.config.modelId}]`;
    const failedSession = this.session;
    this.session = null;
    this.forcedProvider = 'wasm';
    if (typeof failedSession?.release === 'function') {
      try {
        await failedSession.release();
      } catch (e) {
        console.warn(`${tag} Non-fatal session release error during fallback:`, e);
      }
    }
    await this.createBrowserSession('wasm');
  }

  /**
   * Runs one patch and retries it once on WASM after a WebGPU runtime failure.
   *
   * @param feeds - ONNX input tensors for the patch.
   * @returns ONNX inference outputs.
   */
  async runPatch(feeds: Record<string, any>): Promise<any> {
    const tag = this.config.logTag || `[OnnxInpaintRuntime:${this.config.modelId}]`;
    // WORKAROUND: Device loss can occur after a WebGPU session initializes. Permit one
    // provider transition for the engine instance; repeated retries would loop forever
    // on malformed models or persistent WASM failures. See devlog 015.
    try {
      return await this.session.run(feeds);
    } catch (error) {
      if (this.activeProvider !== 'webgpu') throw error;
      console.error(`${tag} WebGPU patch failed; switching permanently to WASM and retrying once:`, error);
      await this.fallbackToWasm();
      return this.session.run(feeds);
    }
  }

  /**
   * Releases session and frees GPU/WASM buffers.
   */
  async destroy(): Promise<void> {
    if (this.session && typeof this.session.release === 'function') {
      try {
        await this.session.release();
      } catch (err) {
        console.warn(`[OnnxInpaintRuntime] Error releasing session:`, err);
      }
    }
    this.session = null;
    this.activeProvider = null;
    this.forcedProvider = null;
    this.browserModelBuffer = null;
    this.browserExternalData = undefined;
  }
}
