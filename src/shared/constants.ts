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
export const TYPESET_MODES = ['ellipse', 'balloon', 'simple'] as const;
export type TypesetMode = (typeof TYPESET_MODES)[number];
export const DEFAULT_TYPESET_MODE: TypesetMode = 'balloon';

