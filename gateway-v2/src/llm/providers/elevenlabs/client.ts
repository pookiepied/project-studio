import { createElevenLabs } from "@ai-sdk/elevenlabs";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

// Unlike the other providers, @ai-sdk/elevenlabs exposes NO baseURL setting — it hardcodes
// https://api.elevenlabs.io. To still route through Cloudflare AI Gateway (BYOK + analytics),
// we hand the SDK a fetch that rewrites the ElevenLabs origin onto the CF gateway base URL,
// then delegates to the transport fetch (which injects cf-aig-* headers via the client
// `headers` option and strips the provider `xi-api-key`).
const ELEVENLABS_ORIGIN = /^https:\/\/api\.elevenlabs\.io/i;

export function createElevenLabsClient(context: HandlerContext) {
  const transport = getTransport("elevenlabs", context.env);

  const rewritingFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (input instanceof Request) {
      const rewritten = input.url.replace(ELEVENLABS_ORIGIN, transport.baseURL);
      return transport.fetch(new Request(rewritten, input), init);
    }
    const url = typeof input === "string" ? input : input.href;
    return transport.fetch(url.replace(ELEVENLABS_ORIGIN, transport.baseURL), init);
  }) as typeof fetch;

  return createElevenLabs({
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: rewritingFetch
  });
}
