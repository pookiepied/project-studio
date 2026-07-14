import type { GatewayEnv } from "../env";
import { verifyBearerToken } from "../middleware/auth";
import { parseModelId } from "../utils/modelParser";
import { createErrorResponse } from "../middleware/response";
import { logger } from "../logger";
import { recordUsage, emit } from "../tracking";
import {
  handleGoogleTTS,
  handleOpenAICompatibleTTS,
  handleGroqTTS,
  handleAlibabaTTS,
  handleMiniMaxTTS,
  handleAzureTTS,
  openRouterHeaders,
} from "../tts/providers";

const DEFAULT_TTS_MODEL = "google:gemini-2.5-flash-preview-tts";

const SUPPORTED_TTS_PROVIDERS = ["google", "openai", "openrouter", "alibaba", "groq", "minimax", "azure"] as const;
type TTSProvider = (typeof SUPPORTED_TTS_PROVIDERS)[number];

/**
 * POST /audio/speech
 *
 * OpenAI-compatible TTS endpoint. Supports multiple providers:
 *   - google      : gemini-*-tts models
 *   - openai      : tts-1, tts-1-hd, gpt-4o-mini-tts
 *   - openrouter  : any OR model with audio output
 *   - alibaba     : qwen3-tts-* models
 *   - groq        : orpheus TTS models
 *   - minimax     : speech-01-* models or slots
 */
export async function handleTTS(request: Request, env: GatewayEnv, ctx?: ExecutionContext): Promise<Response> {
  const requestStart = Date.now();
  const userId = request.headers.get("x-user-id") ?? undefined;

  if (env.JWT_SECRET) {
    const jwtPayload = await verifyBearerToken(request, env.JWT_SECRET, env.REVOKED_KV);
    if (!jwtPayload) return createErrorResponse("Unauthorized", 401, "unauthorized_error");
  }

  let body: { model?: string; input?: string; voice?: string };
  try {
    body = await request.json();
  } catch {
    return createErrorResponse("Invalid JSON body", 400, "invalid_request_error");
  }

  const { model = DEFAULT_TTS_MODEL, input, voice = "Kore" } = body;
  if (!input?.trim()) {
    return createErrorResponse("'input' is required and must not be empty", 400, "invalid_request_error");
  }

  let provider: string;
  let modelId: string;
  try {
    const parsed = parseModelId(model);
    provider = parsed.provider;
    modelId  = parsed.modelId;
  } catch {
    return createErrorResponse(
      "Invalid model format. Use 'provider:model' (e.g. 'google:gemini-2.5-flash-preview-tts')",
      400,
      "invalid_request_error"
    );
  }

  if (!SUPPORTED_TTS_PROVIDERS.includes(provider as TTSProvider)) {
    return createErrorResponse(
      `TTS provider '${provider}' is not supported. Supported: ${SUPPORTED_TTS_PROVIDERS.join(", ")}.`,
      400,
      "invalid_request_error"
    );
  }

  const text = input.trim().slice(0, 8000);
  logger.info("TTS request", { provider, modelId, voice, textLength: text.length });

  let ttsStatus: "success" | "error" = "success";
  let response: Response;
  try {
    switch (provider as TTSProvider) {
      case "google":
        response = await handleGoogleTTS(request, env, modelId, text, voice);
        break;
      case "openai":
        response = await handleOpenAICompatibleTTS(request, env.OPENAI_API_KEY, "https://api.openai.com/v1", modelId, text, voice);
        break;
      case "openrouter":
        response = await handleOpenAICompatibleTTS(request, env.OPENROUTER_API_KEY, "https://openrouter.ai/api/v1", modelId, text, voice, openRouterHeaders(env));
        break;
      case "groq":
        response = await handleGroqTTS(request, env, modelId, text, voice);
        break;
      case "alibaba":
        response = await handleAlibabaTTS(request, env, modelId, text, voice);
        break;
      case "minimax":
        response = await handleMiniMaxTTS(request, env, modelId, text, voice);
        break;
      case "azure":
        response = await handleAzureTTS(request, env, modelId, text, voice);
        break;
      default:
        response = createErrorResponse(`Unhandled provider: ${provider}`, 500, "internal_error");
    }
    if (!response.ok) ttsStatus = "error";
  } catch (err) {
    ttsStatus = "error";
    throw err;
  } finally {
    recordUsage({ env, ctx, userId, provider, model, capturedUsage: null, requestStart, requestType: "tts", status: ttsStatus });
    if (ttsStatus === "error") {
      emit(env, ctx, {
        event:    "provider.error",
        severity: "error",
        data:     { provider, model, requestType: "tts", latencyMs: Date.now() - requestStart },
      });
    }
  }
  return response;
}
