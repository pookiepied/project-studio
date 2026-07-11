import { Hono } from "hono";
import { GatewayError, toErrorResponse } from "../../core/errors";
import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import { exportRegistry, listRegistryModels, readRegistryModel } from "./repository";
import { registryManagementSchema } from "./schema";
import { assertRegistryModelPayload, validateRegistryModelsPayload } from "./validators";

export const registryManagementRoute = new Hono<{ Bindings: GatewayEnv }>();

registryManagementRoute.get("/models", (c) => {
  try {
    return c.json({ object: "list", data: listRegistryModels() });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.get("/models/:id", (c) => {
  try {
    const model = readRegistryModel(decodeURIComponent(c.req.param("id")));
    if (!model) {
      throw new GatewayError("MODEL_NOT_FOUND", "Registry model was not found.");
    }
    return c.json({ object: "registry.model", data: model });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.post("/models", async (c) => {
  try {
    const model = assertRegistryModelPayload(await c.req.json());
    return c.json({
      object: "registry.validation",
      accepted: true,
      persisted: false,
      message: "Model payload is valid. Persistence is intentionally deferred until registry storage is added.",
      data: model
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.put("/models/:id", async (c) => {
  try {
    const id = decodeURIComponent(c.req.param("id"));
    const model = assertRegistryModelPayload(await c.req.json());
    if (model.id !== id) {
      throw new GatewayError("VALIDATION_ERROR", "Route id must match model.id.");
    }
    return c.json({
      object: "registry.validation",
      accepted: true,
      persisted: false,
      message: "Model update payload is valid. Persistence is intentionally deferred until registry storage is added.",
      data: model
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.post("/import", async (c) => {
  try {
    const models = validateRegistryModelsPayload(await c.req.json());
    return c.json({
      object: "registry.validation",
      accepted: true,
      persisted: false,
      modelCount: models.length,
      message: "Import payload is valid. Persistence is intentionally deferred until registry storage is added."
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.post("/validate", async (c) => {
  try {
    const models = validateRegistryModelsPayload(await c.req.json());
    return c.json({ object: "registry.validation", valid: true, modelCount: models.length });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.get("/export", (c) => {
  try {
    return c.json(exportRegistry());
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.get("/schema", (c) => c.json(registryManagementSchema));
