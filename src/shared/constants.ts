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
 * Canonical Typesetting Modes supported across pipeline and Studio.
 * Derived from Single Source of Truth as per AGENTS.md rules.
 */
export const TYPESET_MODES = ['contour', 'balloon', 'simple'] as const;
export type TypesetMode = (typeof TYPESET_MODES)[number];
export const DEFAULT_TYPESET_MODE: TypesetMode = 'contour';

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


