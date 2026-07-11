import { GatewayError } from "../../core/errors";
import type { RegistryModel } from "../../registry/schema";
import { validateRegistry } from "../../registry/validate";
import { getModelRegistry } from "../../registry";

export function assertRegistryModelPayload(payload: unknown): RegistryModel {
  if (!payload || typeof payload !== "object") {
    throw new GatewayError("VALIDATION_ERROR", "Registry model payload must be an object.");
  }
  const model = payload as RegistryModel;
  const candidateRegistry = {
    ...getModelRegistry(),
    models: [model]
  };
  validateRegistry(candidateRegistry);
  return model;
}

export function validateRegistryModelsPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    throw new GatewayError("VALIDATION_ERROR", "Payload must be an object.");
  }
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) {
    throw new GatewayError("VALIDATION_ERROR", "Payload must include a models array.");
  }
  validateRegistry({ ...getModelRegistry(), models: models as RegistryModel[] });
  return models as RegistryModel[];
}
