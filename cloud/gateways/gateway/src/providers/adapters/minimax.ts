import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel }    from "ai";
import { BaseAdapter }           from "./base";

// ── Chat provider ─────────────────────────────────────────────────────────────

export class MinimaxAdapter extends BaseAdapter {
  protected readonly providerName = "minimax";
  private readonly provider: ReturnType<typeof createOpenAICompatible>;

  constructor(apiKey: string) {
    super();
    this.provider = createOpenAICompatible({
      name:    "minimax",
      baseURL: "https://api.minimax.io/v1",
      apiKey,
    });
  }

  protected getModel(modelId: string): LanguageModel {
    return this.provider(modelId) as LanguageModel;
  }
}

// ── TTS (text-to-speech) — separate from chat, called directly by TTS tool ───

export interface MinimaxTTSOptions {
  text:     string;
  voiceId?: string;
  speed?:   number;
  pitch?:   number;
  volume?:  number;
  format?:  "mp3" | "pcm" | "flac";
}

export class MinimaxTTS {
  constructor(private readonly apiKey: string) {}

  async synthesize(opts: MinimaxTTSOptions): Promise<ArrayBuffer> {
    const response = await fetch("https://api.minimax.io/v1/t2a_v2", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model:   "speech-02-hd",
        text:    opts.text,
        voice_id: opts.voiceId ?? "female-tianmei",
        speed:   opts.speed  ?? 1.0,
        vol:     opts.volume ?? 1.0,
        pitch:   opts.pitch  ?? 0,
        audio_setting: {
          format:      opts.format ?? "mp3",
          sample_rate: 32000,
          bitrate:     128000,
          channel:     1,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[minimax-tts] HTTP ${response.status}: ${err.slice(0, 300)}`);
    }

    const data = (await response.json()) as any;
    const audioHex: string = data?.data?.audio;
    if (!audioHex) throw new Error("[minimax-tts] No audio data in response");

    const bytes = new Uint8Array(
      audioHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)),
    );
    return bytes.buffer;
  }
}
