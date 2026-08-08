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

export async function saveRegistryModel(model: RegistryModel): Promise<{ accepted: boolean; persisted: boolean; message: string }> {
  try {
    const endpoints = await apiManager.getEndpoints();
    if (!endpoints.registryManagement) {
      return { accepted: false, persisted: false, message: "Registry management endpoint is unavailable; model was not saved." };
    }
    const response = await fetch(`${endpoints.registryManagement}/models`, {
      method: "POST",
      headers: await createHeaders(),
      body: JSON.stringify(model)
    });
    const payload = (await response.json().catch(() => ({}))) as {
      accepted?: boolean;
      persisted?: boolean;
      message?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      return { accepted: false, persisted: false, message: payload.error?.message ?? `Save failed with HTTP ${response.status}.` };
    }
    return {
      accepted: Boolean(payload.accepted),
      persisted: Boolean(payload.persisted),
      message: payload.message ?? "Model saved."
    };
  } catch (error) {
    logger.warn("RegistryManagement", "Live model save failed", error);
    return { accepted: false, persisted: false, message: "Save failed because the registry endpoint is unavailable." };
  }
}

export async function updateRegistryModel(model: RegistryModel): Promise<{ accepted: boolean; persisted: boolean; message: string }> {
  try {
    const endpoints = await apiManager.getEndpoints();
    if (!endpoints.registryManagement) {
      return { accepted: false, persisted: false, message: "Registry management endpoint is unavailable; model was not saved." };
    }
    const response = await fetch(`${endpoints.registryManagement}/models/${encodeURIComponent(model.id)}`, {
      method: "PUT",
      headers: await createHeaders(),
      body: JSON.stringify(model)
    });
    const payload = (await response.json().catch(() => ({}))) as {
      accepted?: boolean;
      persisted?: boolean;
      message?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      return { accepted: false, persisted: false, message: payload.error?.message ?? `Update failed with HTTP ${response.status}.` };
    }
    return {
      accepted: Boolean(payload.accepted),
      persisted: Boolean(payload.persisted),
      message: payload.message ?? "Model updated."
    };
  } catch (error) {
    logger.warn("RegistryManagement", "Live model update failed", error);
    return { accepted: false, persisted: false, message: "Update failed because the registry endpoint is unavailable." };
  }
}

export async function deleteRegistryModel(modelId: string): Promise<{ deleted: boolean; message: string }> {
  try {
    const endpoints = await apiManager.getEndpoints();
    if (!endpoints.registryManagement) {
      return { deleted: false, message: "Registry management endpoint is unavailable; model was not deleted." };
    }
    const response = await fetch(`${endpoints.registryManagement}/models/${encodeURIComponent(modelId)}`, {
      method: "DELETE",
      headers: await createHeaders()
    });
    const payload = (await response.json().catch(() => ({}))) as {
      deleted?: boolean;
      message?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      return { deleted: false, message: payload.error?.message ?? `Delete failed with HTTP ${response.status}.` };
    }
    return {
      deleted: Boolean(payload.deleted),
      message: payload.message ?? "Model deleted."
    };
  } catch (error) {
    logger.warn("RegistryManagement", "Live model delete failed", error);
    return { deleted: false, message: "Delete failed because the registry endpoint is unavailable." };
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
