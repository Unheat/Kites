import { db, cleanupOldJobs, deleteJobs } from '../db';
import type { ProcessJobMessage, PopupState, PreloadActiveEngineMessage } from '../shared/types';
import { DEFAULT_POPUP_STATE } from '../shared/types';
import { CLOUDFLARE_QUOTA_DEFAULT_ENDPOINT } from '../shared/constants';
import modelsRegistryData from '../shared/models-registry.json';
import { normalizeCustomApiConfig } from '../shared/customApi';
import { inpaintRegistry } from '../offscreen/engines/inpaint/inpaintRegistry';
import { resolveOcrTier } from '../offscreen/engines/ocr/ocrRegistry';
import { normalizeRenderFontPresetId } from '../shared/renderFontPresets';
import { oAuthManager } from './auth/OAuthManager';

// Magic Number: Limit concurrency to avoid network/CPU throttling
// We now dynamically load this from user's PopupState (fallback to 3)
// const MAX_CONCURRENT_TRANSLATIONS = 3; //pass the param from UI here

/**
 * How long a job may stay in an in-flight status ('processing'/'downloading') before the
 * queue assumes its owning offscreen document died and reclaims the concurrency slot.
 *
 * Sized at 2 minutes (twice SINGLE_JOB_TIMEOUT_MS of 60s) to guard against dead slots
 * when an offscreen task is terminated or crashes.
 */
const STALE_JOB_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Maximum time in milliseconds to wait for a single translation job to complete
 * before timing out and releasing the concurrency queue slot.
 */
const SINGLE_JOB_TIMEOUT_MS = 60 * 1000;

/**
 * Interval in milliseconds between retries when waiting for the offscreen document
 * to finish booting its bundle and registering message listeners.
 */
const OFFSCREEN_RETRY_INTERVAL_MS = 150;

/**
 * Removes translation engines that are no longer supported from stored popup settings
 * and normalizes render font presets to an allowlisted preset ID.
 *
 * @param popupState - The persisted popup state to validate.
 * @returns The normalized popup state and whether it needs to be saved.
 */
export function normalizePopupState(popupState: Partial<PopupState> | undefined): { state: PopupState; changed: boolean } {
  // WORKAROUND: Legacy popupState objects may omit later GPU fields. The popup starts
  // from defaults and can visually show GPU ON, while offscreen reads the sparse object
  // and treats `webgpuMaster === true` as false. Complete and deep-merge state here so
  // every extension context receives identical values. See devlog 015.
  const completedState: PopupState = {
    ...DEFAULT_POPUP_STATE,
    ...(popupState ?? {}),
    webgpuOverrides: {
      ...DEFAULT_POPUP_STATE.webgpuOverrides,
      ...(popupState?.webgpuOverrides ?? {}),
    },
  };
  const customApis = Array.isArray(completedState.customApis)
    ? completedState.customApis.map(normalizeCustomApiConfig).filter((api): api is NonNullable<typeof api> => Boolean(api))
    : [];
  const uniqueCustomApis = customApis.filter((api, index, apis) => apis.findIndex((candidate) => candidate.id === api.id) === index);
  const webLlmIds = new Set(modelsRegistryData
    .filter((model) => model.engine === 'webllm')
    .map((model) => model.id));
  const customApiIds = new Set(uniqueCustomApis.map((api) => api.id));
  const isSupportedEngine = (engineId: string): boolean =>
    engineId === 'gg-translate' ||
    engineId === 'cloudflare-translate' ||
    webLlmIds.has(engineId) ||
    customApiIds.has(engineId);

  const activeEngineId = isSupportedEngine(completedState.activeEngineId)
    ? completedState.activeEngineId
    : DEFAULT_POPUP_STATE.activeEngineId;
  const fallbackSource = Array.isArray(completedState.fallbackChain) ? completedState.fallbackChain : [];
  const fallbackChain = fallbackSource.filter((engineId, index, chain) =>
    engineId !== activeEngineId && isSupportedEngine(engineId) && chain.indexOf(engineId) === index
  );
  const rawInpaintId = (completedState.activeInpaintId === 'lama-base' || completedState.activeInpaintId === 'lama-manga-fast')
    ? 'lama-manga'
    : (completedState.activeInpaintId === 'aot' ? 'aotgan' : completedState.activeInpaintId);
  const supportedInpaintIds = new Set(['none', 'simple', 'telea', ...Object.keys(inpaintRegistry)]);
  const activeInpaintId = supportedInpaintIds.has(rawInpaintId)
    ? rawInpaintId
    : DEFAULT_POPUP_STATE.activeInpaintId;
  const activeOcrId = resolveOcrTier(completedState.activeOcrId);
  const renderFontPresetId = normalizeRenderFontPresetId(completedState.renderFontPresetId);
  const state: PopupState = {
    ...completedState,
    customApis: uniqueCustomApis,
    activeEngineId,
    activeInpaintId,
    activeOcrId,
    renderFontPresetId,
    fallbackChain,
  };
  const changed = JSON.stringify(state) !== JSON.stringify(popupState ?? {});

  return { state, changed };
}

/**
 * Safely creates context menu items, avoiding duplicate ID runtime errors.
 */
function setupContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: 'translate-image',
        title: 'Translate Image',
        contexts: ['image'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[Background] Context menu setup warning:', chrome.runtime.lastError.message);
        }
      }
    );
    chrome.contextMenus.create(
      {
        id: 'translate-area',
        title: 'Crop & Translate Area',
        contexts: ['page', 'frame', 'selection', 'image', 'video'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[Background] Context menu setup warning:', chrome.runtime.lastError.message);
        }
      }
    );
  });
}

chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, _tab?: chrome.tabs.Tab) => {
  if (info.menuItemId === 'translate-image' && info.srcUrl) {
    const data = await chrome.storage.local.get('popupState');
    const popupState = data.popupState as PopupState | undefined;
    if (popupState && popupState.isExtensionEnabled === false) {
      console.log('[Background] Context menu ignored: Kites extension is disabled.');
      return;
    }
    console.log('[Background] Context menu clicked. Target URL:', info.srcUrl);
    try {
      await queueTranslation(info.srcUrl, _tab?.id);
    } catch (error) {
      console.error('[Background] Context menu translation failed:', error);
    }
  } else if (info.menuItemId === 'translate-area' && _tab?.id) {
    const data = await chrome.storage.local.get('popupState');
    const popupState = data.popupState as PopupState | undefined;
    if (popupState && popupState.isExtensionEnabled === false) {
      console.log('[Background] Context menu ignored: Kites extension is disabled.');
      return;
    }
    console.log('[Background] Context menu Crop & Translate Area clicked for tab:', _tab.id);
    chrome.tabs.sendMessage(_tab.id, { type: 'START_AREA_SELECTION' }).catch((err) => {
      console.warn('[Background] Failed to send START_AREA_SELECTION to tab:', err);
    });
  }
});

// Forward messages from content script or offscreen to popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message.type === 'MODEL_INITIALIZATION' &&
    message.target === 'background' &&
    message.source === 'offscreen' &&
    message.event === true &&
    Number.isInteger(message.payload?.jobId) &&
    (message.payload?.phase === 'started' || message.payload?.phase === 'finished')
  ) {
    const jobId = message.payload.jobId as number;
    db.translationJobs.get(jobId).then((job) => {
      if (!job?.tabId || !job.srcUrl) return;

      const isCapture = job.srcUrl.startsWith('kites-capture:');
      const identity = isCapture
        ? { requestId: job.srcUrl.replace('kites-capture:', '') }
        : { originalUrl: job.srcUrl };
      chrome.tabs.sendMessage(job.tabId, {
        type: 'MODEL_INITIALIZATION',
        target: 'content',
        source: 'background',
        event: true,
        payload: { jobId, phase: message.payload.phase, ...identity },
      }).catch((error) => {
        console.error(`[Background] Failed to forward model initialization for job ${jobId}:`, error);
      });
    }).catch((error) => {
      console.error(`[Background] Failed to resolve model initialization job ${jobId}:`, error);
    });
    return false;
  }

  if (message.type === 'GET_POPUP_STATE') {
    chrome.storage.local.get('popupState').then(async (data) => {
      const storedState = data.popupState as PopupState | undefined;
      const { state, changed } = normalizePopupState(storedState);
      if (changed) {
        console.log('[Background] Removed archived translation engines from popup settings.');
        await chrome.storage.local.set({ popupState: state });
      }
      sendResponse(state);
    }).catch((error) => {
      console.error('[Background] Failed to load popup state:', error);
      sendResponse(DEFAULT_POPUP_STATE);
    });
    return true; // Keep channel open
  }

  if (message.type === 'TRANSLATE_IMAGE') {
    const srcUrl = message.payload?.srcUrl || message.url || message.srcUrl;
    if (srcUrl) {
      chrome.storage.local.get('popupState').then((data) => {
        const popupState = data.popupState as PopupState | undefined;
        if (popupState && popupState.isExtensionEnabled === false) {
          console.warn('[Background] Rejected TRANSLATE_IMAGE: Kites extension is disabled.');
          sendResponse({ status: 'error', error: 'Extension is disabled' });
          return;
        }
        console.log('[Background] Received TRANSLATE_IMAGE from content script. URL:', srcUrl);
        queueTranslation(srcUrl, _sender.tab?.id)
          .then(() => sendResponse({ status: 'queued' }))
          .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
      }).catch((err) => {
        sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      });
      return true; // Keep message channel open for async response
    }
  }

  if (message.type === 'CAPTURE_VISIBLE_TAB') {
    const windowId = _sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({
          status: 'error',
          error: chrome.runtime.lastError?.message || 'Failed to capture visible tab'
        });
      } else {
        sendResponse({
          status: 'success',
          dataUrl
        });
      }
    });
    return true;
  }

  if (message.type === 'TRANSLATE_CAPTURED_IMAGE') {
    const { requestId, dataUrl } = message.payload || {};
    if (!requestId || !dataUrl) {
      sendResponse({ status: 'error', error: 'Missing requestId or dataUrl' });
      return false;
    }
    chrome.storage.local.get('popupState').then(async (data) => {
      const popupState = data.popupState as PopupState | undefined;
      if (popupState && popupState.isExtensionEnabled === false) {
        console.warn('[Background] Rejected TRANSLATE_CAPTURED_IMAGE: Kites extension is disabled.');
        sendResponse({ status: 'error', error: 'Extension is disabled' });
        return;
      }
      console.log('[Background] Received TRANSLATE_CAPTURED_IMAGE from content script. Request ID:', requestId);
      queueCapturedTranslation(requestId, dataUrl, _sender.tab?.id)
        .then(() => sendResponse({ status: 'queued' }))
        .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    }).catch((err) => {
      sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    sendResponse({ status: 'success' });
    return true;
  }
  
  // Pluggable OAuth Dispatcher (Google, Apple, etc.)
  if (message.type === 'SIGN_IN_GOOGLE' || message.type === 'SIGN_IN_AUTH') {
    (async () => {
      try {
        const provider = message.provider || 'google';
        const strategy = oAuthManager.get(provider);
        const userAccount = await strategy.signIn();

        const currentData = await chrome.storage.local.get('popupState');
        const updatedState = {
          ...(currentData.popupState || DEFAULT_POPUP_STATE),
          userAccount,
        };
        await chrome.storage.local.set({ popupState: updatedState });

        sendResponse({ success: true, userAccount });
      } catch (err: any) {
        console.error(`[Background] OAuth sign-in failed:`, err);
        sendResponse({ success: false, error: err?.message || 'Sign in failed' });
      }
    })();
    return true;
  }

  if (message.type === 'SIGN_OUT_GOOGLE' || message.type === 'SIGN_OUT_AUTH') {
    (async () => {
      try {
        const currentData = await chrome.storage.local.get('popupState');
        const storedState = currentData.popupState as PopupState | undefined;
        const provider = message.provider || storedState?.userAccount?.provider || 'google';
        
        try {
          const strategy = oAuthManager.get(provider);
          await strategy.signOut();
        } catch {
          // Continue clearing state even if strategy fails
        }

        const updatedState = {
          ...(currentData.popupState || DEFAULT_POPUP_STATE),
          userAccount: undefined,
        };
        await chrome.storage.local.set({ popupState: updatedState });

        sendResponse({ success: true });
      } catch (err: any) {
        console.error('[Background] OAuth sign-out failed:', err);
        sendResponse({ success: false, error: err?.message || 'Sign out failed' });
      }
    })();
    return true;
  }

  if (message.type === 'GET_AUTH_TOKEN') {
    (async () => {
      try {
        const token = await new Promise<string | undefined>((resolve) => {
          chrome.identity.getAuthToken({ interactive: false }, (tok) => {
            const strToken = typeof tok === 'string' ? tok : (tok as any)?.token;
            resolve(strToken);
          });
        });
        sendResponse({ success: Boolean(token), token: token || '' });
      } catch (err: any) {
        sendResponse({ success: false, token: '', error: err?.message });
      }
    })();
    return true;
  }

  if (message.type === 'REFRESH_CLOUD_QUOTA') {
    (async () => {
      try {
        const token = await new Promise<string | undefined>((resolve) => {
          chrome.identity.getAuthToken({ interactive: false }, (tok) => {
            const strToken = typeof tok === 'string' ? tok : (tok as any)?.token;
            resolve(strToken);
          });
        });

        if (!token) {
          return sendResponse({ success: false, error: 'No auth token available' });
        }

        const res = await fetch(CLOUDFLARE_QUOTA_DEFAULT_ENDPOINT, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.ok) {
          const quota = await res.json() as any;
          const currentData = await chrome.storage.local.get('popupState');
          const current = currentData?.popupState as PopupState | undefined;
          if (current?.userAccount) {
            const updatedAccount = {
              ...current.userAccount,
              quotaRemaining: quota.remaining,
              quotaResetsAt: quota.resetsAt
            };
            await chrome.storage.local.set({
              popupState: { ...current, userAccount: updatedAccount }
            });
            sendResponse({ success: true, quota });
            return;
          }
        }
        sendResponse({ success: false });
      } catch (err: any) {
        sendResponse({ success: false, error: err?.message });
      }
    })();
    return true;
  }

  if (message.type === 'ENSURE_OFFSCREEN') {
    setupOffscreenDocument('src/offscreen/offscreen.html')
      .then(() => sendResponse({ status: 'ready' }))
      .catch((err) => {
        console.error('[Background] Failed to setup offscreen document:', err);
        sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  // WORKAROUND: runtime.sendMessage broadcasts to extension contexts. Without explicit
  // ownership, background and offscreen both handled the popup request and competed to
  // answer, producing closed message ports and silent model downloads. Do not remove
  // these route guards or forward the original unaddressed message. See devlog 015.
  if (message.target === 'background' && message.request === true && (message.type === 'PROCESS_JOB' || message.type === 'START_MODEL_DOWNLOAD' || message.type === 'CHECK_MODEL_STATUS' || message.type === 'GET_MODEL_STATUSES' || message.type === 'CHECK_WEBGPU_SUPPORT' || message.type === 'PRELOAD_ACTIVE_ENGINE' || message.type === 'GET_ACTIVE_DOWNLOADS' || message.type === 'VALIDATE_CUSTOM_API')) {
    console.log(`[Background] Received ${message.type}. Forwarding to Offscreen...`);
    sendMessageToOffscreen(message)
      .then((res) => sendResponse(res))
      .catch((err) => {
        console.error(`[Background] Failed to send ${message.type} to offscreen:`, err);
        sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      });
    return true; // Keep message channel open for async response
  }
});

/**
 * Fails any jobs left in-flight ('processing'/'downloading') from a previous
 * browser session, extension reload, or service worker restart.
 *
 * When the service worker boots fresh, no previous in-memory offscreen processing
 * promise exists, so any job marked in-flight is guaranteed orphaned.
 */
async function resetOrphanedInFlightJobs(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const inFlight = await db.translationJobs
      .where('status')
      .anyOf(['processing', 'downloading'])
      .toArray();
    for (const job of inFlight) {
      console.warn(
        `[Background] Failing orphaned in-flight job ${job.id} (was '${job.status}') from previous session.`
      );
      await db.translationJobs.update(job.id!, { status: 'error' });
    }
  } catch (err) {
    console.error('[Background] Failed to reset orphaned in-flight jobs:', err);
  }
}

// Clean up any orphaned in-flight jobs immediately when service worker starts
resetOrphanedInFlightJobs().catch(() => {});

// Trigger preload and auto-download on extension boot
chrome.runtime.onStartup.addListener(async () => {
  console.log('[Background] Extension startup. Preloading active engine & default OCR...');
  await resetOrphanedInFlightJobs();
  await cleanupOldJobs();
  try {
    await sendMessageToOffscreen({ type: 'PRELOAD_ACTIVE_ENGINE' } as PreloadActiveEngineMessage);
    await sendMessageToOffscreen({
      type: 'START_MODEL_DOWNLOAD',
      payload: { modelId: 'v6-small', category: 'ocr' }
    });
  } catch (error) {
    console.warn('[Background] Startup preload/download warning:', error);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed/updated. Preloading active engine & default OCR...');
  setupContextMenu();
  await resetOrphanedInFlightJobs();
  await cleanupOldJobs();
  try {
    await sendMessageToOffscreen({
      type: 'START_MODEL_DOWNLOAD',
      payload: { modelId: 'v6-small', category: 'ocr' }
    });
    await sendMessageToOffscreen({ type: 'PRELOAD_ACTIVE_ENGINE' } as PreloadActiveEngineMessage);
  } catch (error) {
    console.warn('[Background] Install preload/download warning:', error);
  }
});

// Atomic locks
let creatingOffscreenPromise: Promise<void> | null = null;
let isProcessingQueue = false;

/**
 * Ensures the offscreen document is booted up and ready to receive messages.
 * 
 * @param {string} path - The relative path to the offscreen HTML file (e.g., 'src/offscreen/offscreen.html').
 * @returns {Promise<void>} Resolves when the offscreen document is successfully created or if it already exists.
 */
async function setupOffscreenDocument(path: string) {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }
  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }
  
  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: path,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Heavy ONNX image processing (OCR/Translation) and database writes'
  });

  try {
    await creatingOffscreenPromise;
    console.log('[Background] Offscreen document created successfully.');
  } finally {
    creatingOffscreenPromise = null;
  }
}

/**
 * Sends a message to the offscreen document, ensuring the document exists and retrying
 * if the offscreen document is still booting and evaluating its module bundle.
 *
 * @param message - The message object to send to the offscreen document.
 * @param timeoutMs - Maximum milliseconds to wait for the message to be received.
 * @returns A promise resolving to the response from the offscreen document.
 */
async function sendMessageToOffscreen(message: any, timeoutMs: number = 30000): Promise<any> {
  await setupOffscreenDocument('src/offscreen/offscreen.html');

  const startTime = performance.now();

  while (performance.now() - startTime < timeoutMs) {
    try {
      const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({ ...message, target: 'offscreen', source: 'background', request: true }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (res === undefined) {
            reject(new Error(`Offscreen returned no response for ${message.type}`));
          } else {
            resolve(res);
          }
        });
      });
      return response;
    } catch (err: any) {
      // If the receiving end does not exist yet, the offscreen document is still evaluating scripts
      if (err?.message?.includes('Receiving end does not exist')) {
        await new Promise((resolve) => setTimeout(resolve, OFFSCREEN_RETRY_INTERVAL_MS));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Message ${message.type} to offscreen timed out after ${timeoutMs}ms`);
}

/**
 * Inserts the image URL into the Dexie queue as "queued" and triggers the queue loop.
 * 
 * @param {string} srcUrl - The URL of the image to queue.
 * @param {number} tabId - The ID of the tab that requested the translation (for returning result).
 * @returns {Promise<void>}
 */
async function queueTranslation(srcUrl: string, tabId?: number) {
  const existingJob = srcUrl ? await db.translationJobs.where('srcUrl').equals(srcUrl).first() : null;
  const isStale = existingJob && (Date.now() - existingJob.timestamp > 5000);

  if (existingJob && !isStale && ['queued', 'downloading', 'processing'].includes(existingJob.status as string)) {
    console.log('[Background] URL already in active processing. Skipping duplicate:', srcUrl);
    return;
  }

  if (existingJob) {
    await deleteJobs([existingJob.id!]);
  }

  console.log('[Background] Queuing image URL:', srcUrl);
  await db.translationJobs.add({
    timestamp: Date.now(),
    status: 'queued',
    srcUrl: srcUrl,
    tabId: tabId
  });
  
  // Kick off the queue processor
  processQueue();
}

/**
 * Queues a captured image (crop or screenshot) by saving its Blob to IndexedDB
 * and scheduling it in the background queue.
 *
 * @param {string} requestId - Unique identifier for the capture session.
 * @param {string} dataUrl - Base64 data URL of the cropped screen area.
 * @param {number} [tabId] - ID of the tab that requested translation.
 * @returns {Promise<void>}
 */
async function queueCapturedTranslation(requestId: string, dataUrl: string, tabId?: number): Promise<void> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const srcUrl = `kites-capture:${requestId}`;

  console.log('[Background] Queuing captured screen area:', srcUrl);
  const jobId = (await db.translationJobs.add({
    timestamp: Date.now(),
    status: 'queued',
    srcUrl,
    tabId,
  })) as number;

  await db.images.add({
    jobId,
    rawImageBlob: blob,
  });

  processQueue();
}

/**
 * Checks the queue in Dexie and pulls the next image if under the concurrency limit.
 * 
 * @returns {Promise<void>}
 */
/**
 * Fails any job that has been sitting in an in-flight status ('processing'/'downloading')
 * longer than STALE_JOB_TIMEOUT_MS, so its concurrency slot is released.
 *
 * Such a job cannot genuinely still be running: the offscreen document that owned it is gone
 * (crash, GPU process reset, extension reload), and nothing will ever report its result. The
 * timeout is deliberately generous so a legitimately slow job -- a first run that has to
 * download OCR/LLM weights over a slow connection -- is never killed while it is still making
 * progress.
 *
 * @returns A promise that resolves once any stale jobs have been marked as errored.
 */
async function reclaimStaleJobs(): Promise<void> {
  try {
    const cutoff = Date.now() - STALE_JOB_TIMEOUT_MS;
    const inFlight = await db.translationJobs
      .where('status')
      .anyOf(['processing', 'downloading'])
      .toArray();

    const dead = inFlight.filter((job) => job.timestamp < cutoff);
    for (const job of dead) {
      console.warn(
        `[Background] Reclaiming stale job ${job.id} (status '${job.status}', last touched ` +
        `${Math.round((Date.now() - job.timestamp) / 1000)}s ago). Its owner is gone; freeing the slot.`
      );
      await db.translationJobs.update(job.id!, { status: 'error' });
    }
  } catch (err) {
    // Never let queue maintenance block actual work.
    console.error('[Background] Failed to reclaim stale jobs:', err);
  }
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  
  try {
    // Dynamically fetch concurrency setting
    const stateData = await chrome.storage.local.get('popupState');
    const popupState = stateData.popupState as PopupState | undefined;
    const configuredConcurrency = popupState?.concurrency || 3;
    const concurrency = Math.min(5, Math.max(1, configuredConcurrency));

    // Reclaim slots held by dead jobs before counting capacity.
    //
    // A job is marked 'processing'/'downloading' in IndexedDB while the offscreen document
    // works on it, and only moves to 'completed'/'error' when that work reports back. If the
    // offscreen document is torn down mid-job -- a browser/tab crash, a GPU process reset, or
    // the extension being reloaded -- nothing ever writes that terminal status, so the row
    // stays 'processing' forever and permanently consumes a concurrency slot. At the default
    // concurrency of 1 a single crash bricks the queue for good: every later request just logs
    // "Queue at capacity" and never runs. Anything older than the timeout cannot still be in
    // flight, so it is failed here to release the slot.
    await reclaimStaleJobs();

    // Check how many are currently active
    const downloadingCount = await db.translationJobs.where('status').equals('downloading').count();
    const processingCount = await db.translationJobs.where('status').equals('processing').count();
    const activeCount = downloadingCount + processingCount;
    
    if (activeCount >= concurrency) {
      console.log(`[Background] Queue at capacity (${activeCount}/${concurrency}). Waiting...`);
      return;
    }
    
    const slotsAvailable = concurrency - activeCount;
    console.log(`[Background] Queue slots available: ${slotsAvailable}. Pulling next jobs...`);
    
    // Dexie implicitly orders by primary key ('id') so this fetches chronologically oldest
    const queuedJobs = await db.translationJobs.where('status').equals('queued').limit(slotsAvailable).toArray();
    
    for (const job of queuedJobs) {
      if (!job.id || !job.srcUrl) continue;
      
      // Update status to prevent other queue loops from grabbing it
      await db.translationJobs.update(job.id, { status: 'downloading' });
      
      // Fire it off asynchronously so we process all available slots in parallel
      processImageTranslation(job.id, job.srcUrl, job.tabId).catch(e => {
        console.error(`[Background] Unhandled error processing job ${job.id}:`, e);
      });
    }
    
  } catch (error) {
    console.error('[Background] Error inside processQueue loop:', error);
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * Fetches the image, saves it to Dexie (Zero-Copy Bus), and routes the task to the Offscreen Document.
 * 
 * @param {number} jobId - The ID of the queued translation job.
 * @param {string} srcUrl - The URL of the image to fetch and process.
 * @param {number} tabId - The ID of the tab that requested the translation.
 * @returns {Promise<void>} Resolves when the image is successfully saved to the database and the processing task is queued.
 * @throws {Error} Throws an error if the image fetch fails or database write fails.
 */
async function processImageTranslation(jobId: number, srcUrl: string, tabId?: number) {
  try {
    const existingImage = await db.images.where('jobId').equals(jobId).first();
    if (!existingImage) {
      console.log(`[Background] Fetching image for job ${jobId} from URL: ${srcUrl}`);
      const response = await fetch(srcUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const blob = await response.blob();
      
      console.log(`[Background] Saving blob for job ${jobId} to IndexedDB...`);
      await db.images.add({
        jobId: jobId,
        rawImageBlob: blob
      });
    }
    
    await db.translationJobs.update(jobId, { status: 'processing' });
    
    // Route the Job ID to the Offscreen Document to begin processing with a timeout guard
    const message: ProcessJobMessage = {
      type: 'PROCESS_JOB',
      payload: { jobId: jobId }
    };
    
    console.log(`[Background] Routing task ${jobId} to Offscreen Document...`);
    const offscreenResponse = await sendMessageToOffscreen(message, SINGLE_JOB_TIMEOUT_MS);
    
    console.log(`[Background] Offscreen completed job ${jobId} with status:`, offscreenResponse?.status);
    
    if (offscreenResponse?.status === 'success' && offscreenResponse?.bakedBase64 && tabId) {
      if (srcUrl.startsWith('kites-capture:')) {
        const requestId = srcUrl.replace('kites-capture:', '');
        console.log(`[Background] Sending CAPTURE_TRANSLATED to tab ${tabId} for request ${requestId}...`);
        chrome.tabs.sendMessage(tabId, {
          type: 'CAPTURE_TRANSLATED',
          payload: {
            requestId,
            jobId,
            bakedBase64: offscreenResponse.bakedBase64
          }
        }).catch(() => {});
      } else {
        console.log(`[Background] Sending IMAGE_TRANSLATED back to tab ${tabId}...`);
        chrome.tabs.sendMessage(tabId, {
          type: 'IMAGE_TRANSLATED',
          payload: {
            originalUrl: srcUrl,
            bakedBase64: offscreenResponse.bakedBase64
          }
        }).catch(() => {});
      }
    } else if (offscreenResponse?.status === 'error') {
      throw new Error(offscreenResponse.error || 'Offscreen translation pipeline failed');
    }
    
    // Trigger the queue to pull the next available image!
    processQueue();
    
  } catch (error) {
    console.error(`[Background] Failed to process image for job ${jobId}:`, error);
    await db.translationJobs.update(jobId, { status: 'error' });
    
    if (tabId) {
      if (srcUrl.startsWith('kites-capture:')) {
        const requestId = srcUrl.replace('kites-capture:', '');
        chrome.tabs.sendMessage(tabId, {
          type: 'CAPTURE_TRANSLATION_ERROR',
          payload: {
            requestId,
            error: error instanceof Error ? error.message : String(error)
          }
        }).catch(() => {});
      } else {
        chrome.tabs.sendMessage(tabId, {
          type: 'TRANSLATION_ERROR',
          payload: { originalUrl: srcUrl }
        }).catch(() => {});
      }
    }

    // Trigger queue again so slots opened up by this error are immediately reclaimed
    processQueue();
    throw error;
  }
}
