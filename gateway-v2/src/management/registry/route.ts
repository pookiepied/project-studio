import { Hono } from "hono";
import type { Context, Next } from "hono";
import { GatewayError, toErrorResponse } from "../../core/errors";
import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import {
  exportRegistry,
  listRegistryModels,
  readRegistryModel,
  replacePersistedRegistryModels,
  upsertRegistryModel
} from "./repository";
import { registryManagementSchema } from "./schema";
import { assertRegistryModelPayload, validateRegistryModelsPayload } from "./validators";

export const registryManagementRoute = new Hono<{ Bindings: GatewayEnv }>();

registryManagementRoute.use("*", requireRegistryManagementToken);

async function requireRegistryManagementToken(c: Context<{ Bindings: GatewayEnv }>, next: Next) {
  const expectedToken = c.env.REGISTRY_MANAGEMENT_TOKEN;
  if (!expectedToken) {
    if (c.env.ENVIRONMENT === "production") {
      return toErrorResponse(
        new GatewayError("PROVIDER_UNAVAILABLE", "Registry management is not configured for this gateway.", {
          status: 503
        })
      );
    }
    return next();
  }

  const token = c.req.header("x-studio-registry-management-token");
  if (token !== expectedToken) {
    return toErrorResponse(
      new GatewayError("VALIDATION_ERROR", "Registry management token is invalid or missing.", { status: 403 })
    );
  }
  return next();
}

registryManagementRoute.get("/models", async (c) => {
  try {
    return c.json({ object: "list", data: await listRegistryModels(c.env) });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.get("/models/:id", async (c) => {
  try {
    const model = await readRegistryModel(c.env, decodeURIComponent(c.req.param("id")));
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
    const model = await assertRegistryModelPayload(c.env, await c.req.json());
    const persistedModels = await upsertRegistryModel(c.env, model);
    return c.json({
      object: "registry.model",
      accepted: true,
      persisted: true,
      persistedModelCount: persistedModels.length,
      message: "Model saved to the curated registry override store.",
      data: model
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.put("/models/:id", async (c) => {
  try {
    const id = decodeURIComponent(c.req.param("id"));
    const model = await assertRegistryModelPayload(c.env, await c.req.json());
    if (model.id !== id) {
      throw new GatewayError("VALIDATION_ERROR", "Route id must match model.id.");
    }
    const persistedModels = await upsertRegistryModel(c.env, model);
    return c.json({
      object: "registry.model",
      accepted: true,
      persisted: true,
      persistedModelCount: persistedModels.length,
      message: "Model saved to the curated registry override store.",
      data: model
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.post("/import", async (c) => {
  try {
    const models = await validateRegistryModelsPayload(c.env, await c.req.json());
    const persistedModels = await replacePersistedRegistryModels(c.env, models);
    return c.json({
      object: "registry.import",
      accepted: true,
      persisted: true,
      modelCount: models.length,
      persistedModelCount: persistedModels.length,
      message: "Import saved to the curated registry override store."
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.post("/validate", async (c) => {
  try {
    const models = await validateRegistryModelsPayload(c.env, await c.req.json());
    return c.json({ object: "registry.validation", valid: true, modelCount: models.length });
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.get("/export", async (c) => {
  try {
    return c.json(await exportRegistry(c.env));
  } catch (error) {
    return toErrorResponse(error);
  }
});

registryManagementRoute.get("/schema", (c) => c.json(registryManagementSchema));
