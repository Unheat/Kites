import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Reads the shipped manifest from the repository root.
 *
 * @returns Parsed manifest object.
 */
const readManifest = (): { permissions?: string[] } =>
  JSON.parse(readFileSync(join(process.cwd(), 'manifest.json'), 'utf8'));

describe('extension manifest', () => {
  it('asks for unlimited storage, so WebLLM weights are not evictable', () => {
    // WebLLM keeps multi-GB weights in the extension origin's CacheStorage. Without this
    // permission the whole origin is quota-managed, and eviction is whole-origin rather than
    // per-file, so losing it takes the Studio project data with it.
    expect(readManifest().permissions).toContain('unlimitedStorage');
  });
});
