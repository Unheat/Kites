import { describe, it, expect } from 'vitest';
import { hashUserSubject } from '../src/auth/google';

describe('Worker Google Auth Utils', () => {
  it('hashes user subject deterministically with HMAC-SHA256', async () => {
    const sub = 'google-sub-1234567890';
    const salt = 'test-salt-secret';

    const hash1 = await hashUserSubject(sub, salt);
    const hash2 = await hashUserSubject(sub, salt);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/); // 256-bit hex
  });

  it('produces different hashes for different subjects or salts', async () => {
    const hashA = await hashUserSubject('sub-1', 'salt');
    const hashB = await hashUserSubject('sub-2', 'salt');
    const hashC = await hashUserSubject('sub-1', 'other-salt');

    expect(hashA).not.toBe(hashB);
    expect(hashA).not.toBe(hashC);
  });
});
