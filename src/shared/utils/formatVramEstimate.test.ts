import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatVramEstimate } from './formatVramEstimate';

describe('formatVramEstimate', () => {
  it('keeps small models in megabytes', () => {
    expect(formatVramEstimate('~711 MB')).toBe('~711 MB');
    expect(formatVramEstimate('~150 MB')).toBe('~150 MB');
    expect(formatVramEstimate('0 MB')).toBe('0 MB');
  });

  it('switches to one decimal of a gigabyte below 10 GB', () => {
    expect(formatVramEstimate('~1629 MB')).toBe('~1.6 GB');
    expect(formatVramEstimate('~1129 MB')).toBe('~1.1 GB');
    expect(formatVramEstimate('~4598 MB')).toBe('~4.5 GB');
    // The boundary is 1000 MB, because the catalogue rounds: `~1001 MB` must not sit next to
    // `~2.2 GB` as a different unit.
    expect(formatVramEstimate('~1001 MB')).toBe('~1 GB');
    expect(formatVramEstimate('~1024 MB')).toBe('~1 GB');
  });

  it('drops the decimal above 10 GB', () => {
    expect(formatVramEstimate('~31153 MB')).toBe('~30 GB');
    expect(formatVramEstimate('~11151 MB')).toBe('~11 GB');
  });

  it('accepts a value already expressed in gigabytes', () => {
    expect(formatVramEstimate('1.5 GB')).toBe('1.5 GB');
  });

  it('returns unparseable input untouched instead of hiding it', () => {
    expect(formatVramEstimate('')).toBe('');
    expect(formatVramEstimate(undefined)).toBe('');
    expect(formatVramEstimate('unknown')).toBe('unknown');
  });

  it('formats every catalogue entry to at most six characters', () => {
    // The label shares a 10 px line with the `[WEBGPU]` tag; a regression that prints megabytes for
    // the 31 GB model would push the row wider than the panel.
    const registry = JSON.parse(
      readFileSync(join(__dirname, '../models-registry.json'), 'utf8')
    ) as Array<{ id: string; vramEstimate: string }>;

    expect(registry).toHaveLength(59);
    for (const model of registry) {
      const label = formatVramEstimate(model.vramEstimate);
      expect(label, model.id).toMatch(/^(~\d+(\.\d)? (MB|GB))$/);
      expect(label.length, `${model.id}: ${label}`).toBeLessThanOrEqual(8);
    }
  });
});
