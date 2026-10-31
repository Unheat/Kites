/**
 * Cloudflare Worker Gateway Entrypoint
 *
 * Responsibilities:
 * 1. Export Durable Object class bindings (SharedPoolDO) for Cloudflare Workers runtime.
 * 2. Delegate all incoming HTTP requests to decomposed worker/src/http/ router.
 */

import { Env } from './types';
import { handleHttpRequest } from './http/router';

export { SharedPoolDO } from './durable/SharedPoolDO';

export default {
  /**
   * Cloudflare Worker fetch entrypoint.
   *
   * @param request - Incoming HTTP Request from the Cloudflare edge.
   * @param env - Worker environment bindings and secrets.
   * @param ctx - Execution context.
   * @returns HTTP Response.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await handleHttpRequest(request, env, ctx);
  },
};
