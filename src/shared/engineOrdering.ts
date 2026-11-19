/**
 * Single source of truth for the ordering of every installable-engine dropdown.
 *
 * Dropdowns are ordered in three layers:
 * 1. Defaults - always-ready engines pinned first in the order declared here.
 * 2. Installed - anything downloaded (or added as a custom API), alphabetical.
 * 3. Not installed - alphabetical, except the translation dropdown, where the
 *    recommended models for each size tier are pinned above the rest.
 */

/** Minimum shape needed to group an engine inside a dropdown. */
export interface OrderableEngine {
  /** Registry engine id. */
  readonly id: string;
  /** Display name used for alphabetical ordering. */
  readonly name: string;
  /** Whether the engine is ready to use locally (downloaded or built in). */
  readonly isDownloaded?: boolean;
}

/** Size buckets used to curate the recommended translation models. */
export type TranslationModelSizeTier = 'small' | 'medium' | 'big';

/** One curated translation recommendation with its size bucket and rationale. */
export interface RecommendedTranslationModel {
  /** Registry model id. */
  readonly id: string;
  /** Size tier the model competes in. */
  readonly tier: TranslationModelSizeTier;
  /** Short benchmark/language-coverage reason for pinning it. */
  readonly rationale: string;
}

/**
 * Curated WebLLM translation models, three per size tier, ordered best-first.
 *
 * All ids exist in `src/shared/models-registry.json` (and therefore in the
 * bundled `@mlc-ai/web-llm` prebuilt catalog). Selection is based on published
 * translation benchmarks and multilingual coverage:
 *
 * - Qwen3.5 model cards report WMT24++ (XCOMET-XXL, 55 languages) scores:
 *   0.8B = 27.2, 2B = 45.8, 4B = 66.6, 9B = 72.6. Qwen3.5 cards claim 201
 *   languages, the widest coverage of any model in our registry.
 * - Qwen3 cards report WMT24++ (same benchmark): 1.7B = 39.3, 4B = 58.9.
 *   Qwen3 claims 119 languages.
 * - LFM2.5-1.2B (added in web-llm 0.2.89) matches Qwen3-1.7B on Japanese
 *   knowledge/instruction benchmarks (JMMLU 47.7) while using ~1.0 GB VRAM and
 *   running roughly twice as fast. It covers 8 languages, all CJK sources
 *   included (English, Arabic, Chinese, French, German, Japanese, Korean,
 *   Spanish), so it is the best cheap option for manga translation.
 *
 * Known-but-rejected: Llama 3.1/3.2 (8 official languages), Mistral 7B v0.3
 * (English-centric), Phi-3.5/4-mini (strong reasoning, narrower multilingual
 * coverage), Ministral 3 3B (good multilingual MMLU, no WMT24++ figure or
 * CJK-strong claim), MiniCPM5-2B (English/Chinese only; multilingual stress
 * tests produced fabricated translations), SmolLM3-3B (six European languages
 * only).
 *
 * The 70B Llama is deliberately NOT pinned: at ~31 GB VRAM it is a "super
 * big" tier that cannot run on typical machines, so it stays in the
 * alphabetical not-installed tail.
 */
export const RECOMMENDED_TRANSLATION_MODEL_ENTRIES: readonly RecommendedTranslationModel[] = [
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    tier: 'small',
    rationale: 'Best measured sub-2B translation quality (WMT24++ 39.3), 119 languages.',
  },
  {
    id: 'LFM2.5-1.2B-Instruct-q4f16_1-MLC',
    tier: 'small',
    rationale: 'Fastest strong small model (~1.0 GB VRAM, ~2x Qwen3 speed); 8 languages including CJK.',
  },
  {
    id: 'Qwen3.5-0.8B-q4f16_1-MLC',
    tier: 'small',
    rationale: 'Smallest Qwen3.5 footprint overall, 201 languages (WMT24++ 27.2).',
  },
  {
    id: 'Qwen3.5-4B-q4f16_1-MLC',
    tier: 'medium',
    rationale: 'Best medium-tier translation score (WMT24++ 66.6), 201 languages.',
  },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    tier: 'medium',
    rationale: 'Strong measured alternative (WMT24++ 58.9) with 119 languages.',
  },
  {
    id: 'Qwen3.5-2B-q4f16_1-MLC',
    tier: 'medium',
    rationale: 'Newest 2B generation (WMT24++ 45.8), 201 languages, ~2.2 GB VRAM.',
  },
  {
    id: 'Qwen3.5-9B-q4f16_1-MLC',
    tier: 'big',
    rationale: 'Best big-tier translation score (WMT24++ 72.6), 201 languages.',
  },
  {
    id: 'Qwen3-8B-q4f16_1-MLC',
    tier: 'big',
    rationale: 'Proven 119-language alternative when Qwen3.5 is unavailable.',
  },
  {
    id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    tier: 'big',
    rationale: 'Older but strong 29-language translator; widely validated in practice.',
  },
];

/** Recommended translation model ids in pinned order (small -> medium -> big). */
export const RECOMMENDED_TRANSLATION_MODELS: readonly string[] =
  RECOMMENDED_TRANSLATION_MODEL_ENTRIES.map((entry) => entry.id);

/**
 * Resolves the always-on default group for a dropdown from its selected
 * default id. The translation dropdown has two defaults because the free
 * Google endpoint and the shared cloud pool ship ready to use.
 *
 * @param defaultId - The engine id selected by default for this dropdown.
 * @returns Engine ids that must stay pinned above every other group.
 */
export function defaultGroupFor(defaultId: string): readonly string[] {
  switch (defaultId) {
    case 'gg-translate':
      return ['gg-translate', 'cloudflare-translate'];
    default:
      return [defaultId];
  }
}

/**
 * Orders a dropdown without mutating the source list.
 *
 * @param engines - Engines to order.
 * @param defaultIds - Always-ready ids pinned at the top, in the given order.
 * @param recommendedIds - Ids pinned at the top of the not-installed group.
 * @returns A new array ordered defaults -> installed -> not installed.
 */
export function orderEngines<T extends OrderableEngine>(
  engines: readonly T[],
  defaultIds: readonly string[],
  recommendedIds: readonly string[] = [],
): T[] {
  const defaultRank = new Map(defaultIds.map((id, index) => [id, index]));
  const recommendedRank = new Map(recommendedIds.map((id, index) => [id, index]));

  /**
   * Layer rank: 0 = default, 1 = installed, 2 = not installed.
   *
   * @param engine - Engine being classified.
   * @returns Numeric group rank, lower sorts first.
   */
  const groupRank = (engine: T): number => {
    if (defaultRank.has(engine.id)) return 0;
    return engine.isDownloaded ? 1 : 2;
  };

  return [...engines].sort((left, right) => {
    const leftGroup = groupRank(left);
    const rightGroup = groupRank(right);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;

    if (leftGroup === 0) {
      return defaultRank.get(left.id)! - defaultRank.get(right.id)!;
    }

    if (leftGroup === 2) {
      const leftRecommended = recommendedRank.get(left.id);
      const rightRecommended = recommendedRank.get(right.id);
      if (leftRecommended !== undefined || rightRecommended !== undefined) {
        if (leftRecommended === undefined) return 1;
        if (rightRecommended === undefined) return -1;
        return leftRecommended - rightRecommended;
      }
    }

    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}
