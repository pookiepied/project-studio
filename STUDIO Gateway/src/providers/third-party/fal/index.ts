import type { ProviderRuntime } from "../../contract.ts";
import { createFal } from "@ai-sdk/fal";
import { generateImage, generateSpeech, transcribe } from "ai";
import { FAL_STATIC_MODELS } from "./catalog.ts";
import { badRequest } from "../../../lib/errors.ts";

export const falProvider: ProviderRuntime = {
  providerId: "fal",
  protocol: "openai-completions",
  async chat(req) {
    // Fal chat is OpenAI-compatible — delegate to shared SDK path (single quirks point in common.ts)
    const { thirdPartyChat } = await import("../common.ts");
    return thirdPartyChat("fal", req);
  },
  async discover() {
    return FAL_STATIC_MODELS;
  },
  async generateImage(req) {
    const fal = createFal({ apiKey: req.apiKey });
    const result = await generateImage({
      model: fal.image(req.model.id),
      prompt: req.prompt,
      n: (req.body.n as number) ?? 1,
      size: req.body.size as any | undefined,
    });
    const images = result.images.map((img: unknown) => {
      const b64 = (img as { base64?: string; b64_json?: string }).base64 ?? (img as { b64_json?: string }).b64_json;
      const url = (img as { url?: string }).url;
      return url ? { url, b64_json: b64 } : { b64_json: b64 };
    });
    return new Response(JSON.stringify({ created: Math.floor(Date.now() / 1000), data: images }), { status: 200, headers: { "content-type": "application/json" } });
  },
  async generateSpeech(req) {
    const fal = createFal({ apiKey: req.apiKey });
    const result = await generateSpeech({
      model: fal.speech(req.model.id as never),
      text: req.input,
      voice: req.voice as never,
    });
    const audio = result.audio as { uint8Array?: Uint8Array; base64?: string; mediaType?: string };
    const bytes = audio.uint8Array ?? (audio.base64 ? Uint8Array.from(atob(audio.base64), (c) => c.charCodeAt(0)) : new Uint8Array());
    return new Response(bytes, { status: 200, headers: { "content-type": audio.mediaType ?? "audio/mpeg" } });
  },
  async transcribe(req) {
    const fal = createFal({ apiKey: req.apiKey });
    const file = req.form.get("file") as File | null;
    if (!file) throw badRequest("file is required for transcription");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await transcribe({ model: fal.transcription(req.model.id as never), audio: bytes });
    return new Response(JSON.stringify({ text: result.text }), { status: 200, headers: { "content-type": "application/json" } });
  },
  async generateVideo(req) {
    const fal = createFal({ apiKey: req.apiKey });
    const { experimental_generateVideo } = await import("ai");
    const result = await experimental_generateVideo({
      model: fal.video(req.model.id as never),
      prompt: typeof req.prompt === "string" ? req.prompt : (req.prompt as { text: string }).text,
    } as never);
    const video = (result as { video?: { base64?: string; uint8Array?: Uint8Array } }).video;
    const bytes = video?.uint8Array ?? (video?.base64 ? Uint8Array.from(atob(video.base64), (c) => c.charCodeAt(0)) : new Uint8Array());
    return new Response(bytes, { status: 200, headers: { "content-type": "video/mp4" } });
  },
};

export { FAL_STATIC_MODELS };
