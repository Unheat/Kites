/**
 * Canonical catalog of selectable PaddleOCR tiers.
 *
 * Single source of truth: the popup and Studio derive their OCR option lists from this array,
 * and default/validation paths read `DEFAULT_OCR_TIER_ID` / `OCR_TIER_IDS` instead of repeating
 * the identifier `v6-small`. Model URLs stay in the offscreen registry because they are runtime
 * loading details, not UI choices.
 */

/** One selectable OCR tier, with the metadata both surfaces render. */
export interface OcrTierDefinition {
  /** Stable identifier persisted in popup state and sent to the offscreen document. */
  readonly id: string;
  /** Display name shown in the popup and Studio selectors. */
  readonly name: string;
  /** Short badge describing the tier's role. */
  readonly tag: string;
  /** Whether choosing the tier requires downloading model files. */
  readonly isModel: boolean;
  /** Approximate download size shown next to the name. */
  readonly sizeEstimate: string;
  /** Whether the offscreen registry marks the tier as advanced; mirrors `ocrRegistry` metadata. */
  readonly isAdvanced: boolean;
}

/**
 * Canonical tier definitions, kept unexported so TypeDoc does not expand the literal tuple into
 * sixty "undocumented property" warnings. The exported catalog re-types it for consumers.
 */
const OCR_TIER_DEFINITIONS = [
  {
    id: 'v6-small',
    name: 'PaddleOCR v6 Small (Default)',
    tag: 'Recommended',
    isModel: true,
    sizeEstimate: '~4 MB',
    isAdvanced: false,
  },
  {
    id: 'v6-medium',
    name: 'PaddleOCR v6 Medium',
    tag: 'Higher Accuracy',
    isModel: true,
    sizeEstimate: '~8 MB',
    isAdvanced: false,
  },
  {
    id: 'v6-tiny',
    name: 'PaddleOCR v6 Tiny',
    tag: 'Ultra Fast',
    isModel: true,
    sizeEstimate: '~2 MB',
    isAdvanced: false,
  },
  {
    id: 'v5-mobile',
    name: 'PaddleOCR v5 Mobile',
    tag: 'Legacy v5',
    isModel: true,
    sizeEstimate: '~4 MB',
    isAdvanced: true,
  },
  {
    id: 'v5-server',
    name: 'PaddleOCR v5 Server',
    tag: 'Server Grade',
    isModel: true,
    sizeEstimate: '~20 MB',
    isAdvanced: true,
  },
  {
    id: 'v5-en-mobile',
    name: 'PaddleOCR v5 English Mobile',
    tag: 'English Tuned',
    isModel: true,
    sizeEstimate: '~4 MB',
    isAdvanced: true,
  },
  {
    id: 'v4-mobile',
    name: 'PaddleOCR v4 Mobile',
    tag: 'Legacy v4',
    isModel: true,
    sizeEstimate: '~4 MB',
    isAdvanced: true,
  },
  {
    id: 'v4-server',
    name: 'PaddleOCR v4 Server',
    tag: 'v4 Server',
    isModel: true,
    sizeEstimate: '~20 MB',
    isAdvanced: true,
  },
  {
    id: 'v3-mobile',
    name: 'PaddleOCR v3 Mobile',
    tag: 'Legacy v3',
    isModel: true,
    sizeEstimate: '~4 MB',
    isAdvanced: true,
  },
  {
    id: 'v3-japanese-mobile',
    name: 'PaddleOCR v3 Japanese Mobile',
    tag: 'Japanese Tuned',
    isModel: true,
    sizeEstimate: '~4 MB',
    isAdvanced: true,
  },
] as const satisfies readonly OcrTierDefinition[];

/** Every OCR tier the extension can run, in display order. */
export const OCR_TIER_CATALOG: readonly OcrTierDefinition[] = OCR_TIER_DEFINITIONS;

/** Identifier union derived from the canonical definitions. */
export type OcrTierId = (typeof OCR_TIER_DEFINITIONS)[number]['id'];

/** Tier applied when storage or a caller names nothing usable. */
export const DEFAULT_OCR_TIER_ID: OcrTierId = 'v6-small';

/** Every catalogued OCR tier id, for validation and status checks. */
export const OCR_TIER_IDS: ReadonlySet<string> = new Set(
  OCR_TIER_CATALOG.map((tier) => tier.id),
);
