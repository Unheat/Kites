/**
 * Declarative Provider Route Configuration
 * 
 * Verified against live endpoints:
 * 1. Cloudflare Workers AI (@cf/meta/llama-3.2-1b-instruct)
 * 2. Mistral AI (ministral-3b-2512)
 * 3. Google AI Studio Gemma 4 26B (gemma-4-26b-a4b-it)
 * 4. Google AI Studio Gemma 4 31B (gemma-4-31b-it)
 * 5. Groq Qwen 3.8 27B (qwen/qwen3.8-27b)
 * 6. Groq GPT OSS 120B (openai/gpt-oss-120b)
 * 7. Groq GPT OSS 20B (openai/gpt-oss-20b)
 * 8. Groq Qwen 3.6 27B (qwen/qwen3.6-27b)
 * 9. OpenRouter Free (openrouter/free)
 */

export interface ProviderRouteConfig {
  /** Unique ID for health tracking and internal metrics */
  id: string;
  /** Human-readable label */
  name: string;
  /** Toggle route eligibility */
  enabled: boolean;
  /** Waterfall precedence: 1 is top primary, 2 is secondary, etc. */
  priority: number;
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
  /** Requests per second limit (e.g. Mistral 10 RPS) */
  rpsLimit?: number;
  /** Requests per minute limit (triggers 60s cooldown on 429) */
  rpmLimit?: number;
  /** Requests per day limit (triggers daily cooldown on 429) */
  rpdLimit?: number;
  /** Baseline timeout in milliseconds */
  defaultTimeoutMs?: number;
}

export const PROVIDER_ROUTES: ProviderRouteConfig[] = [
  // 1. Mistral AI (Fast, high throughput, $10 free monthly credit)
  {
    id: 'mistral-3b',
    name: 'Mistral Ministral 3B',
    enabled: true,
    priority: 1,
    type: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    modelName: 'ministral-3b-2512',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    rpsLimit: 10,
    defaultTimeoutMs: 3500,
  },
    // 2. Cloudflare Native Workers AI (Lowest token cost against 10k daily neurons)
  {
    id: 'cf-llama-3.2-1b',
    name: 'Cloudflare Workers AI Llama 3.2 1B',
    enabled: true,
    priority: 9,
    type: 'workers-ai',
    modelName: '@cf/meta/llama-3.2-1b-instruct',
    rpdLimit: 4500,
    defaultTimeoutMs: 3000,
  },

  // 3. Google AI Studio Gemma 4 26B (14.4k RPD, 30 RPM)
  {
    id: 'gemma-4-26b',
    name: 'Google Gemma 4 26B',
    enabled: true,
    priority: 2,
    type: 'gemini',
    modelName: 'gemma-4-26b-a4b-it',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    rpmLimit: 30,
    rpdLimit: 14400,
    defaultTimeoutMs: 4000,
  },

  // 4. Google AI Studio Gemma 4 31B (14.4k RPD, 30 RPM)
  {
    id: 'gemma-4-31b',
    name: 'Google Gemma 4 31B',
    enabled: true,
    priority: 3,
    type: 'gemini',
    modelName: 'gemma-4-31b-it',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    rpmLimit: 30,
    rpdLimit: 14400,
    defaultTimeoutMs: 4000,
  },

  // 5. Groq Qwen 3.8 27B (30 RPM, 1,000 RPD)
  {
    id: 'groq-qwen-3.8',
    name: 'Groq Qwen 3.8 27B',
    enabled: true,
    priority: 4,
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelName: 'qwen/qwen3.8-27b',
    apiKeyEnvVar: 'GROQ_API_KEY',
    rpmLimit: 30,
    rpdLimit: 1000,
    defaultTimeoutMs: 3000,
  },

  // 6. Groq GPT OSS 120B (30 RPM, 1,000 RPD)
  {
    id: 'groq-gpt-oss-120b',
    name: 'Groq GPT OSS 120B',
    enabled: true,
    priority: 5,
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelName: 'openai/gpt-oss-120b',
    apiKeyEnvVar: 'GROQ_API_KEY',
    rpmLimit: 30,
    rpdLimit: 1000,
    defaultTimeoutMs: 3500,
  },

  // 7. Groq GPT OSS 20B (30 RPM, 1,000 RPD)
  {
    id: 'groq-gpt-oss-20b',
    name: 'Groq GPT OSS 20B',
    enabled: true,
    priority: 6,
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelName: 'openai/gpt-oss-20b',
    apiKeyEnvVar: 'GROQ_API_KEY',
    rpmLimit: 30,
    rpdLimit: 1000,
    defaultTimeoutMs: 3000,
  },

  // 8. Groq Qwen 3.6 27B (30 RPM, 1,000 RPD)
  {
    id: 'groq-qwen-3.6',
    name: 'Groq Qwen 3.6 27B',
    enabled: true,
    priority: 7,
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelName: 'qwen/qwen3.6-27b',
    apiKeyEnvVar: 'GROQ_API_KEY',
    rpmLimit: 30,
    rpdLimit: 1000,
    defaultTimeoutMs: 3500,
  },

  // 9. OpenRouter Free Tier (20 RPM, 1,000 RPD)
  {
    id: 'openrouter-free',
    name: 'OpenRouter Free Model',
    enabled: true,
    priority: 8,
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
    defaultTimeoutMs: 4500,
  },
];
