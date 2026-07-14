import { GatewayEnv } from "../env";
import { getModelSyncService } from "../services/modelSync";
import { addCORSHeaders } from "../middleware/cors";
import { createErrorResponse } from "../middleware/response";
import { logger } from "../logger";

const modelSyncService = getModelSyncService();

export async function handleModels(request: Request, env: GatewayEnv): Promise<Response> {
  try {
    const url = new URL(request.url);
    const shouldSync = url.searchParams.get("sync") === "true";

    let models = await modelSyncService.getCachedModels(env);

    // Self-healing: if we have a custom voice configured but it's not in the cache or name doesn't match, force a sync
    const customVoiceId = env.MINIMAX_CUSTOM_VOICE_ID;
    const customVoiceName = env.MINIMAX_CUSTOM_VOICE_NAME;
    const cachedVoice = models?.models.find(m => m.id.includes(customVoiceId || "never-match-this-if-null"));

    const needsSync = !models || shouldSync ||
                     (customVoiceId && !cachedVoice) ||
                     (customVoiceName && cachedVoice && !cachedVoice.name.includes(customVoiceName));

    if (needsSync) {
      let reason = "Cache empty";
      if (shouldSync) reason = "Forced sync requested";
      else if (customVoiceId && !cachedVoice) reason = "Custom voice missing from cache";
      else if (customVoiceName && cachedVoice && !cachedVoice.name.includes(customVoiceName)) reason = `Custom voice name mismatch (Expected: ${customVoiceName})`;

      logger.info(`${reason} — running fresh model discovery`);
      models = await modelSyncService.syncModels(env);
    }

    const response = new Response(JSON.stringify(models), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });

    return addCORSHeaders(response, request);
  } catch (error) {
    logger.error("Failed to get models:", error);
    return createErrorResponse("Failed to fetch models", 500, "internal_error");
  }
}
