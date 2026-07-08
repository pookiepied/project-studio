export function isOpenAIChatModel(modelId: string): boolean {
  return (
    /^(gpt-|o\d|chatgpt-)/.test(modelId) &&
    !modelId.includes("audio") &&
    !modelId.includes("transcribe") &&
    !modelId.includes("tts") &&
    !modelId.includes("image") &&
    !modelId.includes("embedding")
  );
}

export function isOpenAIEmbeddingModel(modelId: string): boolean {
  return modelId.includes("embedding");
}

export function isOpenAITranscriptionModel(modelId: string): boolean {
  return modelId.includes("transcribe") || modelId === "whisper-1";
}

export function isOpenAISpeechModel(modelId: string): boolean {
  return modelId.includes("tts");
}

export function isOpenAIImageModel(modelId: string): boolean {
  return modelId.includes("image") || modelId.startsWith("dall-e-") || modelId.startsWith("chatgpt-image-");
}

export function supportsOpenAIVision(modelId: string): boolean {
  return /gpt-5|gpt-4\.1|gpt-4o|o3|o4/.test(modelId) && !modelId.includes("search-preview");
}

export function supportsOpenAITools(modelId: string): boolean {
  return !modelId.includes("search-preview") && !modelId.includes("gpt-5-chat-latest");
}

export function supportsOpenAIJsonSchema(modelId: string): boolean {
  // Strict json_schema structured outputs require gpt-4o-2024-08-06 / gpt-4o-mini and later
  // (gpt-4o, gpt-4.1, gpt-5, o-series). Legacy gpt-3.5-turbo supports only json_object, so it
  // must NOT declare json_schema — otherwise the gateway would enforce a schema OpenAI rejects.
  // Confirmed: https://platform.openai.com/docs/guides/structured-outputs (as of 2026-07-05).
  return supportsOpenAITools(modelId) && !modelId.includes("gpt-5-chat-latest") && !modelId.startsWith("gpt-3.5");
}

export function supportsOpenAIPromptCaching(modelId: string): boolean {
  return /gpt-5|gpt-4\.1|gpt-4o|o\d|o4/.test(modelId);
}

export function supportsOpenAIImageEdit(modelId: string): boolean {
  return modelId.startsWith("gpt-image-") || modelId.startsWith("chatgpt-image-");
}

export function contextWindowForOpenAIModel(modelId: string): number {
  if (/gpt-5\.(?:[4-9]|\d{2,})/.test(modelId)) return 1_000_000;
  if (/gpt-5|gpt-4\.1|gpt-4o|o\d|o4/.test(modelId)) return 128_000;
  return 16_000;
}

export function maxOutputForOpenAIModel(modelId: string): number {
  if (/gpt-5\.(?:[4-9]|\d{2,})/.test(modelId)) return 128_000;
  return 16_384;
}

