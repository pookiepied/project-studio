import { GatewayError } from "../../core/errors";
import { providers } from "../../core/registry";
import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import type { RegistryModel } from "../../registry/schema";
import { validateRegistry } from "../../registry/validate";
import { getModelRegistryForEnv, mergeRegistryModels } from "../../registry";

export async function assertRegistryModelPayload(env: GatewayEnv, payload: unknown): Promise<RegistryModel> {
  if (!payload || typeof payload !== "object") {
    throw new GatewayError("VALIDATION_ERROR", "Registry model payload must be an object.");
  }
  const model = payload as RegistryModel;
  assertKnownProvider(model);
  const registry = await getModelRegistryForEnv(env);
  const candidateRegistry = {
    ...registry,
    models: [...registry.models.filter((candidate) => candidate.id !== model.id), model]
  };
  validateRegistry(candidateRegistry);
  return model;
}

export async function validateRegistryModelsPayload(env: GatewayEnv, payload: unknown) {
  if (!payload || typeof payload !== "object") {
    throw new GatewayError("VALIDATION_ERROR", "Payload must be an object.");
  }
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) {
    throw new GatewayError("VALIDATION_ERROR", "Payload must include a models array.");
  }
  for (const model of models as RegistryModel[]) {
    assertKnownProvider(model);
  }
  const registry = await getModelRegistryForEnv(env);
  validateRegistry({ ...registry, models: mergeRegistryModels(registry.models, models as RegistryModel[]) });
  return models as RegistryModel[];
}

function assertKnownProvider(model: RegistryModel): void {
  if (!providers.some((provider) => provider.id === model.provider)) {
    throw new GatewayError(
      "VALIDATION_ERROR",
      `Provider ${model.provider} is not a configured gateway provider. Provider onboarding is handled separately.`
    );
  }
}
