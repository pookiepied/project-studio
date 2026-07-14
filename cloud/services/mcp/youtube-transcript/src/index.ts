/// <reference types="@cloudflare/workers-types" />

export { YouTubeTranscriptAgent } from "./agent";

import { YouTubeTranscriptAgent } from "./agent";
import { Env } from "./env";
import { validateAuth } from "./middleware/auth";

const mcpFetch = YouTubeTranscriptAgent.serve("/mcp");

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const authError = validateAuth(request, env);
    if (authError) return authError;

    return mcpFetch.fetch(request, env, ctx);
  },
};
