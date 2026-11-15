/**
 * Canonical structured-output plan shared by every provider adapter.
 *
 * The adapters differ only in wire format; the capability decision lives here so a new
 * output mode is a compile-time error until every adapter handles it.
 */

import type { ProviderRouteConfig } from '../config/providers';
import type { OpenAIChatRequest } from '../types';

/** Wire-independent description of the structured-output request. */
export type OutputPlan =
  | { kind: 'none' }
  | { kind: 'json-object' }
  | { kind: 'json-schema'; schema: Record<string, unknown> };

/**
 * Resolves a route capability plus the canonical request into one output plan.
 *
 * `json-schema` falls back to `json-object` when the caller did not supply a schema,
 * preserving the pre-refactor adapter behavior.
 *
 * @param route - Target provider route with its output capability.
 * @param request - Canonical chat request, optionally carrying a JSON schema.
 * @returns The plan each adapter translates into its provider-specific request shape.
 * @throws Error when the capability is not covered by the exhaustive switch.
 */
export function resolveOutputPlan(
  route: ProviderRouteConfig,
  request: OpenAIChatRequest
): OutputPlan {
  switch (route.outputCapability) {
    case 'prompt-only':
      return { kind: 'none' };
    case 'json-object':
      return { kind: 'json-object' };
    case 'json-schema':
      if (request.response_format?.type === 'json_schema') {
        return { kind: 'json-schema', schema: request.response_format.json_schema.schema };
      }
      return { kind: 'json-object' };
    default: {
      const unreachable: never = route.outputCapability;
      throw new Error(`Unsupported output capability: ${String(unreachable)}`);
    }
  }
}
