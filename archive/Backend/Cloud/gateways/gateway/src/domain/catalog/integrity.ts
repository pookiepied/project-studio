import { GatewayError } from "@/platform/errors";
import type { ModelRegistry, RegistryModel } from "./schema";

export function validateRegistry(registry: ModelRegistry): void {
  const ids = new Set<string>();
  for (const model of registry.models) {
    assertString(model.id, "model.id");
    assertString(model.provider, `${model.id}.provider`);
    assertString(model.providerModelId, `${model.id}.providerModelId`);
    if (ids.has(model.id)) {
      throw new GatewayError("VALIDATION_ERROR", `Duplicate registry model id: ${model.id}`);
    }
    ids.add(model.id);
    if (!model.capabilities.modalities.length) {
      throw new GatewayError("VALIDATION_ERROR", `Registry model ${model.id} has no modalities.`);
    }
    if (!model.registry.endpoints.length) {
      throw new GatewayError("VALIDATION_ERROR", `Registry model ${model.id} has no endpoints.`);
    }
    assertString(model.registry.source.checkedAt, `${model.id}.registry.source.checkedAt`);
    assertString(model.registry.pricing.kind, `${model.id}.registry.pricing.kind`);
    assertString(model.registry.pricing.status, `${model.id}.registry.pricing.status`);
    assertString(model.registry.pricing.currency, `${model.id}.registry.pricing.currency`);
    assertString(model.registry.pricing.billingUnit, `${model.id}.registry.pricing.billingUnit`);
    if (!Array.isArray(model.registry.pricing.sourceUrls)) {
      throw new GatewayError("VALIDATION_ERROR", `Registry field ${model.id}.registry.pricing.sourceUrls must be an array.`);
    }
  }

  for (const model of registry.models) {
    for (const fallbackId of model.registry.fallbackModelIds) {
      if (!ids.has(fallbackId)) {
        throw new GatewayError("VALIDATION_ERROR", `Registry model ${model.id} has unknown fallback ${fallbackId}.`);
      }
    }
  }
}

export function findRegistryModel(models: RegistryModel[], requestedModel: string): RegistryModel | undefined {
  return (
    models.find((model) => model.id === requestedModel) ??
    models.find((model) => model.providerModelId === requestedModel) ??
    models.find((model) => model.registry.aliases.includes(requestedModel))
  );
}

function assertString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new GatewayError("VALIDATION_ERROR", `Registry field ${path} must be a non-empty string.`);
  }
}
