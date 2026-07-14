/**
 * Model Taxonomy
 *
 * Single source of truth for model classification across all providers.
 * Every discovery provider imports from here — never use raw string literals
 * for types or capabilities outside this file.
 *
 * Adding a new category:
 *   1. Extend `ModelType` or `ModelCapability` here.
 *   2. TypeScript will surface every switch/exhaustive check that needs updating.
 *   3. Add a branch in the helper functions below.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-level model category.
 * Used for routing (which executor to call) and frontend grouping.
 */
export type ModelType =
  | "chat"        // Text-in, text-out conversational / completion
  | "multimodal"  // Image / audio input accepted alongside text
  | "embedding"   // Text-in, fixed-length vector-out
  | "image"       // Text-in, image-out  (image generation)
  | "video"       // Text-in, video-out  (video generation)
  | "audio"       // Audio-in, text-out  (ASR / speech-to-text)
  | "tts";        // Text-in, audio-out  (text-to-speech)

/**
 * Fine-grained feature tags exposed to the frontend for filtering and display.
 * Keep these stable — the frontend stores them in user preferences.
 */
export type ModelCapability =
  // ── Core output modes ───────────────────────────────────────────────────────
  | "chat"
  | "completion"
  | "text-generation"
  // ── Multi-modal ─────────────────────────────────────────────────────────────
  | "vision"
  | "multimodal"
  | "image-generation"
  | "text-to-image"
  | "video-generation"
  | "text-to-video"
  // ── Audio ───────────────────────────────────────────────────────────────────
  | "audio-transcription"
  | "speech-to-text"
  | "text-to-speech"
  | "tts"
  | "cloned-voice"
  | "audio"                  // generic audio I/O (e.g. Google native-audio models)
  // ── Embedding / RAG ─────────────────────────────────────────────────────────
  | "embedding"
  | "text-embedding"
  | "rag"
  // ── Reasoning / specialised ─────────────────────────────────────────────────
  | "reasoning"
  | "math"
  | "code"
  | "creative"
  | "thinking"               // explicit <think> block / extended thinking
  // ── Search / real-time ──────────────────────────────────────────────────────
  | "web-search"
  | "real-time"
  | "citations"
  // ── Tool use ────────────────────────────────────────────────────────────────
  | "tool-calling"
  | "parallel-tool-calling"
  // ── Performance tags ────────────────────────────────────────────────────────
  | "fast-inference"
  // ── Misc ────────────────────────────────────────────────────────────────────
  | "streaming"
  | "system-prompt";

/** Media types that flow in/out of a model. */
export type ModelInputType  = "text" | "image" | "audio" | "video";
export type ModelOutputType = "text" | "image" | "audio" | "video";

/** Qualitative special-feature tags shown in the model detail card. */
export type SpecialFeature = "thinking" | "reasoning" | "code" | "math" | "creative";

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer a ModelType from a bare model ID string using naming conventions.
 *
 * Use this when the provider API doesn't return a type field and you only
 * have the model identifier to go on.
 *
 * @param id  Model ID without provider prefix (e.g. "paraformer-v2", "dall-e-3")
 */
export function inferModelType(id: string): ModelType {
  const l = id.toLowerCase();
  if (l.includes("embed"))                                                       return "embedding";
  if (l.startsWith("paraformer"))                                                return "audio";
  if (l.includes("whisper"))                                                     return "audio";
  if (l.includes("speech-recognition"))                                          return "audio";
  if (l.includes("tts") || l.includes("speech-01") ||
      l.startsWith("cosyvoice") || l.includes("speech-2") ||
      l.includes("orpheus"))                                                     return "tts";
  if (l.includes("dall-e") || l.includes("imagen") ||
      l.includes("wanx") || l.includes("flux"))                                 return "image";
  if (l.includes("veo"))                                                         return "video";
  if (l.includes("-vl") || l.includes("vision") ||
      l.includes("gemini"))                                                      return "multimodal";
  return "chat";
}

/**
 * Default capability set for a ModelType.
 * Provider files extend this with their own capability strings.
 */
export function capabilitiesForType(type: ModelType): ModelCapability[] {
  switch (type) {
    case "chat":       return ["chat", "text-generation"];
    case "multimodal": return ["chat", "vision", "multimodal"];
    case "embedding":  return ["embedding", "text-embedding"];
    case "image":      return ["image-generation", "text-to-image"];
    case "video":      return ["video-generation", "text-to-video"];
    case "audio":      return ["audio-transcription", "speech-to-text"];
    case "tts":        return ["text-to-speech", "tts"];
  }
}

/**
 * Default input/output media types for a ModelType.
 */
export function ioForType(type: ModelType): {
  inputTypes:  ModelInputType[];
  outputTypes: ModelOutputType[];
} {
  switch (type) {
    case "chat":       return { inputTypes: ["text"],          outputTypes: ["text"]  };
    case "multimodal": return { inputTypes: ["text", "image"], outputTypes: ["text"]  };
    case "embedding":  return { inputTypes: ["text"],          outputTypes: ["text"]  };
    case "image":      return { inputTypes: ["text"],          outputTypes: ["image"] };
    case "video":      return { inputTypes: ["text"],          outputTypes: ["video"] };
    case "audio":      return { inputTypes: ["audio"],         outputTypes: ["text"]  };
    case "tts":        return { inputTypes: ["text"],          outputTypes: ["audio"] };
  }
}

/**
 * Parse an OpenRouter modality string (e.g. "text+image->text") into
 * structured ModelType, inputTypes, and outputTypes.
 *
 * Rules (precedence order):
 *   output contains "image"  → image
 *   output contains "video"  → video
 *   output contains "audio"  → tts
 *   input  contains "audio" only → audio
 *   input  contains "image" / "video" → multimodal
 *   otherwise → chat
 */
export function parseModalityString(modality: string): {
  type:        ModelType;
  inputTypes:  ModelInputType[];
  outputTypes: ModelOutputType[];
} {
  const [rawIn = "text", rawOut = "text"] = modality.split("->").map(s => s.toLowerCase().trim());
  const allMedia: Array<ModelInputType | ModelOutputType> = ["text", "image", "audio", "video"];

  const inputTypes  = rawIn.split("+").filter((s): s is ModelInputType  => allMedia.includes(s as any));
  const outputTypes = rawOut.split("+").filter((s): s is ModelOutputType => allMedia.includes(s as any));

  const ins  = inputTypes.length  > 0 ? inputTypes  : ["text" as const];
  const outs = outputTypes.length > 0 ? outputTypes : ["text" as const];

  let type: ModelType = "chat";
  if      (outs.includes("image"))                         type = "image";
  else if (outs.includes("video"))                         type = "video";
  else if (outs.includes("audio"))                         type = "tts";
  else if (ins.includes("audio") && !ins.includes("text")) type = "audio";
  else if (ins.includes("image") || ins.includes("video")) type = "multimodal";

  return { type, inputTypes: ins, outputTypes: outs };
}
