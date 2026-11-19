/**
 * Centralized constants for Kites extension.
 */

export const CLOUDFLARE_WORKER_BASE_URL = 'https://api.12094852.xyz';
export const CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT = `${CLOUDFLARE_WORKER_BASE_URL}/v1/chat/completions`;
export const CLOUDFLARE_QUOTA_DEFAULT_ENDPOINT = `${CLOUDFLARE_WORKER_BASE_URL}/v1/quota`;
export const CLOUDFLARE_TRANSLATE_MODEL = 'kites-translation';

/**
 * Single Source of Truth for chrome.storage.local keys across all extension contexts
 * (Background Service Worker, Popup, Offscreen Document, Content Scripts).
 */
export const STORAGE_KEYS = {
  POPUP_STATE: 'popupState',
  AUTH_TOKEN: 'kites_oauth_auth_token',
  AUTH_EXPIRES_AT: 'kites_oauth_token_expires_at',
  WEBGPU_SUPPORTED: 'hardware_webgpu_supported',
  ACTIVE_COLOR_ID: 'activeColorId',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * CacheStorage cache names WebLLM writes model artifacts into.
 *
 * The scope string is used verbatim as the cache name by WebLLM's `createScopedArtifactCache`.
 * Single source of truth for deletion; the names are part of the library's on-disk contract.
 */
export const WEBLLM_CACHE_SCOPES = ['webllm/model', 'webllm/config', 'webllm/wasm'] as const;

/** One of the CacheStorage cache names WebLLM owns. */
export type WebLlmCacheScope = (typeof WEBLLM_CACHE_SCOPES)[number];

/**
 * Canonical Typesetting Modes supported across pipeline and Studio.
 * Derived from Single Source of Truth as per AGENTS.md rules.
 */
export const TYPESET_MODES = ['contour', 'balloon', 'simple'] as const;
export type TypesetMode = (typeof TYPESET_MODES)[number];
export const DEFAULT_TYPESET_MODE: TypesetMode = 'contour';

/**
 * Modes that cannot fit anything without a detected bubble chamber polygon. Region text that
 * never had a bubble contour (captions, narration, free text) must not be offered these.
 */
export const CONTOUR_REQUIRED_TYPESET_MODES = ['contour'] as const satisfies readonly TypesetMode[];

/**
 * Lists the typeset modes an object may use, derived from the canonical {@link TYPESET_MODES}
 * catalog so the UI, the editing fallback and any future consumer cannot drift apart.
 *
 * @param hasBubbleContour - Whether the object carries detected bubble contour evidence.
 * @returns Canonical modes this object can actually fit with.
 */
export function availableTypesetModes(hasBubbleContour: boolean): TypesetMode[] {
  if (hasBubbleContour) return [...TYPESET_MODES];
  return TYPESET_MODES.filter(
    (mode) => !(CONTOUR_REQUIRED_TYPESET_MODES as readonly TypesetMode[]).includes(mode)
  );
}

/**
 * Canonical image formats supported for Studio uploads and processing pipeline.
 * Formats like SVG and multi-frame GIF are explicitly excluded to prevent pipeline stalls.
 */
export const SUPPORTED_STUDIO_IMAGE_FORMATS = [
  { id: 'png', mime: 'image/png', ext: '.png', label: 'PNG' },
  { id: 'jpeg', mime: 'image/jpeg', ext: '.jpg', label: 'JPEG' },
  { id: 'jpeg-alt', mime: 'image/jpeg', ext: '.jpeg', label: 'JPEG' },
  { id: 'webp', mime: 'image/webp', ext: '.webp', label: 'WebP' },
  { id: 'avif', mime: 'image/avif', ext: '.avif', label: 'AVIF' },
] as const;

export const SUPPORTED_STUDIO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
] as const;

export const SUPPORTED_STUDIO_FILE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
] as const;

/**
 * HTML file-input `accept` attribute string forcing OS file picker to only allow supported images.
 */
export const STUDIO_IMAGE_INPUT_ACCEPT = 'image/png,image/jpeg,image/webp,image/avif,.png,.jpg,.jpeg,.webp,.avif';


