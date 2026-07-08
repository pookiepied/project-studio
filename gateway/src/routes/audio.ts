import { GatewayEnv } from "../env";
import { TranscribeRequest } from "../types";
import { AudioExecutor } from "../execution/direct/audio";
import { getModelSyncService } from "../services/modelSync";
import { createErrorResponse } from "../middleware/response";
import { addCORSHeaders } from "../middleware/cors";
import { logger } from "../logger";
import { FILE_LIMITS, SUPPORTED_AUDIO_TYPES } from "../config/constants";
import { parseModelId } from "../utils/modelParser";
import { recordUsage, emit } from "../tracking";

const modelSyncService = getModelSyncService();

export async function handleTranscription(request: Request, env: GatewayEnv, ctx?: ExecutionContext): Promise<Response> {
  const requestStart = Date.now();
  const userId = request.headers.get("x-user-id") ?? undefined;
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const model = formData.get("model") as string | null;
    const language = formData.get("language") as string | null;
    const temperature = formData.get("temperature") as string | null;

    if (!file) {
      return createErrorResponse(
        "Missing required field: 'file'",
        400,
        "invalid_request_error"
      );
    }

    if (!model) {
      return createErrorResponse(
        "Missing required field: 'model'",
        400,
        "invalid_request_error"
      );
    }

    if (file.size > FILE_LIMITS.MAX_AUDIO_FILE_SIZE) {
      return createErrorResponse(
        `File size exceeds maximum of 25MB. Received: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
        400,
        "invalid_request_error"
      );
    }

    if (!SUPPORTED_AUDIO_TYPES.includes(file.type as any)) {
      return createErrorResponse(
        `Invalid file type: ${file.type}. Supported types: ${SUPPORTED_AUDIO_TYPES.join(", ")}`,
        400,
        "invalid_request_error"
      );
    }

    let providerName: string;
    let modelId: string;

    try {
      const parsed = parseModelId(model);
      providerName = parsed.provider;
      modelId = parsed.modelId;
    } catch (error) {
      return createErrorResponse(
        "Invalid model format. Use 'provider:model' (e.g., 'groq:whisper-large-v3-turbo')",
        400,
        "invalid_request_error"
      );
    }

    const modelsData = await modelSyncService.getCachedModels(env);

    if (!modelsData) {
      return createErrorResponse(
        "Models not available. Please try again in a moment.",
        503,
        "service_unavailable"
      );
    }

    const contract = modelsData.providers[providerName];

    if (!contract) {
      const available = Object.keys(modelsData.providers).join(", ");
      return createErrorResponse(
        `Provider '${providerName}' not found. Available providers: ${available}`,
        400,
        "invalid_request_error"
      );
    }

    if (contract.status !== "active") {
      return createErrorResponse(
        `Provider '${providerName}' is not active: ${contract.errorMessage}`,
        503,
        "provider_unavailable"
      );
    }

    const modelData = modelsData.models.find(
      m => (m.id === model || m.id === `${providerName}:${modelId}`) && m.type === "audio"
    );

    if (!modelData) {
      const audioModels = modelsData.models.filter(m => m.type === "audio");
      const validModels = audioModels.map(m => m.id).join(", ");
      return createErrorResponse(
        `Invalid audio model: '${model}'. Valid audio models: ${validModels}`,
        400,
        "invalid_request_error"
      );
    }

    if (temperature !== null) {
      const tempValue = parseFloat(temperature);
      if (isNaN(tempValue) || tempValue < 0 || tempValue > 1) {
        return createErrorResponse(
          "Temperature must be a number between 0 and 1",
          400,
          "invalid_request_error"
        );
      }
    }

    const executor = new AudioExecutor(env);

    const transcribeRequest: TranscribeRequest = {
      file,
      model,
      language: language ?? undefined,
      temperature: temperature ? parseFloat(temperature) : undefined,
      response_format: "json"
    };

    logger.info("Transcription request", {
      model,
      fileSize: file.size,
      fileType: file.type,
    });

    const response = await executor.transcribe(transcribeRequest);

    logger.info("Transcription response", {
      model,
      textLength: response.text.length,
    });

    recordUsage({
      env,
      ctx,
      userId,
      provider:      providerName,
      model,
      capturedUsage: null,
      requestStart,
      requestType:   'audio',
      status:        'success',
    });

    const jsonResponse = new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    return addCORSHeaders(jsonResponse);
  } catch (error) {
    logger.error("Transcription error", error);

    recordUsage({
      env,
      ctx,
      userId,
      provider:      'unknown',
      model:         'unknown',
      capturedUsage: null,
      requestStart,
      requestType:   'audio',
      status:        'error',
    });
    emit(env, ctx, {
      event:    'provider.error',
      severity: 'error',
      data: {
        requestType: 'audio',
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - requestStart,
      },
    });

    if (error instanceof Error) {
      return createErrorResponse(error.message, 500, "api_error");
    }

    return createErrorResponse(
      "Failed to process transcription request",
      500,
      "internal_error"
    );
  }
}
