export interface ParsedModelId {
  provider: string;
  modelId: string;
}

export function parseModelId(modelId: string): ParsedModelId {
  const parts = modelId.split(":");
  const provider = parts[0];
  const modelIdPart = parts.slice(1).join(":");

  if (!provider || !modelIdPart) {
    throw new Error(`Invalid model format: ${modelId}. Expected "provider:model-id"`);
  }

  return {
    provider,
    modelId: modelIdPart,
  };
}
