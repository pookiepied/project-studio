/**
 * Direct Audio Execution
 *
 * Handles audio transcription (speech-to-text) via provider APIs.
 * Each private method maps to one provider's wire format.
 *
 * Supported providers:
 *   groq     — Whisper large-v3-turbo via OpenAI-compatible /audio/transcriptions
 *   openai   — Whisper-1 via native /audio/transcriptions
 *   alibaba  — Paraformer-v2 via DashScope OpenAI-compat /audio/transcriptions
 *   minimax  — MiniMax ASR via /audio/transcriptions with GroupId query param
 *
 * All providers accept the same OpenAI multipart/form-data format so adding a
 * new provider is usually a matter of supplying the correct base URL + key.
 */

import { GatewayEnv } from "../../env";
import { TranscribeRequest, TranscribeResponse } from "../../types";
import { logger } from "../../logger";
import { parseModelId } from "../../utils/modelParser";

export class AudioExecutor {
  constructor(private readonly env: GatewayEnv) {}

  // ── Router ────────────────────────────────────────────────────────────────

  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const { provider, modelId } = parseModelId(request.model);

    switch (provider) {
      case "groq":
        return this.transcribeOpenAICompat(
          modelId,
          request,
          "https://api.groq.com/openai/v1",
          this.env.GROQ_API_KEY,
          "Groq",
        );
      case "openai":
        return this.transcribeOpenAICompat(
          modelId,
          request,
          "https://api.openai.com/v1",
          this.env.OPENAI_API_KEY,
          "OpenAI",
        );
      case "azure":
        return this.transcribeAzure(modelId, request);
      case "openrouter":
        return this.transcribeOpenRouter(modelId, request);
      case "alibaba":
        return this.transcribeAlibaba(modelId, request);
      case "minimax":
        return this.transcribeMinimax(modelId, request);
      default:
        throw new Error(`Audio transcription not supported for provider: ${provider}`);
    }
  }

  // ── OpenAI-compatible (Groq + OpenAI) ────────────────────────────────────

  /**
   * Generic OpenAI-compatible transcription.
   * Used by Groq (whisper-large-v3-turbo) and OpenAI (whisper-1).
   * Both accept the exact same multipart/form-data format.
   */
  private async transcribeOpenAICompat(
    modelId:      string,
    request:      TranscribeRequest,
    baseUrl:      string,
    apiKey:       string | undefined,
    providerName: string,
  ): Promise<TranscribeResponse> {
    if (!apiKey) {
      throw new Error(`${providerName} API key not configured`);
    }

    logger.info(`[audio] Transcribing via ${providerName}`, { modelId });

    const form = new FormData();
    form.append("file",  request.file);
    form.append("model", modelId);
    if (request.language)    form.append("language",       request.language);
    if (request.temperature) form.append("temperature",    String(request.temperature));
    if (request.response_format) form.append("response_format", request.response_format);

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${providerName} transcription failed (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data: any = await response.json();
    return { text: data.text, language: data.language, duration: data.duration };
  }

  // ── Azure OpenAI (Whisper deployment) ────────────────────────────────────

  /**
   * Transcribe via Azure OpenAI Whisper deployment.
   * Uses the deployment URL pattern and api-key header (not Authorization Bearer).
   * AZURE_DEPLOYMENTS JSON should include a "whisper" → deployment-name entry.
   */
  private async transcribeAzure(
    modelId: string,
    request: TranscribeRequest,
  ): Promise<TranscribeResponse> {
    const resourceName = this.env.AZURE_RESOURCE_NAME;
    const apiKey       = this.env.AZURE_API_KEY;
    const apiVersion   = this.env.AZURE_OPENAI_API_VERSION ?? "2025-01-01-preview";

    if (!resourceName || !apiKey) {
      throw new Error("AZURE_RESOURCE_NAME and AZURE_API_KEY must be configured for Azure STT");
    }

    let deploymentName = modelId;
    if (this.env.AZURE_DEPLOYMENTS) {
      try {
        const map = JSON.parse(this.env.AZURE_DEPLOYMENTS) as Record<string, string>;
        deploymentName = map[modelId] ?? modelId;
      } catch { /* ignore */ }
    }

    const url = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}/audio/transcriptions?api-version=${apiVersion}`;

    const form = new FormData();
    form.append("file",  request.file);
    form.append("model", deploymentName);
    if (request.language)       form.append("language",    request.language);
    if (request.response_format) form.append("response_format", request.response_format);

    const response = await fetch(url, {
      method:  "POST",
      headers: { "api-key": apiKey },
      body:    form,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Azure STT failed (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data: any = await response.json();
    return { text: data.text, language: data.language, duration: data.duration };
  }

  // ── OpenRouter STT (JSON+base64 — NOT multipart) ─────────────────────────

  /**
   * OpenRouter's /audio/transcriptions endpoint uses JSON with base64-encoded
   * audio, NOT the OpenAI multipart/form-data format.
   *
   * Body: { model, input_audio: { data: "<base64>", format: "mp3" } }
   */
  private async transcribeOpenRouter(
    modelId: string,
    request: TranscribeRequest,
  ): Promise<TranscribeResponse> {
    const apiKey = this.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    const arrayBuffer = await request.file.arrayBuffer();
    const bytes       = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64Data  = btoa(binary);

    const mimeType  = request.file.type || "audio/mpeg";
    const formatMap: Record<string, string> = {
      "audio/mpeg": "mp3", "audio/mp3": "mp3",
      "audio/wav":  "wav", "audio/wave": "wav",
      "audio/webm": "webm", "audio/ogg": "ogg",
      "audio/flac": "flac", "audio/m4a": "m4a",
    };
    const format = formatMap[mimeType] ?? "mp3";

    const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        input_audio: { data: base64Data, format },
        ...(request.language ? { language: request.language } : {}),
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`OpenRouter STT failed (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data: any = await response.json();
    return { text: data.text ?? "", language: data.language, duration: data.duration };
  }

  // ── Alibaba (Paraformer) ─────────────────────────────────────────────────

  /**
   * Transcribe via Alibaba Cloud DashScope Paraformer.
   *
   * Uses the DashScope OpenAI-compatible endpoint which accepts the same
   * multipart/form-data format as OpenAI Whisper — no custom marshalling needed.
   *
   * Models:
   *   paraformer-v2          — high-accuracy, best for clear audio
   *   paraformer-realtime-v2 — lower latency, good for conversational audio
   *   paraformer-8k-v2       — optimised for 8kHz phone/PSTN recordings
   *
   * Pricing (May 2026): ~$0.28/hour of audio
   * Docs: https://help.aliyun.com/zh/model-studio/developer-reference/paraformer
   */
  private async transcribeAlibaba(
    modelId: string,
    request: TranscribeRequest,
  ): Promise<TranscribeResponse> {
    const apiKey  = this.env.ALIBABA_API_KEY;
    const baseUrl = this.env.ALIBABA_API_HOST ||
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

    if (!apiKey) {
      throw new Error("Alibaba API key not configured");
    }

    logger.info("[audio] Transcribing via Alibaba Paraformer", { modelId });

    const form = new FormData();
    form.append("file",  request.file);
    form.append("model", modelId);
    if (request.language) form.append("language", request.language);
    // DashScope does not support temperature for Paraformer — omit it
    if (request.response_format) form.append("response_format", request.response_format);

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `Alibaba Paraformer transcription failed (${response.status}): ${errText.slice(0, 300)}`,
      );
    }

    const data: any = await response.json();
    return { text: data.text, language: data.language, duration: data.duration };
  }

  // ── MiniMax ASR ───────────────────────────────────────────────────────────

  /**
   * Transcribe via MiniMax speech recognition.
   *
   * MiniMax's ASR endpoint follows the OpenAI multipart/form-data convention
   * but requires the GroupId as a query parameter (same pattern as MiniMax TTS).
   *
   * Model: speech-recognition-01 (only ASR model as of May 2026)
   *
   * Note: GroupId (MINIMAX_GROUP_ID env var) is required for MiniMax API calls.
   * Without it the request is rejected with a 401.
   *
   * Docs: https://platform.minimaxi.com/document/speech-recognition
   */
  private async transcribeMinimax(
    modelId: string,
    request: TranscribeRequest,
  ): Promise<TranscribeResponse> {
    const apiKey  = this.env.MINIMAX_API_KEY;
    const groupId = this.env.MINIMAX_GROUP_ID;

    if (!apiKey) {
      throw new Error("MiniMax API key not configured");
    }
    if (!groupId) {
      throw new Error("MiniMax GroupId (MINIMAX_GROUP_ID) is required for audio transcription");
    }

    logger.info("[audio] Transcribing via MiniMax ASR", { modelId });

    const form = new FormData();
    form.append("file",  request.file);
    form.append("model", modelId);
    if (request.language) form.append("language", request.language);
    if (request.response_format) form.append("response_format", request.response_format);

    const url = `https://api.minimax.io/v1/audio/transcriptions?GroupId=${groupId}`;

    const response = await fetch(url, {
      method:  "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `MiniMax ASR transcription failed (${response.status}): ${errText.slice(0, 300)}`,
      );
    }

    const data: any = await response.json();

    // MiniMax may wrap the response — handle both OpenAI-compat and native format
    const text = data.text ?? data?.data?.text ?? "";
    if (!text) {
      const statusMsg = data?.base_resp?.status_msg || "unknown error";
      throw new Error(`MiniMax ASR returned no text: ${statusMsg}`);
    }

    return {
      text,
      language: data.language ?? request.language,
      duration: data.duration,
    };
  }
}
