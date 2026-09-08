import { describe, expect, it } from 'vitest';
import {
  CLOUDFLARE_QUOTA_DEFAULT_ENDPOINT,
  CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT,
  CLOUDFLARE_WORKER_BASE_URL,
} from './constants';

describe('Cloudflare shared pool endpoints', () => {
  it('derives API endpoints from the protected custom domain', () => {
    expect(CLOUDFLARE_WORKER_BASE_URL).toBe('https://api.12094852.xyz');
    expect(CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT).toBe(
      'https://api.12094852.xyz/v1/chat/completions',
    );
    expect(CLOUDFLARE_QUOTA_DEFAULT_ENDPOINT).toBe(
      'https://api.12094852.xyz/v1/quota',
    );
  });
});
