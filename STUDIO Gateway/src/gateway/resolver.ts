/**
 * Gateway resolver — canonical location for request-time model/provider resolution.
 * Handles model lookup, provider lookup, credential decrypt, reasoning parsing, vision guard.
 * Catalog owns ingestion (sync/discovery/repository); gateway owns request-time resolution.
 */

import { findExposedModel, getProvider, getCredential } from "../infra/db.ts";
import { decrypt } from "../infra/encryption.ts";
import { modelNotFound, modelNotExposed, providerNotConfigured, notImplemented, badRequest } from "../lib/errors.ts";
import { isProtocol } from "../providers/types.ts";
import type { ReasoningRequest } from "../providers/contract.ts";

export const REASONING_BUDGET_MIN_TOKENS = 1;
export const REASONING_BUDGET_MAX_TOKENS = 128_000;
export const REASONING_ADAPTIVE_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const REASONING_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

function validateBudgetTokens(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw badRequest("budgetTokens must be an integer");
  if (value < REASONING_BUDGET_MIN_TOKENS || value > REASONING_BUDGET_MAX_TOKENS) throw badRequest(`budgetTokens must be between ${REASONING_BUDGET_MIN_TOKENS} and ${REASONING_BUDGET_MAX_TOKENS}`);
  return value;
}

export async function resolveModelAndProvider(db: D1Database, modelId: string) {
  const model = await findExposedModel(db, modelId);
  if (!model) {
    const any = await db.prepare("SELECT 1 FROM models WHERE model_id = ?").bind(modelId).first();
    if (any) throw modelNotExposed(modelId);
    throw modelNotFound(modelId);
  }
  const provider = await getProvider(db, model.provider_id);
  if (!provider || !provider.enabled) throw providerNotConfigured(model.provider_id);
  if (!provider.base_url) throw providerNotConfigured(provider.id);
  if (!isProtocol(provider.protocol)) throw notImplemented(`Provider ${provider.id} has no supported protocol`);
  return { model, provider };
}

export async function getApiKey(db: D1Database, providerId: string, encryptionKey: string | undefined): Promise<string> {
  const cred = await getCredential(db, providerId);
  if (!cred) throw providerNotConfigured(providerId);
  if (!encryptionKey) throw providerNotConfigured(providerId);
  return decrypt(cred.encrypted_key, encryptionKey);
}

export function parseReasoning(body: Record<string, unknown>): ReasoningRequest | undefined {
  if (typeof body.reasoning === "string") {
    const v = body.reasoning as string;
    if ((REASONING_ADAPTIVE_LEVELS as readonly string[]).includes(v) || v === "none") {
      return v === "none" ? { mode: "none" } : { mode: "adaptive", level: v as never };
    }
    if (v !== "none") throw badRequest(`Invalid reasoning level: ${v}`);
  }
  if (typeof body.reasoning_effort === "string") {
    const v = body.reasoning_effort as string;
    if (v === "none") return { mode: "none" };
    if ((REASONING_EFFORT_LEVELS as readonly string[]).includes(v)) return { mode: "adaptive", level: v as never };
    throw badRequest(`Invalid reasoning_effort: ${v}`);
  }
  if (typeof (body as { budgetTokens?: unknown }).budgetTokens !== "undefined") {
    const bt = (body as { budgetTokens?: unknown }).budgetTokens;
    return { mode: "budget", budgetTokens: validateBudgetTokens(bt) };
  }
  if (body.reasoning && typeof body.reasoning === "object" && "budgetTokens" in (body.reasoning as Record<string, unknown>)) {
    const b = (body.reasoning as { budgetTokens?: unknown }).budgetTokens;
    return { mode: "budget", budgetTokens: validateBudgetTokens(b) };
  }
  return undefined;
}

const VISION_BLOCK_TYPES = new Set(["image_url", "image", "file", "document", "pdf", "inlineData", "input_image", "input_file"]);
const VISION_MEDIA_PREFIXES = ["image/", "application/pdf"] as const;

function isVisionBlock(block: Record<string, unknown>): boolean {
  const type = (block.type as string | undefined)?.toLowerCase();
  if (type && VISION_BLOCK_TYPES.has(type)) return true;
  if (block.image_url) return true;
  if (block.image) return true;
  if (block.file) return true;
  if (block.document) return true;
  if (block.source && typeof block.source === "object") {
    const src = block.source as Record<string, unknown>;
    const mediaType = (src.media_type as string | undefined) ?? (src.mediaType as string | undefined);
    if (typeof mediaType === "string" && VISION_MEDIA_PREFIXES.some((p) => mediaType.toLowerCase().startsWith(p))) return true;
  }
  if (block.inlineData && typeof block.inlineData === "object") return true;
  for (const v of Object.values(block)) {
    if (typeof v === "string" && v.startsWith("data:")) {
      const lower = v.toLowerCase();
      if (lower.startsWith("data:image/") || lower.startsWith("data:application/pdf")) return true;
    }
    if (typeof v === "object" && v !== null) {
      const obj = v as Record<string, unknown>;
      if (typeof obj.url === "string" && obj.url.startsWith("data:")) {
        const lower = obj.url.toLowerCase();
        if (lower.startsWith("data:image/") || lower.startsWith("data:application/pdf")) return true;
      }
    }
  }
  return false;
}

export function needsVisionFallback(model: { supports_vision: number }, body: Record<string, unknown>): boolean {
  if (model.supports_vision === 1) return false;
  const messages = body.messages as unknown;
  if (!Array.isArray(messages)) return false;
  for (const m of messages as Array<{ content?: unknown }>) {
    const content = (m as { content?: unknown }).content;
    if (typeof content === "string") {
      const lower = content.toLowerCase();
      if (lower.includes("data:image/") || lower.includes("data:application/pdf")) return true;
      continue;
    }
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (isVisionBlock(block)) return true;
      }
    }
  }
  return false;
}
