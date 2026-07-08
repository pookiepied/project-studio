// Family rules for xAI (Grok) models. Grok models are OpenAI-wire-compatible chat
// models. New Grok models that match a naming pattern inherit these capabilities at
// "family" confidence (see ./reasoning.ts) until an exact review is added.
//
// Capabilities are gated PER MODEL here (never blanket for the provider): a code model
// must not advertise vision, and reasoning is only declared for reasoning-capable Grok
// variants. Capabilities below were verified against the live xAI docs as of 2026-07-05:
//   - Vision (image input): https://docs.x.ai/docs/models — supported image inputs are
//     jpg/png up to 20MiB. grok-3 and grok-4.x multimodal chat models accept images;
//     grok-3-mini (text+reasoning), code models and grok-build are conservatively NOT
//     declared vision-capable until a live doc confirms otherwise.
//   - Tools / function calling: supported across the Grok chat lineup.
//   - Reasoning: see ./reasoning.ts (reasoning-capable variants only).

// A Grok chat/text model is anything that carries the "grok-" prefix. Code/build/voice/
// imagine variants are also model-id-prefixed by xAI, so the capability checks below gate
// them out of the sub-features they do not actually support.
export function isXaiChatModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!id.startsWith("grok-")) return false;
  // Grok Imagine (image/video gen), Grok Voice (realtime), and Grok Build (Code API)
  // models are NOT the normalized chat path — exclude them from the chat catalog.
  if (id.includes("imagine")) return false;
  if (id.includes("voice")) return false;
  if (id.includes("build")) return false;
  return true;
}

// Vision (image input) is available on grok-3 (non-mini) and the grok-4.x multimodal chat
// models (confirmed via the xAI Responses vision example using grok-3 + the models page's
// "Image input models" section). grok-3-mini is conservatively text-only (vision
// unverified); the legacy "-vision" suffixed models are vision-capable; code/build/fast
// code models are text-only.
export function supportsXaiVision(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!isXaiChatModel(id)) return false;
  if (id.includes("grok-3-mini")) return false;
  if (id.includes("grok-4")) return true;
  if (id.includes("grok-3")) return true;
  if (id.includes("vision")) return true; // legacy grok-2-vision / grok-vision-beta
  return false;
}

// Tool / function calling is supported across the Grok chat lineup. Non-chat models never
// reach here. Per xAI's function-calling docs.
export function supportsXaiTools(modelId: string): boolean {
  return isXaiChatModel(modelId);
}

// xAI supports structured outputs (`response_format: json_schema`) on its chat models
// (xAI docs → Build → Structured outputs). Enforced in ../chat.ts via the AI SDK's
// structured-output mechanism, the same as OpenAI/Groq.
export function supportsXaiJsonSchema(modelId: string): boolean {
  return isXaiChatModel(modelId);
}

// xAI performs automatic prompt caching server-side but exposes NO cache_control breakpoint
// API the way OpenAI/Anthropic do, so the gateway declares prompt caching unsupported
// (same stance as Groq).
export function supportsXaiPromptCaching(_modelId: string): boolean {
  return false;
}

// Context windows. The current Grok 4.x lineup (grok-4.3 / grok-4.20-*) ships a 1M-token
// context window (xAI models page). Legacy grok-3 / grok-3-mini are conservatively 131_072.
export function contextWindowForXaiModel(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("grok-4")) return 1_000_000;
  if (id.includes("grok-3")) return 131_072;
  if (id.includes("grok-2")) return 131_072;
  return 131_072;
}

// Conservative max-output defaults. Grok reasoning models emit long reasoning + answer
// streams; 65_536 is a safe declared ceiling. Non-reasoning chat models use 32_768.
export function maxOutputForXaiModel(modelId: string): number {
  return supportsXaiReasoningVariant(modelId) ? 65_536 : 32_768;
}

// Reasoning-capable Grok models are: the explicit "reasoning" variants, grok-4.3 (a
// reasoning model), grok-4.20-multi-agent (reasoning controls agent count), and
// grok-3-mini (the mini reasoning model). "non-reasoning" variants and code models are
// NOT reasoning models. Mirrors the gating note in ./reasoning.ts.
export function supportsXaiReasoningVariant(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!isXaiChatModel(id)) return false;
  if (id.includes("non-reasoning")) return false;
  if (id.includes("-reasoning")) return true;
  if (id.includes("multi-agent")) return true;
  if (id === "grok-4.3" || id.startsWith("grok-4.3-")) return true;
  if (id.includes("grok-3-mini")) return true;
  return false;
}
