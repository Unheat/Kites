/**
 * Declarative Provider Route Configuration and Canonical Capability Catalog
 *
 * Single Source of Truth for provider routes, quality tiers, and output mode capabilities.
 * All quota limits (RPM, RPS, RPD) are historical unverified configured guards, not confirmed account quotas.
 */

/** Canonical catalog of supported model output capabilities */
export const OUTPUT_MODES = [
  { id: 'prompt-only', description: 'Prompt-guided completion without JSON schema enforcement' },
  { id: 'json-object', description: 'Enforces generic valid JSON object output ({ type: "json_object" })' },
  { id: 'json-schema', description: 'Enforces strict constrained JSON schema grammar' },
] as const;

export type OutputModeCapability = (typeof OUTPUT_MODES)[number]['id'];

/** Canonical verification evidence states */
export const VERIFICATION_EVIDENCE_STATES = [
  { id: 'probed', description: 'Live request verified in current environment' },
  { id: 'documented', description: 'Documented in official provider specifications but unverified live' },
  { id: 'unknown', description: 'Verification state unconfirmed or absent from official documentation' },
] as const;

export type VerificationEvidenceState = (typeof VERIFICATION_EVIDENCE_STATES)[number]['id'];

/** Canonical quality tiers */
export const QUALITY_TIERS = [
  { id: 'high', rank: 1, description: 'Large multi-billion parameter flagships' },
  { id: 'medium', rank: 2, description: 'Efficient mid-sized models' },
  { id: 'emergency', rank: 3, description: 'Minimal parameter emergency fallback' },
] as const;

export type QualityTier = (typeof QUALITY_TIERS)[number]['id'];

export interface ProviderRouteConfig {
  /** Unique ID for health tracking and internal metrics */
  id: string;
  /** Human-readable label */
  name: string;
  /** Toggle route eligibility */
  enabled: boolean;
  /** Waterfall precedence: 1 is top primary, 2 is secondary, etc. */
  priority: number;
  /** Model quality tier for routing selection */
  qualityTier: QualityTier;
  /** Adapter protocol */
  type: 'openai-compatible' | 'workers-ai' | 'gemini';
  /** Base URL (omitted for native workers-ai) */
  baseUrl?: string;
  /** Upstream model name */
  modelName: string;
  /** Environment variable name storing secret API key (omitted for workers-ai) */
  apiKeyEnvVar?: string;
  /** Custom headers required by specific providers (e.g. OpenRouter HTTP-Referer) */
  customHeaders?: Record<string, string>;
  /** Requests per second guard (unverified configured guard) */
  rpsLimit?: number;
  /** Requests per minute guard (unverified configured guard) */
  rpmLimit?: number;
  /** Requests per day guard (unverified configured guard) */
  rpdLimit?: number;
  /** Maximum concurrent in-flight requests permitted for this route */
  maxInflight?: number;
  /** Baseline timeout in milliseconds */
  defaultTimeoutMs?: number;
  /** Structured output mode capability supported by this provider */
  outputCapability: OutputModeCapability;
  /** Verification status of model capability and endpoint */
  verificationEvidence: VerificationEvidenceState;
  /** Whether upstream supports reasoning parameters (e.g. reasoning_effort) */
  supportsReasoningEffort?: boolean;
}

export const PROVIDER_ROUTES: ProviderRouteConfig[] = [
  // 1. Groq GPT OSS 120B (Primary baseline flagship, 30 RPM, 1,000 RPD guard)
  // Strict JSON schema is officially documented by Groq; live probe unverified.
  {
    id: 'groq-gpt-oss-120b',
    name: 'Groq GPT OSS 120B',
    enabled: true,
    priority: 1,
    qualityTier: 'high',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelName: 'openai/gpt-oss-120b',
    apiKeyEnvVar: 'GROQ_API_KEY',
    rpmLimit: 30,
    rpdLimit: 1000,
    maxInflight: 3,
    defaultTimeoutMs: 3500,
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
  },

  // 2. Groq Qwen 3.8 27B (Secondary baseline, 30 RPM, 1,000 RPD guard)
  {
    id: 'groq-qwen-3.8',
    name: 'Groq Qwen 3.8 27B',
    enabled: true,
    priority: 2,
    qualityTier: 'medium',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelName: 'qwen/qwen3.8-27b',
    apiKeyEnvVar: 'GROQ_API_KEY',
    rpmLimit: 30,
    rpdLimit: 1000,
    maxInflight: 3,
    defaultTimeoutMs: 3000,
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
  },

  // 3. Groq GPT OSS 20B (Tertiary baseline, 30 RPM, 1,000 RPD guard)
  {
    id: 'groq-gpt-oss-20b',
    name: 'Groq GPT OSS 20B',
    enabled: true,
    priority: 3,
    qualityTier: 'medium',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelName: 'openai/gpt-oss-20b',
    apiKeyEnvVar: 'GROQ_API_KEY',
    rpmLimit: 30,
    rpdLimit: 1000,
    maxInflight: 3,
    defaultTimeoutMs: 3000,
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
  },

  // 4. Groq Qwen 3.6 27B (Verified in Groq official model card; generic json-object mode)
  {
    id: 'groq-qwen-3.6',
    name: 'Groq Qwen 3.6 27B',
    enabled: true,
    priority: 4,
    qualityTier: 'medium',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelName: 'qwen/qwen3.6-27b',
    apiKeyEnvVar: 'GROQ_API_KEY',
    rpmLimit: 30,
    rpdLimit: 1000,
    maxInflight: 3,
    defaultTimeoutMs: 3500,
    outputCapability: 'json-object',
    verificationEvidence: 'documented',
  },

  // 5. Google AI Studio Gemma 4 26B (14.4k RPD guard, 30 RPM guard, Structured JSON Schema)
  {
    id: 'gemma-4-26b',
    name: 'Google Gemma 4 26B',
    enabled: true,
    priority: 5,
    qualityTier: 'high',
    type: 'gemini',
    modelName: 'gemma-4-26b-a4b-it',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    rpmLimit: 30,
    rpdLimit: 14400,
    maxInflight: 4,
    defaultTimeoutMs: 4000,
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
  },

  // 6. Google AI Studio Gemma 4 31B (14.4k RPD guard, 30 RPM guard, Structured JSON Schema)
  {
    id: 'gemma-4-31b',
    name: 'Google Gemma 4 31B',
    enabled: true,
    priority: 6,
    qualityTier: 'high',
    type: 'gemini',
    modelName: 'gemma-4-31b-it',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    rpmLimit: 30,
    rpdLimit: 14400,
    maxInflight: 4,
    defaultTimeoutMs: 4000,
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
  },

  // 7. OpenRouter Free Tier (20 RPM guard, 1,000 RPD guard, JSON Object feature-routed)
  {
    id: 'openrouter-free',
    name: 'OpenRouter Free Model',
    enabled: true,
    priority: 7,
    qualityTier: 'medium',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelName: 'openrouter/free',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    customHeaders: {
      'HTTP-Referer': 'https://kites.ai',
      'X-Title': 'Kites Manga Translator',
    },
    rpmLimit: 20,
    rpdLimit: 1000,
    maxInflight: 2,
    defaultTimeoutMs: 4500,
    outputCapability: 'json-object',
    verificationEvidence: 'documented',
  },

  // 8. Mistral AI (Enabled with json-object mode; live probe unverified)
  {
    id: 'mistral-3b',
    name: 'Mistral Ministral 3B',
    enabled: true,
    priority: 8,
    qualityTier: 'medium',
    type: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    modelName: 'ministral-3b-2512',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    rpsLimit: 10,
    maxInflight: 2,
    defaultTimeoutMs: 3500,
    outputCapability: 'json-object',
    verificationEvidence: 'documented',
  },

  // 9. Cloudflare Native Workers AI (Emergency last fallback, lowest token cost against 10k daily neurons guard)
  {
    id: 'cf-llama-3.2-1b',
    name: 'Cloudflare Workers AI Llama 3.2 1B',
    enabled: true,
    priority: 9,
    qualityTier: 'emergency',
    type: 'workers-ai',
    modelName: '@cf/meta/llama-3.2-1b-instruct',
    rpdLimit: 4500,
    maxInflight: 2,
    defaultTimeoutMs: 3000,
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
  },
];
