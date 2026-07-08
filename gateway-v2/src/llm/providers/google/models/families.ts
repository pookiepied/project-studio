export function isGoogleChatModel(modelId: string, methods: string[] = []): boolean {
  return methods.includes("generateContent") && !isGoogleEmbeddingModel(modelId, methods) && !isGoogleTtsModel(modelId);
}

export function isGoogleEmbeddingModel(modelId: string, methods: string[] = []): boolean {
  return modelId.includes("embedding") || methods.includes("embedContent") || methods.includes("batchEmbedContents");
}

export function isGoogleImageModel(modelId: string, methods: string[] = []): boolean {
  return (
    modelId.includes("imagen") ||
    modelId.includes("image") ||
    modelId.includes("nano-banana") ||
    (methods.includes("predict") && /imagen|image|banana/.test(modelId))
  );
}

export function supportsGoogleImageEdit(modelId: string): boolean {
  return (
    modelId.includes("gemini") ||
    modelId.includes("nano-banana")
  ) && !modelId.includes("imagen");
}

export function isGoogleTtsModel(modelId: string): boolean {
  return modelId.includes("tts");
}

export function isIgnoredGoogleModel(modelId: string): boolean {
  return (
    modelId.includes("computer-use") ||
    modelId.includes("deep-research") ||
    modelId.includes("robotics") ||
    modelId.includes("antigravity") ||
    modelId.includes("veo") ||
    modelId.includes("live")
  );
}

export function supportsGoogleVision(modelId: string): boolean {
  return modelId.includes("gemini") && !modelId.includes("tts");
}

export function supportsGoogleTools(modelId: string): boolean {
  return modelId.includes("gemini") && !modelId.includes("image") && !modelId.includes("tts");
}

export function contextWindowForGoogleModel(inputTokenLimit: number | undefined, modelId: string): number {
  if (inputTokenLimit) return inputTokenLimit;
  if (/gemini-(2\.5|3|3\.1|3\.5)/.test(modelId)) return 1_000_000;
  return 32_000;
}

export function maxOutputForGoogleModel(outputTokenLimit: number | undefined): number {
  return outputTokenLimit ?? 8_192;
}
