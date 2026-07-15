import { logger } from "@/core/logging/logger";
import { apiManager } from "@/core/network/apiManager";
import { createHeaders } from "@/lib/api";
import type {
  CanonicalTranscriptFetchOptions,
  CanonicalTranscriptProjection,
} from "./types";

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

export async function fetchRenderableTranscriptProjection({
  conversationId,
  branchId = "main",
  limit,
  signal,
}: CanonicalTranscriptFetchOptions): Promise<CanonicalTranscriptProjection> {
  const endpoints = await apiManager.getEndpoints();
  if (!endpoints.cloud.transcripts) throw new Error("Cloud transcript API is not configured.");
  const url = `${endpoints.cloud.transcripts}/renderable${query({
    conversationId,
    branchId,
    limit,
  })}`;

  logger.debug("CanonicalTranscript", "Fetching renderable projection", {
    conversationId,
    branchId,
    limit,
  });

  const response = await fetch(url, {
    headers: await createHeaders(),
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      typeof body?.error === "string"
        ? body.error
        : `Failed to load transcript projection (${response.status})`;
    throw new Error(message);
  }

  return response.json() as Promise<CanonicalTranscriptProjection>;
}
