/**
 * outputModes.ts
 *
 * Canonical catalog of structured-output tiers shared by the extension and the worker.
 * Platform-independent: no Chrome, DOM, or Cloudflare imports.
 */

/**
 * Canonical catalog of the structured-output tiers a request can use.
 *
 * Mirrors the wire meaning in both layers so `json-schema` always means the same
 * constrained-grammar guarantee whether a request goes to the community pool or to a
 * user's own endpoint. Ordered from most permissive to most constrained; UI, validation
 * and the worker derive their id sets from this array.
 */
export const STRUCTURED_OUTPUT_MODES = [
  {
    id: 'prompt-only',
    label: 'Prompt Only',
    description: 'Sends no response_format field. The safest choice for unknown hosts, proxies, and local servers.',
  },
  {
    id: 'json-object',
    label: 'JSON Object',
    description: 'Sends { type: "json_object" }. Guarantees valid JSON syntax; b0..bN keys stay prompt-enforced.',
  },
  {
    id: 'json-schema',
    label: 'JSON Schema',
    description: 'Sends a strict keyed schema. Token-level constrained decoding guarantees the exact b0..bN keys.',
  },
] as const;

/** Invariant id union for the structured-output catalog. */
export type StructuredOutputModeId = (typeof STRUCTURED_OUTPUT_MODES)[number]['id'];

/** Lookup set derived from the catalog so validators never duplicate the id list. */
const STRUCTURED_OUTPUT_MODE_IDS: ReadonlySet<string> = new Set(
  STRUCTURED_OUTPUT_MODES.map((mode) => mode.id)
);

/**
 * Checks whether a persisted or user-supplied value is a catalog structured-output tier.
 *
 * @param value - Unknown value read from storage or a UI control.
 * @returns True when the value is one of the catalog ids.
 */
export function isStructuredOutputModeId(value: unknown): value is StructuredOutputModeId {
  return typeof value === 'string' && STRUCTURED_OUTPUT_MODE_IDS.has(value);
}
