import { createHeaders } from "@/lib/api";
import { apiManager } from "@/core/network/apiManager";
import { logger } from "@/core/logging/logger";
import { curatedRegistrySnapshot } from "./curatedRegistrySnapshot";
import type { ModelRegistry, RegistryManagementSchema, RegistryModel } from "./types";

export interface RegistryLoadResult {
  models: RegistryModel[];
  registry: ModelRegistry;
  source: "live" | "snapshot";
}

const DEFAULT_SCHEMA: RegistryManagementSchema = {
  modelTypes: [
    "text.chat",
    "image.generation",
    "image.editing",
    "video.generation",
    "audio.speech",
    "audio.transcription",
    "audio.generation",
    "embeddings",
    "reranking",
    "specialized"
  ],
  statuses: ["active", "preview", "beta", "experimental", "deprecated", "disabled"],
  capabilities: ["chat", "embeddings", "transcription", "speech", "image.generate", "image.edit", "video.generate", "audio.generate", "rerank"],
  pricing: {
    kinds: ["token", "image", "video", "audio", "embedding", "rerank", "runtime", "custom"],
    statuses: ["verified", "unknown", "not_applicable", "estimated", "provider_variable"],
    units: [
      "one_million_tokens",
      "image",
      "megapixel",
      "generation",
      "video_second",
      "audio_minute",
      "audio_hour",
      "character",
      "prediction",
      "compute_second",
      "credit",
      "request",
      "not_applicable"
    ]
  },
  reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"]
};

export async function loadRegistryModels(): Promise<RegistryLoadResult> {
  try {
    const endpoints = await apiManager.getEndpoints();
    if (!endpoints.registryManagement) return snapshotResult();
    const response = await fetch(`${endpoints.registryManagement}/export`, {
      headers: await createHeaders()
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const registry = (await response.json()) as ModelRegistry;
    return {
      registry,
      models: registry.data ?? registry.models ?? [],
      source: "live"
    };
  } catch (error) {
    logger.warn("RegistryManagement", "Falling back to curated registry snapshot", error);
    return snapshotResult();
  }
}

export async function loadRegistrySchema(): Promise<RegistryManagementSchema> {
  try {
    const endpoints = await apiManager.getEndpoints();
    if (!endpoints.registryManagement) return DEFAULT_SCHEMA;
    const response = await fetch(`${endpoints.registryManagement}/schema`, {
      headers: await createHeaders()
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as RegistryManagementSchema;
  } catch (error) {
    logger.warn("RegistryManagement", "Using local registry schema fallback", error);
    return DEFAULT_SCHEMA;
  }
}

export async function validateRegistryModel(model: RegistryModel): Promise<{ accepted: boolean; message: string }> {
  try {
    const endpoints = await apiManager.getEndpoints();
    if (!endpoints.registryManagement) {
      return { accepted: true, message: "Draft looks complete locally. Live validation is unavailable." };
    }
    const response = await fetch(`${endpoints.registryManagement}/models`, {
      method: "POST",
      headers: await createHeaders(),
      body: JSON.stringify(model)
    });
    const payload = (await response.json().catch(() => ({}))) as { accepted?: boolean; message?: string; error?: { message?: string } };
    if (!response.ok) {
      return { accepted: false, message: payload.error?.message ?? `Validation failed with HTTP ${response.status}.` };
    }
    return { accepted: Boolean(payload.accepted), message: payload.message ?? "Draft is valid." };
  } catch (error) {
    logger.warn("RegistryManagement", "Live model validation failed", error);
    return { accepted: true, message: "Draft kept locally. Live validation endpoint is unavailable." };
  }
}

function snapshotResult(): RegistryLoadResult {
  const registry = curatedRegistrySnapshot as unknown as ModelRegistry;
  return {
    registry,
    models: registry.data ?? registry.models ?? [],
    source: "snapshot"
  };
}
