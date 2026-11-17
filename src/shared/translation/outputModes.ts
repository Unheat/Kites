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

/** Asks the model for the exact keyed object the parser reads back. */
const KEY_CONTRACT_RULE =
  'Return only one JSON object with the exact same keys as SOURCE, mapping each key to its translated text.';

/** Asks for a bare object, for hosts that will happily wrap JSON in prose or markdown. */
const RAW_JSON_GUARD_RULE =
  'Output raw JSON only. Do not add markdown code fences, explanations, or commentary.';

/**
 * Output-format rules a prompt must carry for a structured-output tier.
 *
 * The tier decides what the *decoder* already guarantees, so the prompt only needs to defend what
 * is left: a `json-schema` request cannot emit a different key or markdown, a `json-object` request
 * can emit any key it likes, and a `prompt-only` request guarantees nothing at all. Translation
 * content rules are tier-independent and never live here.
 *
 * Record-typed over the catalog ids, so adding a tier fails to compile until it is classified.
 *
 * @param mode - Structured-output tier the request will use.
 * @returns Format rule lines to append to the system prompt, in stable order.
 */
export function formatRulesFor(mode: StructuredOutputModeId): readonly string[] {
  switch (mode) {
    case 'json-schema':
      return [];
    case 'json-object':
      return [KEY_CONTRACT_RULE];
    case 'prompt-only':
      return [KEY_CONTRACT_RULE, RAW_JSON_GUARD_RULE];
  }
}
