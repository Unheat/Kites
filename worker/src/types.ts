/**
 * Common Types for Cloudflare Translation Microservice
 */

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ResponseFormatJsonSchema {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

export interface ResponseFormatJsonObject {
  type: 'json_object';
}

export type ResponseFormat = ResponseFormatJsonSchema | ResponseFormatJsonObject;

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: ResponseFormat;
  reasoning_effort?: 'low' | 'medium' | 'high';
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
  attemptCount: number;
}

export interface ProviderCircuitState {
  state: 'CLOSED' | 'OPEN' | 'HALF-OPEN';
  cooldownUntil: number;
  consecutiveFailures: number;
  generation: number;
  halfOpenInFlight: boolean;
  inFlightCount: number;
  currentSecondWindow: number;
  secondCount: number;
  currentMinuteWindow: number;
  minuteCount: number;
  currentDayWindow: string;
  dayCount: number;
}

export interface RouteLatencyStats {
  emaLatencyMs: number;
  latencyVariance: number;
  emaMsPerToken: number;
  sampleCount: number;
  lastSampleAt: number;
  consecutiveTimeouts: number;
}

export interface TranslationQuotaInfo {
  remaining: number;
  limit: number;
  resetsAt: number;
}

export interface ProviderAttemptLog {
  routeId: string;
  model: string;
  statusCode?: number;
  latencyMs?: number;
  errorType?: string;
}

export interface ProviderMetadata {
  routeId?: string;
  model?: string;
  actualModel?: string;
  attempts?: ProviderAttemptLog[];
  totalAttempts?: number;
}

export interface TranslationResult {
  status: number;
  body: OpenAIChatResponse | OpenAIErrorResponse | Record<string, unknown>;
  quota?: TranslationQuotaInfo;
  providerMetadata?: ProviderMetadata;
}

export interface Env {
  SHARED_POOL: DurableObjectNamespace;
  AI?: any; // Cloudflare Workers AI binding
  GOOGLE_CLIENT_ID?: string;
  /**
   * Optional Chrome Extension OAuth client ID. Tokens minted by silent
   * `chrome.identity.getAuthToken` refreshes carry this client as their
   * audience, so accepting it here keeps long sessions authenticated.
   */
  GOOGLE_EXTENSION_CLIENT_ID?: string;
  JWT_SALT?: string;
  NVIDIA_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  /** Enables GET /internal/provider-health. Unset means the route answers 404. */
  PROVIDER_HEALTH_TOKEN?: string;
  [key: string]: any;
}
