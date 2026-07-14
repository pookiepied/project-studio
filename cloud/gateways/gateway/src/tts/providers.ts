import type { GatewayEnv } from "../env";
import { createErrorResponse } from "../middleware/response";
import { addCORSHeaders } from "../middleware/cors";
import { logger } from "../logger";
import {
  OPENAI_VOICE_NAMES,
  GENERIC_TO_OPENAI,
  GROQ_ORPHEUS_VOICES,
  GENERIC_TO_GROQ_ORPHEUS,
  GENERIC_TO_ALIBABA,
  GENERIC_TO_MINIMAX,
} from "./voices";
import { base64ToUint8Array, hexToUint8Array, pcmToWav } from "./audio";

import { STUDIO_SITE_URL, STUDIO_APP_TITLE } from "../config/constants";

export async function handleGoogleTTS(
  request: Request,
  env: GatewayEnv,
  modelId: string,
  text: string,
  voice: string
): Promise<Response> {
  const apiKey = env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return createErrorResponse("Google AI API key is not configured", 503, "configuration_error");
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    });
  } catch (err) {
    logger.error("TTS: failed to reach Gemini API", err);
    return createErrorResponse("Failed to reach TTS API", 502, "api_error");
  }

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text().catch(() => "");
    logger.error("TTS: Gemini API error", { status: geminiResponse.status, body: errText });
    return createErrorResponse(`TTS API error (${geminiResponse.status})`, geminiResponse.status, "api_error", request);
  }

  const data = (await geminiResponse.json()) as any;
  const inlineData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData?.data) {
    logger.error("TTS: no audio data in Gemini response", { data });
    return createErrorResponse("No audio data returned by TTS API", 500, "api_error", request);
  }

  // Gemini returns raw PCM: 16-bit signed LE, mono, 24 kHz
  const pcm = base64ToUint8Array(inlineData.data as string);
  const wav = pcmToWav(pcm, 24000, 1, 16);

  logger.info("Google TTS complete", { byteLength: wav.byteLength });
  return addCORSHeaders(new Response(wav, {
    status: 200,
    headers: {
      "Content-Type":   "audio/wav",
      "Content-Length": String(wav.byteLength),
      "Cache-Control":  "no-store",
    },
  }), request);
}

export async function handleOpenAICompatibleTTS(
  request: Request,
  apiKey: string | undefined,
  baseUrl: string,
  modelId: string,
  text: string,
  voice: string,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  if (!apiKey) {
    return createErrorResponse("API key for this provider is not configured", 503, "configuration_error", request);
  }

  const lowerVoice = voice.toLowerCase();
  const openaiVoice: string =
    (OPENAI_VOICE_NAMES as readonly string[]).includes(lowerVoice)
      ? lowerVoice
      : (GENERIC_TO_OPENAI[lowerVoice] ?? "alloy");

  let ttsResponse: Response;
  try {
    ttsResponse = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({ model: modelId, input: text, voice: openaiVoice, response_format: "mp3" }),
    });
  } catch (err) {
    logger.error("TTS: failed to reach provider API", err);
    return createErrorResponse("Failed to reach TTS API", 502, "api_error");
  }

  if (!ttsResponse.ok) {
    const errText = await ttsResponse.text().catch(() => "");
    logger.error("TTS: provider API error", { status: ttsResponse.status, body: errText });
    return createErrorResponse(`TTS API error (${ttsResponse.status})`, ttsResponse.status, "api_error", request);
  }

  const audioBuffer = await ttsResponse.arrayBuffer();
  logger.info("OpenAI-compat TTS complete", { byteLength: audioBuffer.byteLength, baseUrl });
  return addCORSHeaders(new Response(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type":   "audio/mpeg",
      "Content-Length": String(audioBuffer.byteLength),
      "Cache-Control":  "no-store",
    },
  }), request);
}

export async function handleGroqTTS(
  request: Request,
  env: GatewayEnv,
  modelId: string,
  text: string,
  voice: string
): Promise<Response> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    return createErrorResponse("Groq API key is not configured", 503, "configuration_error", request);
  }

  const lower = voice.toLowerCase();
  const orpheusVoice = GROQ_ORPHEUS_VOICES.has(lower)
    ? lower
    : (GENERIC_TO_GROQ_ORPHEUS[lower] ?? "leah");

  logger.info("Groq Orpheus TTS request", { modelId, orpheusVoice, textLength: text.length });

  let ttsResponse: Response;
  try {
    ttsResponse = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, input: text, voice: orpheusVoice, response_format: "mp3" }),
    });
  } catch (err) {
    logger.error("TTS: failed to reach Groq API", err);
    return createErrorResponse("Failed to reach Groq TTS API", 502, "api_error", request);
  }

  if (!ttsResponse.ok) {
    const errText = await ttsResponse.text().catch(() => "");
    logger.error("TTS: Groq API error", { status: ttsResponse.status, body: errText });
    return createErrorResponse(`Groq API error (${ttsResponse.status})`, ttsResponse.status, "api_error", request);
  }

  const audioBuffer = await ttsResponse.arrayBuffer();
  logger.info("Groq Orpheus TTS complete", { byteLength: audioBuffer.byteLength });
  return addCORSHeaders(new Response(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type":   "audio/mpeg",
      "Content-Length": String(audioBuffer.byteLength),
      "Cache-Control":  "no-store",
    },
  }), request);
}

export async function handleAlibabaTTS(
  request: Request,
  env: GatewayEnv,
  modelId: string,
  text: string,
  voice: string
): Promise<Response> {
  const apiKey = env.ALIBABA_API_KEY;
  const baseUrl = env.ALIBABA_API_HOST || "https://dashscope-intl.aliyuncs.com/api/v1";
  if (!apiKey) {
    return createErrorResponse("Alibaba Cloud API key is not configured", 503, "configuration_error", request);
  }

  const dashScopeVoice = GENERIC_TO_ALIBABA[voice.toLowerCase()] ?? "loong";

  let ttsResponse: Response;
  try {
    ttsResponse = await fetch(`${baseUrl}/services/aigc/text2voice/speech-synthesis`, {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "Authorization":    `Bearer ${apiKey}`,
        "X-DashScope-Async": "disable",
      },
      body: JSON.stringify({
        model: modelId,
        input: { text },
        parameters: {
          voice:       dashScopeVoice,
          format:      "wav",
          sample_rate: 24000,
          volume:      50,
          rate:        1.0,
          pitch:       1.0,
        },
      }),
    });
  } catch (err) {
    logger.error("TTS: failed to reach Alibaba API", err);
    return createErrorResponse("Failed to reach Alibaba TTS API", 502, "api_error", request);
  }

  if (!ttsResponse.ok) {
    const errText = await ttsResponse.text().catch(() => "");
    logger.error("TTS: Alibaba API error", { status: ttsResponse.status, body: errText });
    return createErrorResponse(`Alibaba API error (${ttsResponse.status})`, ttsResponse.status, "api_error", request);
  }

  const audioBuffer = await ttsResponse.arrayBuffer();
  logger.info("Alibaba TTS complete", { byteLength: audioBuffer.byteLength, modelId, voice: dashScopeVoice });
  return addCORSHeaders(new Response(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type":   "audio/wav",
      "Content-Length": String(audioBuffer.byteLength),
      "Cache-Control":  "no-store",
    },
  }), request);
}

export async function handleMiniMaxTTS(
  request: Request,
  env: GatewayEnv,
  modelId: string,
  text: string,
  voice: string
): Promise<Response> {
  const apiKey = env.MINIMAX_API_KEY;
  if (!apiKey) {
    return createErrorResponse("MiniMax API key is not configured", 503, "configuration_error", request);
  }

  const groupId = env.MINIMAX_GROUP_ID;
  const url = `https://api.minimax.io/v1/t2a_v2?GroupId=${groupId}`;

  // Format: "speech-01-turbo" or "speech-01-turbo:voice_id"
  const parts = modelId.split(":");
  const engine = parts[0] || "speech-01-turbo";
  const discoveredVoiceId = parts[1];
  const voiceId = discoveredVoiceId
    || (voice.includes("-") ? voice : (GENERIC_TO_MINIMAX[voice.toLowerCase()] ?? "female-qn-en"));

  logger.info("MiniMax TTS request", { engine, voiceId, textLength: text.length, groupId });

  let ttsResponse: Response;
  try {
    ttsResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: engine,
        text,
        stream: false,
        voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
        audio_setting:  { sample_rate: 32000, format: "mp3", channel: 1 },
      }),
    });
  } catch (err) {
    logger.error("TTS: failed to reach MiniMax API", err);
    return createErrorResponse("Failed to reach MiniMax TTS API", 502, "api_error", request);
  }

  if (!ttsResponse.ok) {
    const errText = await ttsResponse.text().catch(() => "");
    logger.error("TTS: MiniMax API error", { status: ttsResponse.status, body: errText });
    return createErrorResponse(`MiniMax API error (${ttsResponse.status})`, ttsResponse.status, "api_error", request);
  }

  const contentType = ttsResponse.headers.get("Content-Type") || "";
  if (contentType.includes("audio")) {
    const buffer = await ttsResponse.arrayBuffer();
    logger.info("MiniMax TTS complete (binary)", { byteLength: buffer.byteLength });
    return addCORSHeaders(new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":   "audio/wav",
        "Content-Length": String(buffer.byteLength),
        "Cache-Control":  "no-store",
      },
    }), request);
  }

  try {
    const result = (await ttsResponse.json()) as any;
    const hexAudio   = result?.data?.audio;
    const statusMsg  = result?.base_resp?.status_msg || "Unknown error";
    const statusCode = result?.base_resp?.status_code;

    logger.info("MiniMax API response", { statusCode, statusMsg, hasAudio: !!hexAudio, audioLength: hexAudio?.length });

    if (!hexAudio) {
      logger.error("TTS: no audio data in MiniMax JSON response", { statusCode, statusMsg, result });
      return createErrorResponse(`No audio data returned by MiniMax API: ${statusMsg}`, 500, "api_error", request);
    }

    const audioData = hexToUint8Array(hexAudio);
    logger.info("MiniMax TTS complete (JSON)", { byteLength: audioData.byteLength });
    return addCORSHeaders(new Response(audioData, {
      status: 200,
      headers: {
        "Content-Type":   "audio/mpeg",
        "Content-Length": String(audioData.byteLength),
        "Cache-Control":  "no-store",
      },
    }), request);
  } catch (err) {
    logger.error("TTS: failed to parse MiniMax JSON response", err);
    return createErrorResponse("Failed to parse TTS response", 500, "api_error", request);
  }
}

/** Extra headers to pass for OpenRouter requests. */
export function openRouterHeaders(env: GatewayEnv): Record<string, string> {
  return {
    "HTTP-Referer": env.OPENROUTER_SITE_URL ?? STUDIO_SITE_URL,
    "X-Title":      STUDIO_APP_TITLE,
  };
}

/**
 * Azure OpenAI TTS — uses deployment URL pattern with api-key header.
 * AZURE_DEPLOYMENTS JSON should include a "tts" → deployment-name entry.
 */
export async function handleAzureTTS(
  request:  Request,
  env:      GatewayEnv,
  modelId:  string,
  text:     string,
  voice:    string,
): Promise<Response> {
  const resourceName = env.AZURE_RESOURCE_NAME;
  const apiKey       = env.AZURE_API_KEY;
  const apiVersion   = env.AZURE_OPENAI_API_VERSION ?? "2025-01-01-preview";

  if (!resourceName || !apiKey) {
    return createErrorResponse("AZURE_RESOURCE_NAME and AZURE_API_KEY must be configured", 503, "configuration_error");
  }

  let deploymentName = modelId;
  if (env.AZURE_DEPLOYMENTS) {
    try {
      const map = JSON.parse(env.AZURE_DEPLOYMENTS) as Record<string, string>;
      deploymentName = map[modelId] ?? modelId;
    } catch { /* ignore */ }
  }

  const url = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}/audio/speech?api-version=${apiVersion}`;

  let ttsResponse: Response;
  try {
    ttsResponse = await fetch(url, {
      method:  "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: deploymentName, input: text, voice, response_format: "mp3" }),
    });
  } catch (err) {
    logger.error("TTS: failed to reach Azure API", err);
    return createErrorResponse("Failed to reach Azure TTS API", 502, "api_error", request);
  }

  if (!ttsResponse.ok) {
    const errText = await ttsResponse.text().catch(() => "");
    logger.error("TTS: Azure API error", { status: ttsResponse.status, body: errText });
    return createErrorResponse(`Azure TTS error (${ttsResponse.status})`, ttsResponse.status, "api_error", request);
  }

  const buffer = await ttsResponse.arrayBuffer();
  logger.info("Azure TTS complete", { byteLength: buffer.byteLength });
  return addCORSHeaders(new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":   "audio/mpeg",
      "Content-Length": String(buffer.byteLength),
      "Cache-Control":  "no-store",
    },
  }), request);
}
