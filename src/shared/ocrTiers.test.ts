import { describe, expect, it } from 'vitest';
import { ocrRegistry } from '../offscreen/engines/ocr/ocrRegistry';
import { DEFAULT_OCR_TIER_ID, OCR_TIER_CATALOG, OCR_TIER_IDS } from './ocrTiers';

describe('OCR tier catalog', () => {
  it('keeps the shared catalog and the offscreen registry aligned', () => {
    expect(OCR_TIER_CATALOG.map((tier) => tier.id).sort()).toEqual(Object.keys(ocrRegistry).sort());
  });

  it('has unique ids and a default that is catalogued', () => {
    const ids = OCR_TIER_CATALOG.map((tier) => tier.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(OCR_TIER_IDS.has(DEFAULT_OCR_TIER_ID)).toBe(true);
  });
});
