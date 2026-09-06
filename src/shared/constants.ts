/**
 * Centralized constants for Kites extension.
 */

export const CLOUDFLARE_WORKER_BASE_URL = 'https://kites-translate-pool.andangtruong085.workers.dev';
export const CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT = `${CLOUDFLARE_WORKER_BASE_URL}/v1/chat/completions`;
export const CLOUDFLARE_QUOTA_DEFAULT_ENDPOINT = `${CLOUDFLARE_WORKER_BASE_URL}/v1/quota`;
export const CLOUDFLARE_TRANSLATE_MODEL = 'kites-translation';
