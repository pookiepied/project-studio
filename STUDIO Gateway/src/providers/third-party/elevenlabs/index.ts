import type { ProviderRuntime } from "../../contract.ts";
import { createElevenLabs } from "@ai-sdk/elevenlabs";
import { generateSpeech, transcribe } from "ai";
import { ELEVENLABS_STATIC_MODELS } from "./catalog.ts";
import { badRequest, notImplemented } from "../../../lib/errors.ts";

export const elevenLabsProvider: ProviderRuntime = {
  providerId: "elevenlabs",
  protocol: "openai-completions",
  async chat(_req) {
    throw notImplemented("ElevenLabs does not support chat completions");
  },
  async discover() {
    return ELEVENLABS_STATIC_MODELS;
  },
  async generateSpeech(req) {
    const elevenlabs = createElevenLabs({ apiKey: req.apiKey });
    const result = await generateSpeech({
      model: elevenlabs.speech(req.model.id as never),
      text: req.input,
      voice: (req.voice as string | undefined) ?? "21m00Tcm4TlvDq8ikWAM",
    });
    const audio = result.audio as { uint8Array?: Uint8Array; base64?: string; mediaType?: string };
    const bytes = audio.uint8Array ?? (audio.base64 ? Uint8Array.from(atob(audio.base64), (c) => c.charCodeAt(0)) : new Uint8Array());
    return new Response(bytes, { status: 200, headers: { "content-type": audio.mediaType ?? "audio/mpeg" } });
  },
  async transcribe(req) {
    const elevenlabs = createElevenLabs({ apiKey: req.apiKey });
    const file = req.form.get("file") as File | null;
    if (!file) throw badRequest("file is required for transcription");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await transcribe({
      model: elevenlabs.transcription(req.model.id as never),
      audio: bytes,
    });
    return new Response(JSON.stringify({ text: result.text }), { status: 200, headers: { "content-type": "application/json" } });
  },
};
