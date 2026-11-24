import { describe, expect, it } from 'vitest';
import { ocrRegistry } from '../offscreen/engines/ocr/ocrRegistry';
import { DEFAULT_OCR_TIER_ID, OCR_TIER_CATALOG, OCR_TIER_IDS } from './ocrTiers';

describe('OCR tier catalog', () => {
  it('matches the offscreen OCR registry ids, names, and advanced flags', () => {
    expect(Array.from(OCR_TIER_IDS)).toEqual(Object.keys(ocrRegistry));
    expect(OCR_TIER_CATALOG.map((tier) => ({
      id: tier.id,
      name: tier.name,
      isAdvanced: tier.isAdvanced,
    }))).toEqual(Object.entries(ocrRegistry).map(([id, entry]) => ({
      id,
      name: entry.name,
      isAdvanced: entry.isAdvanced ?? false,
    })));
  });

  it('declares a single default tier that exists in the catalog', () => {
    expect(OCR_TIER_CATALOG.filter((tier) => tier.id === DEFAULT_OCR_TIER_ID)).toHaveLength(1);
  });
});
