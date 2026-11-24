import { describe, expect, it } from 'vitest';
import { resolveStudioOperationOverrides } from './studioRouteSettings';

describe('Studio operation overrides', () => {
  it('forwards every selected engine tier to offscreen operations', () => {
    expect(resolveStudioOperationOverrides({
      selectedOcrEngineId: 'v6-medium',
      selectedInpaintEngineId: 'telea',
      selectedTranslationEngineId: 'cloudflare-translate',
    })).toEqual({
      ocrEngineId: 'v6-medium',
      inpaintEngineId: 'telea',
      translationEngineId: 'cloudflare-translate',
    });
  });
});