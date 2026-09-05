/**
 * Common Types for Cloudflare Translation Microservice
 */

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface OpenAIChatChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'length' | string;
}

export interface OpenAIChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage: OpenAIChatUsage;
}

export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
    param?: string;
  };
}

export interface UserQuotaRecord {
  windowStart: number;
  usedCount: number;
}

export interface ProviderCircuitState {
  state: 'CLOSED' | 'OPEN' | 'HALF-OPEN';
  cooldownUntil: number;
  consecutiveFailures: number;
  emaLatencyMs: number;
  // Layer 1 Proactive sliding window counters (in-memory)
  currentSecondWindow: number;
  secondCount: number;
  currentMinuteWindow: number;
  minuteCount: number;
  currentDayWindow: string;
  dayCount: number;
}

export interface Env {
  SHARED_POOL: DurableObjectNamespace;
  AI?: any; // Cloudflare Workers AI binding
  GOOGLE_CLIENT_ID?: string;
  JWT_SALT?: string;
  NVIDIA_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  [key: string]: any;
}
