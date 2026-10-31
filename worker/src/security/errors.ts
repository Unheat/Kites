/**
 * Security & HTTP Error Hierarchy
 *
 * Provides strongly typed HTTP errors for request boundaries.
 * Guarantees error sanitization so internal exceptions, SQL details, and OCR payloads
 * are never exposed to clients or logged unsafely.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errorType: string;

  constructor(message: string, status: number, code: string, errorType = 'invalid_request_error') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.errorType = errorType;
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message: string, code = 'payload_too_large') {
    super(message, 413, code, 'invalid_request_error');
    this.name = 'PayloadTooLargeError';
  }
}

export class InvalidJsonError extends HttpError {
  constructor(message = 'Invalid JSON request body') {
    super(message, 400, 'invalid_json', 'invalid_request_error');
    this.name = 'InvalidJsonError';
  }
}

export class InvalidRequestError extends HttpError {
  constructor(message: string, code = 'invalid_request_error') {
    super(message, 400, code, 'invalid_request_error');
    this.name = 'InvalidRequestError';
  }
}

export class AuthenticationError extends HttpError {
  constructor(message = 'Authentication failed: Invalid or expired token', code = 'invalid_token') {
    super(message, 401, code, 'authentication_error');
    this.name = 'AuthenticationError';
  }
}

/**
 * Genuine authentication failure caused by client credentials (bad signature,
 * expired token, wrong audience, tokeninfo 400/401).
 * Triggers bad-actor jail counting and cached negative rejection.
 */
export class AuthInvalidTokenError extends AuthenticationError {
  constructor(message = 'Authentication failed: Invalid or expired token', code = 'invalid_token') {
    super(message, code);
    this.name = 'AuthInvalidTokenError';
  }
}

/**
 * Transient authentication infrastructure failure (upstream network failure,
 * Google JWKS/tokeninfo timeout, Google HTTP 5xx/429).
 * MUST NOT trigger bad-actor jail counting or negative token caching.
 */
export class AuthTransientError extends HttpError {
  constructor(message = 'Authentication service temporarily unavailable') {
    super(message, 503, 'auth_service_unavailable', 'api_error');
    this.name = 'AuthTransientError';
  }
}

export class RateLimitError extends HttpError {
  readonly retryAfterSeconds?: number;

  constructor(message: string, status = 429, code = 'rate_limit_exceeded', retryAfterSeconds?: number) {
    super(message, status, code, status === 403 ? 'access_denied' : 'rate_limit_error');
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ServerConfigurationError extends HttpError {
  constructor(message = 'Server configuration error') {
    super(message, 500, 'server_misconfigured', 'api_error');
    this.name = 'ServerConfigurationError';
  }
}

export class InternalPoolError extends HttpError {
  constructor(message = 'Internal pool error') {
    super(message, 500, 'internal_error', 'api_error');
    this.name = 'InternalPoolError';
  }
}

/**
 * Sanitize an error for client responses.
 *
 * @param err - Unknown caught error.
 * @returns Clean, safe error response object matching OpenAI error schema.
 */
export function sanitizeClientError(err: unknown): {
  status: number;
  body: { error: { message: string; type: string; code: string } };
  retryAfterSeconds?: number;
} {
  if (err instanceof RateLimitError) {
    return {
      status: err.status,
      body: {
        error: {
          message: err.message,
          type: err.errorType,
          code: err.code,
        },
      },
      retryAfterSeconds: err.retryAfterSeconds,
    };
  }

  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: {
        error: {
          message: err.message,
          type: err.errorType,
          code: err.code,
        },
      },
    };
  }

  // Generic fallback: never expose raw stack traces or internal exception messages
  return {
    status: 500,
    body: {
      error: {
        message: 'Internal server error occurred',
        type: 'api_error',
        code: 'internal_error',
      },
    },
  };
}
