/**
 * MiniMax Provider Discovery
 *
 * Discovers MiniMax models across three categories:
 *   1. ASR   — speech-recognition-01 (static; no live endpoint)
 *   2. Chat  — MiniMax-Text-01, abab6.5s-chat etc. (live /v1/models or static fallback)
 *   3. TTS   — speech-01-turbo, speech-01-24k, speech-2.8-hd (static engines)
 *   4. Voices — custom/cloned voice slots (live /v1/get_voice)
 *
 * GroupId is required for ALL MiniMax API calls (auth + routing).
 *
 * Pricing: USD per 1 000 000 tokens / per character (as of May 2026)
 *   https://platform.minimaxi.com/document/pricing
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

// ─────────────────────────────────────────────────────────────────────────────
// Static fallback chat models (returned when /v1/models fails or returns nothing)
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_CHAT_MODELS: Model[] = [
  {
    id: "minimax:MiniMax-Text-01",
    provider: "minimax",
    type: "chat",
    name: "MiniMax Text-01",
    description: "MiniMax flagship language model — 1M token context window",
    maxTokens: 4096,
    contextWindow: 1_000_000,
    pricing: { input: 0.20, output: 1.10, currency: "USD" },
    free: false,
    capabilities: ["chat", "text-generation", "tool-calling"],
    modality: ["text"],
    architecture: "MiniMax",
    supportsStreaming: true,
    supportsTools: true,
    supportsSystemPrompts: true,
    inputTypes: ["text"],
    outputTypes: ["text"],
  },
  {
    id: "minimax:abab6.5s-chat",
    provider: "minimax",
    type: "chat",
    name: "MiniMax abab6.5s",
    description: "MiniMax efficient chat model — balanced speed and quality",
    maxTokens: 8192,
    contextWindow: 245760,
    pricing: { input: 0.10, output: 0.10, currency: "USD" },
    free: false,
    capabilities: ["chat", "text-generation", "tool-calling"],
    modality: ["text"],
    architecture: "MiniMax",
    supportsStreaming: true,
    supportsTools: true,
    supportsSystemPrompts: true,
    inputTypes: ["text"],
    outputTypes: ["text"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Static TTS engine definitions (no live endpoint for TTS models)
// ─────────────────────────────────────────────────────────────────────────────

interface TtsEngine { id: string; name: string; description: string }

const TTS_ENGINES: TtsEngine[] = [
  { id: "speech-01-turbo", name: "MiniMax Turbo", description: "Fast, low-latency TTS engine" },
  { id: "speech-01-24k",   name: "MiniMax 24k",   description: "High-fidelity 24kHz TTS engine" },
  { id: "speech-2.8-hd",   name: "MiniMax 2.8 HD", description: "Highest-fidelity HD speech engine" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Discovery class
// ─────────────────────────────────────────────────────────────────────────────

export class MiniMaxDiscovery implements ProviderDiscovery {
  name = "minimax";
  private readonly baseUrl = "https://api.minimax.io/v1";

  constructor(
    private readonly apiKey:          string,
    private readonly options: {
      groupId:          string;
      customVoiceId?:   string;
      customVoiceName?: string;
    },
  ) {}

  async discoverModels(): Promise<Model[]> {
    const models: Model[] = [];
    const timestamp = Date.now();

    // ── 1. Static ASR model ────────────────────────────────────────────────
    // MiniMax has no live model-list endpoint for ASR (confirmed May 2026).
    models.push({
      id:          "minimax:speech-recognition-01",
      provider:    "minimax",
      type:        "audio",
      name:        "MiniMax Speech Recognition",
      description: "Speech-to-text recognition — MiniMax ASR",
      pricing:     { input: 0.0005, output: 0, currency: "USD" },
      free:        false,
      capabilities:    ["audio-transcription", "speech-to-text"],
      modality:        ["audio", "text"],
      architecture:    "MiniMax ASR",
      created:         timestamp,
      supportsStreaming: false,
      inputTypes:  ["audio"],
      outputTypes: ["text"],
    });

    // ── 2. Live chat model discovery ───────────────────────────────────────
    // Try /v1/models. On failure, fall back to static catalogue.
    const chatModels = await this.discoverChatModels();
    models.push(...chatModels);

    // ── 3. Static TTS engines ─────────────────────────────────────────────
    for (const engine of TTS_ENGINES) {
      models.push({
        id:          `minimax:${engine.id}`,
        provider:    "minimax",
        type:        "tts",
        name:        engine.name,
        description: engine.description,
        pricing:     { input: 0.005, output: 0.005, currency: "USD" },
        free:        false,
        capabilities:    ["text-to-speech", "tts"],
        modality:        ["text", "audio"],
        architecture:    "MiniMax T2A",
        created:         timestamp,
        supportsStreaming: true,
        inputTypes:  ["text"],
        outputTypes: ["audio"],
      });
    }

    // ── 4. Live voice slots (cloned voices) ───────────────────────────────
    const voiceModels = await this.discoverVoices(timestamp);
    models.push(...voiceModels);

    logger.info(`minimax: ${models.length} models (1 ASR, ${chatModels.length} chat, ${TTS_ENGINES.length} TTS, ${voiceModels.length} voices)`);
    return models;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async discoverChatModels(): Promise<Model[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        logger.warn(`MiniMax /v1/models failed (${response.status}), using static fallback`);
        return FALLBACK_CHAT_MODELS;
      }

      const data: any = await response.json();
      const rawModels: any[] = data.data ?? data.models ?? [];

      if (rawModels.length === 0) {
        logger.warn("MiniMax /v1/models returned empty list, using static fallback");
        return FALLBACK_CHAT_MODELS;
      }

      const chatModels: Model[] = [];
      for (const m of rawModels) {
        const id: string = m.id || m.name || "";
        if (!id) continue;

        // Only include chat/text models here; audio/TTS handled separately
        const lower = id.toLowerCase();
        if (lower.includes("speech") || lower.includes("asr") || lower.includes("tts")) continue;

        chatModels.push({
          id:          `minimax:${id}`,
          provider:    "minimax",
          type:        "chat",
          name:        m.name || id,
          description: m.description || "MiniMax language model",
          maxTokens:     m.max_completion_tokens ?? 4096,
          contextWindow: m.context_length ?? 245760,
          pricing:     { input: 0.20, output: 1.10, currency: "USD" },
          free:        false,
          capabilities:    ["chat", "text-generation", "tool-calling"],
          modality:        ["text"],
          architecture:    "MiniMax",
          created:         m.created ?? Date.now(),
          supportsStreaming:     true,
          supportsTools:         true,
          supportsSystemPrompts: true,
          inputTypes:  ["text"],
          outputTypes: ["text"],
        });
      }

      return chatModels.length > 0 ? chatModels : FALLBACK_CHAT_MODELS;
    } catch (error) {
      logger.error("MiniMax chat discovery failed, using static fallback:", error);
      return FALLBACK_CHAT_MODELS;
    }
  }

  private async discoverVoices(timestamp: number): Promise<Model[]> {
    const seenVoiceIds = new Set<string>();
    const voiceModels: Model[] = [];

    try {
      const response = await fetch(`${this.baseUrl}/get_voice`, {
        method:  "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "all" }),
      });

      if (response.ok) {
        const data: any = await response.json();
        logger.info("MiniMax /get_voice response received", { status: response.status });

        if (data && typeof data === "object") {
          for (const key of Object.keys(data)) {
            if (!key.includes("voice") || !Array.isArray(data[key])) continue;

            for (const voice of data[key]) {
              if (!voice?.voice_id) continue;
              seenVoiceIds.add(voice.voice_id);

              voiceModels.push({
                id:       `minimax:speech-2.8-hd:${voice.voice_id}`,
                provider: "minimax",
                type:     "tts",
                name:     `MiniMax: ${voice.voice_name || voice.name || voice.voice_id}`,
                description: Array.isArray(voice.description)
                  ? voice.description[0]
                  : (voice.description || `MiniMax ${key.replace("_", " ")}`),
                pricing:  { input: 0.01, output: 0.01, currency: "USD" },
                free:     false,
                capabilities: ["text-to-speech", "tts", "cloned-voice"],
                modality:     ["text", "audio"],
                architecture: "MiniMax T2A",
                created:      timestamp,
                supportsStreaming: true,
                inputTypes:  ["text"],
                outputTypes: ["audio"],
              });
            }
          }
        }
      } else {
        const errText = await response.text();
        logger.error("MiniMax /get_voice failed", { status: response.status, error: errText });
      }
    } catch (error) {
      logger.error("MiniMax voice discovery failed:", error);
    }

    // Inject custom voice from env if not already seen
    const { customVoiceId, customVoiceName } = this.options;
    if (customVoiceId && !seenVoiceIds.has(customVoiceId)) {
      logger.info(`Injecting configured custom voice: ${customVoiceId}`);
      voiceModels.push({
        id:       `minimax:speech-2.8-hd:${customVoiceId}`,
        provider: "minimax",
        type:     "tts",
        name:     customVoiceName || `MiniMax: Custom Voice (${customVoiceId.substring(0, 8)})`,
        description: "Configured custom voice slot from gateway settings",
        pricing:  { input: 0.01, output: 0.01, currency: "USD" },
        free:     false,
        capabilities: ["text-to-speech", "tts", "cloned-voice"],
        modality:     ["text", "audio"],
        architecture: "MiniMax T2A",
        created:      timestamp,
        supportsStreaming: true,
        inputTypes:  ["text"],
        outputTypes: ["audio"],
      });
    }

    return voiceModels;
  }
}
