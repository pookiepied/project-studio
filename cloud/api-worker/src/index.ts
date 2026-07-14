/// <reference types="@cloudflare/workers-types" />

import { createApiApp } from './server/app';
import type { Env } from './server/types';
import { maybeForwardStudioWebSocket } from './proxy/websocket';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const wsResponse = await maybeForwardStudioWebSocket(request, env);
    if (wsResponse) return wsResponse;

    return createApiApp().fetch(request, env, ctx);
  },
};
