import { checkWebGPUAvailability } from '../../utils/hardware';
import { colorRegistry } from './colorRegistry';
import { ColorCacheManager } from '../../services/ColorCacheManager';

const ONNX_WARNING_LOG_LEVEL = 2;
const ONNX_ERROR_LOG_LEVEL = 3;

export type OnnxColorProvider = 'cpu' | 'webgpu' | 'wasm';

export interface OnnxColorRuntimeConfig {
  /** Canonical model identifier from colorRegistry (e.g. 'manga-colorization-v2'). */
  modelId: string;
  /** Filesystem path to model binary in Node.js test environment. */
  modelPath: string;
  /** Optional logging tag prefix. */
  logTag?: string;
}

/**
 * Encapsulates ONNX Runtime session lifecycle, model loading, WebGPU setup,
 * and automatic one-way WASM runtime fallback retry for colorization engines.
 * Enables composition over inheritance for distinct ML architectures.
 */
export class OnnxColorRuntime {
  private session: any = null;
  private ort: any = null;
  private activeProvider: OnnxColorProvider | null = null;
  private browserModelBuffer: ArrayBuffer | null = null;
  private config: OnnxColorRuntimeConfig;

  constructor(config: OnnxColorRuntimeConfig) {
    this.config = config;
  }

  get ortInstance(): any {
    return this.ort;
  }

  get sessionInstance(): any {
    return this.session;
  }

  get activeProviderName(): OnnxColorProvider | null {
    return this.activeProvider;
  }

  get modelBuffer(): ArrayBuffer | null {
    return this.browserModelBuffer;
  }

  /**
   * Resolves the provider currently requested by user settings and hardware.
   *
   * @returns WebGPU when enabled and available; otherwise WASM (or CPU in Node.js test environment).
   */
  async getRequestedProvider(): Promise<OnnxColorProvider> {
    if (typeof window === 'undefined') return 'cpu';
    const popupState = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => resolve(response || {}));
    });
    const gpuEnabled = popupState.webgpuMaster === true && popupState.webgpuOverrides?.color !== false;
    const webgpuAvailable = gpuEnabled ? await checkWebGPUAvailability() : false;
    const requestedProvider = gpuEnabled && webgpuAvailable ? 'webgpu' : 'wasm';
    const tag = this.config.logTag || `[OnnxColorRuntime:${this.config.modelId}]`;
    console.log(`${tag} Provider decision:`, { gpuEnabled, webgpuAvailable, requestedProvider });
    return requestedProvider;
  }

  /**
   * Checks whether the active provider matches the currently requested user hardware setting.
   *
   * @returns True when the cached session provider remains current.
   */
  async isProviderCurrent(): Promise<boolean> {
    const requested = await this.getRequestedProvider();
    return this.activeProvider === requested;
  }

  /**
   * Initializes the ONNX Runtime session and loads the model weights.
   */
  async init(): Promise<void> {
    if (this.session) return;
    const tag = this.config.logTag || `[OnnxColorRuntime:${this.config.modelId}]`;
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

    const requestedProvider = (await this.getRequestedProvider()) as Exclude<OnnxColorProvider, 'cpu'>;
    const ortUrl = chrome.runtime.getURL('/ort-wasm/ort.webgpu.mjs');
    this.ort = await import(/* @vite-ignore */ ortUrl);
    if (this.ort.env.webgpu) this.ort.env.webgpu.powerPreference = 'high-performance';
    this.ort.env.wasm.wasmPaths = chrome.runtime.getURL('/ort-wasm/');

    const registryEntry = colorRegistry[this.config.modelId];
    if (!registryEntry) throw new Error(`${tag} Model ID ${this.config.modelId} not found in registry.`);

    this.browserModelBuffer = await ColorCacheManager.getModelBuffer(registryEntry.onnxUrl);

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
  async createBrowserSession(provider: Exclude<OnnxColorProvider, 'cpu'>): Promise<void> {
    const tag = this.config.logTag || `[OnnxColorRuntime:${this.config.modelId}]`;
    if (!this.browserModelBuffer) throw new Error(`${tag} Browser model is not loaded.`);
    this.session = await this.ort.InferenceSession.create(this.browserModelBuffer, {
      executionProviders: [provider],
      logSeverityLevel: (import.meta as any).env?.DEV ? ONNX_WARNING_LOG_LEVEL : ONNX_ERROR_LOG_LEVEL,
    });
    this.activeProvider = provider;
    console.log(`${tag} Browser model loaded with provider: ${this.activeProvider}.`);
  }

  /**
   * Permanently switches this engine instance from WebGPU to WASM after device loss.
   */
  async fallbackToWasm(): Promise<void> {
    if (this.activeProvider !== 'webgpu') return;
    const failedSession = this.session;
    this.session = null;
    if (typeof failedSession?.release === 'function') await failedSession.release();
    await this.createBrowserSession('wasm');
  }

  /**
   * Runs model inference feeds with WebGPU-to-WASM fallback resilience.
   *
   * @param feeds - ONNX input tensors.
   * @returns ONNX inference outputs.
   */
  async runInference(feeds: Record<string, any>): Promise<any> {
    const tag = this.config.logTag || `[OnnxColorRuntime:${this.config.modelId}]`;
    if (!this.session) {
      await this.init();
    }
    try {
      return await this.session.run(feeds);
    } catch (error) {
      if (this.activeProvider === 'webgpu') {
        console.warn(`${tag} WebGPU inference failure; falling back to WASM:`, error);
        await this.fallbackToWasm();
        return await this.session.run(feeds);
      }
      throw error;
    }
  }

  /**
   * Disposes the inference session and unloads model buffers from RAM/VRAM.
   */
  async destroy(): Promise<void> {
    const tag = this.config.logTag || `[OnnxColorRuntime:${this.config.modelId}]`;
    if (this.session) {
      try {
        if (typeof this.session.release === 'function') {
          await this.session.release();
        }
      } catch (err) {
        console.warn(`${tag} Error releasing session:`, err);
      }
      this.session = null;
    }
    this.browserModelBuffer = null;
    this.activeProvider = null;
  }
}
