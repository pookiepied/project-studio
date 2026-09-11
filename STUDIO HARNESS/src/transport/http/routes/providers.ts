import { Hono } from "hono";
import * as v from "valibot";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { authContext, requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import {
  modelCapabilitySchema,
  ProviderConfigurationError,
  reasoningLevelSchema,
} from "../../../contracts/models.js";
import {
  capabilitySlotSchema,
  invocationShapeSchema,
  languageProtocolSchema,
  mediaProtocolSchema,
  modelPricingSchema,
  providerConnectionSchema,
  providerKindSchema,
  retrievalProtocolSchema,
  type ConnectionServesPatch,
  type LanguageProtocol,
  type MediaProtocol,
  type ProviderConnectionDraft,
  type ProviderConnectionPatch,
  type RetrievalProtocol,
} from "../../../contracts/providers.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import type {
  ManualModelInput,
} from "../../../gateway/connections/model-catalog.js";
import type { ProviderAdministration } from "../../../gateway/connections/management.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A connection as a request supplies it: the settled contract's shape plus an
 * optional key. The schema parse strips `apiKey` and every other unknown key,
 * so the draft handed onward is exactly the contract — the key travels beside
 * it to the credential store and never enters the record.
 */
function connectionDraft(value: unknown): ProviderConnectionDraft {
  if (!isRecord(value)) {
    throw new ProviderConfigurationError(
      "The provider connection body must be an object.",
    );
  }

  const apiKey = value["apiKey"];
  if (apiKey !== undefined && typeof apiKey !== "string") {
    throw new ProviderConfigurationError("apiKey must be text.");
  }

  const result = v.safeParse(providerConnectionSchema, {
    ...value,
    credential: "absent",
  });
  if (!result.success) {
    throw new ProviderConfigurationError(
      "Provider connection does not match the provider contract.",
    );
  }

  const { credential: _status, ...connection } = result.output;
  return { ...connection, ...(apiKey === undefined ? {} : { apiKey }) };
}

const connectionPatchSchema = v.object({
  displayName: v.optional(v.pipe(v.string(), v.minLength(1))),
  // null clears the base URL; undefined (absent key) leaves it alone. The
  // contract documents the same distinction — the wire repeats it so a null
  // is validated rather than smuggled.
  baseUrl: v.optional(v.nullable(v.pipe(v.string(), v.minLength(1)))),
  enabled: v.optional(v.boolean()),
  // Per kind, the same three-way rule as baseUrl: a protocol adds or
  // re-wires the kind, null removes it, an absent key leaves it alone.
  serves: v.optional(
    v.object({
      language: v.optional(v.nullable(languageProtocolSchema)),
      media: v.optional(v.nullable(mediaProtocolSchema)),
      retrieval: v.optional(v.nullable(retrievalProtocolSchema)),
    }),
  ),
  apiKey: v.optional(v.string()),
});

/** A serves patch with its absent keys dropped, so undefined never travels. */
function presentKeys(serves: {
  readonly language?: LanguageProtocol | null | undefined;
  readonly media?: MediaProtocol | null | undefined;
  readonly retrieval?: RetrievalProtocol | null | undefined;
}): ConnectionServesPatch {
  return {
    ...(serves.language === undefined ? {} : { language: serves.language }),
    ...(serves.media === undefined ? {} : { media: serves.media }),
    ...(serves.retrieval === undefined ? {} : { retrieval: serves.retrieval }),
  };
}

function connectionPatch(value: unknown): ProviderConnectionPatch {
  const result = v.safeParse(connectionPatchSchema, value);
  if (!result.success) {
    throw new ProviderConfigurationError(
      "Provider connection update is not valid.",
    );
  }
  const parsed = result.output;
  return {
    ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName }),
    ...(parsed.baseUrl === undefined ? {} : { baseUrl: parsed.baseUrl }),
    ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
    ...(parsed.serves === undefined ? {} : { serves: presentKeys(parsed.serves) }),
    ...(parsed.apiKey === undefined ? {} : { apiKey: parsed.apiKey }),
  };
}

const manualModelSchema = v.object({
  modelId: v.pipe(v.string(), v.minLength(1)),
  displayName: v.pipe(v.string(), v.minLength(1)),
  capability: v.optional(v.partial(modelCapabilitySchema)),
  // The model's own levels, chosen against the contract's vocabulary - not a
  // fixed dial, so a model that reasons only at low and medium says so.
  reasoningLevels: v.optional(v.array(reasoningLevelSchema)),
  pricing: v.optional(v.partial(modelPricingSchema)),
  shape: v.optional(invocationShapeSchema),
});

function manualModelInput(value: unknown): ManualModelInput {
  const result = v.safeParse(manualModelSchema, value);
  if (!result.success) {
    throw new ProviderConfigurationError(
      "Manual provider model does not match the provider contract.",
    );
  }
  const parsed = result.output;
  return {
    modelId: parsed.modelId,
    displayName: parsed.displayName,
    ...(parsed.capability === undefined ? {} : { capability: parsed.capability }),
    ...(parsed.reasoningLevels === undefined
      ? {}
      : { reasoningLevels: parsed.reasoningLevels }),
    ...(parsed.pricing === undefined ? {} : { pricing: parsed.pricing }),
    ...(parsed.shape === undefined ? {} : { shape: parsed.shape }),
  };
}

const selectionBodySchema = v.object({
  modelIds: v.array(v.pipe(v.string(), v.minLength(1))),
});

const overridePatchSchema = v.object({
  displayName: v.optional(v.pipe(v.string(), v.minLength(1))),
  hidden: v.optional(v.boolean()),
});

function overridePatch(value: unknown): { displayName?: string; hidden?: boolean } {
  const result = v.safeParse(overridePatchSchema, value);
  if (!result.success) {
    throw new ProviderConfigurationError(
      "Provider model override is not valid.",
    );
  }
  const parsed = result.output;
  return {
    ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName }),
    ...(parsed.hidden === undefined ? {} : { hidden: parsed.hidden }),
  };
}

const defaultReferenceSchema = v.object({
  connectionId: v.pipe(v.string(), v.minLength(1)),
  modelId: v.pipe(v.string(), v.minLength(1)),
});

const defaultBodySchema = v.union([v.null(), defaultReferenceSchema]);

async function body(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new ProviderConfigurationError("The request body must be valid JSON.");
  }
}

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}

function parseQuery<T>(
  schema: v.GenericSchema<T>,
  value: string,
  field: string,
): T {
  const result = v.safeParse(schema, value);
  if (!result.success) {
    throw new ProviderConfigurationError(`${field} is not a valid filter.`);
  }
  return result.output;
}

export function createProviderRoutes(
  providers: ProviderAdministration,
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROVIDER_MANAGEMENT));

  routes.get("/connections", async (context) =>
    context.json(await providers.listConnections()),
  );

  routes.get("/library", async (context) =>
    context.json(await providers.listLibrary()),
  );

  routes.get("/icons/:id", async (context) => {
    try {
      const svg = await providers.getProviderIcon(context.req.param("id"));
      if (svg === undefined) {
        return context.json(
          { error: "No provider icon is known for that id.", code: "providers.icons.unknown" },
          404,
        );
      }
      return context.json({ svg });
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.put("/connections/:id/model-selection", async (context) => {
    try {
      const parsed = v.safeParse(selectionBodySchema, await body(context));
      if (!parsed.success) {
        throw new ProviderConfigurationError(
          "Provider model selection is not valid.",
        );
      }
      await providers.setModelSelection(
        context.req.param("id"),
        parsed.output.modelIds,
        authContext(context),
      );
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.post("/connections", async (context) => {
    try {
      const connection = await providers.addConnection(
        connectionDraft(await body(context)),
        authContext(context),
      );
      return context.json(connection, 201);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.patch("/connections/:id", async (context) => {
    try {
      const id = context.req.param("id");
      const current = await providers.getConnection(id);
      if (current === undefined) {
        return context.json({ error: "That provider connection does not exist." }, 404);
      }
      const connection = await providers.updateConnection(
        id,
        connectionPatch(await body(context)),
        authContext(context),
      );
      return context.json(connection);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/connections/:id", async (context) => {
    try {
      await providers.removeConnection(context.req.param("id"), authContext(context));
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.post("/connections/:id/probe", async (context) => {
    try {
      const id = context.req.param("id");
      const current = await providers.getConnection(id);
      if (current === undefined) {
        return context.json({ error: "That provider connection does not exist." }, 404);
      }
      // A refused key or a dead endpoint is a 200 with ok:false — the probe
      // succeeded as a probe; only a missing connection is a 404 above or a
      // malformed request a 400 below.
      return context.json(await providers.probeConnection(id, authContext(context)));
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.get("/models", async (context) => {
    try {
      const connectionId = context.req.query("connectionId");
      const kind = context.req.query("kind");
      const capability = context.req.query("capability");
      const models = await providers.listModels({
        ...(connectionId === undefined ? {} : { connectionId }),
        ...(kind === undefined
          ? {}
          : { kind: parseQuery(providerKindSchema, kind, "kind") }),
        ...(capability === undefined
          ? {}
          : { capability: parseQuery(capabilitySlotSchema, capability, "capability") }),
      });
      return context.json(models);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.post("/connections/:id/models", async (context) => {
    try {
      const model = await providers.addManualModel(
        context.req.param("id"),
        manualModelInput(await body(context)),
        authContext(context),
      );
      return context.json(model, 201);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  // `:modelId{.+}` rather than `:modelId`: model ids carry slashes themselves
  // (OpenRouter's are vendor/model), and a single-segment param would 404 on
  // every one of them.
  routes.patch("/connections/:id/models/:modelId{.+}", async (context) => {
    try {
      const model = await providers.setModelOverride(
        context.req.param("id"),
        context.req.param("modelId"),
        overridePatch(await body(context)),
        authContext(context),
      );
      return context.json(model);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/connections/:id/models/:modelId{.+}", async (context) => {
    try {
      await providers.removeModel(
        context.req.param("id"),
        context.req.param("modelId"),
        authContext(context),
      );
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.get("/defaults", async (context) =>
    context.json(await providers.getDefaults()),
  );

  routes.put("/defaults/:slot", async (context) => {
    try {
      const slotResult = v.safeParse(
        capabilitySlotSchema,
        context.req.param("slot"),
      );
      if (!slotResult.success) {
        throw new ProviderConfigurationError(
          "Provider default slot is not valid.",
        );
      }

      const parsed = v.safeParse(defaultBodySchema, await body(context));
      if (!parsed.success) {
        throw new ProviderConfigurationError(
          "Provider default reference is not valid.",
        );
      }

      await providers.setDefault(
        slotResult.output,
        parsed.output ?? undefined,
        authContext(context),
      );
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/defaults/:slot", async (context) => {
    try {
      const slotResult = v.safeParse(
        capabilitySlotSchema,
        context.req.param("slot"),
      );
      if (!slotResult.success) {
        throw new ProviderConfigurationError(
          "Provider default slot is not valid.",
        );
      }
      await providers.setDefault(slotResult.output, undefined, authContext(context));
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  return routes;
}
