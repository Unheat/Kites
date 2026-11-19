/**
 * The one canonical list of models whose chat template can open a thinking block.
 *
 * Why a list and not a guess: `@mlc-ai/web-llm` reads `enable_thinking` only from
 * `request.extra_body` and never checks whether the loaded template supports the mechanism — its own
 * typings say so ("Currently only allowed to be used for Qwen3 and MiniCPM5 models, though not
 * explicitly checked"). Passing the flag to a Llama or Gemma template therefore does not fail, it
 * injects out-of-distribution prompt text and returns a worse answer. Worse, with the flag off the
 * runtime prefills the literal ` thinking\n\n</think>\n\n` into both the prompt and the returned
 * content, so the list has to be exactly right in both directions.
 *
 * Ministral-3 reasoning checkpoints use a `[THINK]…[/THINK]` system-prompt convention rather than an
 * inline block, so they are deliberately absent.
 *
 * @module
 */

/**
 * Model-id prefixes that can emit a thinking block, keyed by family.
 *
 * Prefixes rather than full ids: the registry carries several sizes and two quantizations per
 * family, and a new size of the same family supports the same template.
 */
export const THINKING_MODEL_PREFIXES: readonly string[] = [
  'qwen3-',
  'qwen3.5-',
  'minicpm5',
];

/**
 * Whether a model id names a family whose template can open a thinking block.
 *
 * Comparison is case-insensitive on the id as written in the registry and in
 * `prebuiltAppConfig.model_list`, so a caller never has to normalise first.
 *
 * @param modelId - Model identifier, e.g. `Qwen3.5-0.8B-q4f16_1-MLC`.
 * @returns True when the model is known to support the thinking mechanism.
 */
export function isThinkingModel(modelId: string | undefined): boolean {
  if (!modelId) return false;
  const id = modelId.trim().toLowerCase();
  return THINKING_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix));
}
