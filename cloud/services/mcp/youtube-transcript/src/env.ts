/// <reference types="@cloudflare/workers-types" />

export interface Env {
  MCP_OBJECT: DurableObjectNamespace;

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  // Bearer token clients must present in Authorization: Bearer <key>.
  // Leave unset to disable auth (development / self-trusted deployments only).
  // For Project Studio: store the same value as config.authToken in D1.
  MCP_API_KEY?: string;

  // ---------------------------------------------------------------------------
  // STT — Layer 3 audio transcription
  //
  // Standalone mode (open-source / self-hosted):
  //   Set STT_PROVIDER_URL + STT_PROVIDER_API_KEY.
  //   Any OpenAI-compatible speech-to-text endpoint works.
  //   Examples:
  //     Groq    — https://api.groq.com/openai/v1
  //     OpenAI  — https://api.openai.com/v1
  //     Local   — http://localhost:8080/v1
  //
  // Bound mode (Project Studio):
  //   Set STT_PROVIDER_NAME to a provider that is active in the AI worker's
  //   ENABLED_PROVIDERS (e.g. "groq", "openrouter").
  //   Uncomment the AI [[services]] block in wrangler.toml.
  //   The MCP worker routes audio through the AI worker, which uses its own
  //   API key. No STT credentials needed here.
  // ---------------------------------------------------------------------------
  STT_PROVIDER_URL?: string;
  STT_PROVIDER_API_KEY?: string;

  STT_PROVIDER_NAME?: string;
  AI?: Fetcher;

  // Model name passed to the STT provider (default: whisper-large-v3-turbo).
  STT_MODEL?: string;

  // ---------------------------------------------------------------------------
  // Tracker
  // ---------------------------------------------------------------------------
  TRACKER?: Fetcher;

  ENVIRONMENT?: string;
}
