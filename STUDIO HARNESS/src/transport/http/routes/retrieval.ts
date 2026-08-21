import { Hono } from "hono";
import * as v from "valibot";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { authContext, requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import { ProviderConfigurationError } from "../../../contracts/models.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import type { RetrievalAdministration } from "../../../application/retrieval-management.js";

/**
 * The retrieval settings surface, under the provider tree and behind the
 * provider-management scope — no new scope, because managing a search key and
 * managing a model key are the same trust decision.
 *
 * The hard rule of every provider route holds here too: a request body may
 * carry a key; no response body ever contains one. The list answers
 * "set or absent" per provider, never the value.
 */

const capabilitySchema = v.picklist(["search", "reader"]);
const slotSchema = v.picklist(["primary", "fallback"]);

const keyBodySchema = v.object({
  apiKey: v.pipe(v.string(), v.minLength(1)),
});

const slotBodySchema = v.union([
  v.null(),
  v.object({ providerId: v.pipe(v.string(), v.minLength(1)) }),
]);

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

function parseParam<T>(
  schema: v.GenericSchema<T>,
  value: string,
  field: string,
): T {
  const result = v.safeParse(schema, value);
  if (!result.success) {
    throw new ProviderConfigurationError(`${field} is not valid.`);
  }
  return result.output;
}

export function createRetrievalRoutes(
  retrieval: RetrievalAdministration,
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROVIDER_MANAGEMENT));

  routes.get("/", async (context) =>
    context.json(await retrieval.listRetrieval()),
  );

  routes.put("/providers/:providerId/key", async (context) => {
    try {
      const parsed = v.safeParse(keyBodySchema, await body(context));
      if (!parsed.success) {
        throw new ProviderConfigurationError(
          "The retrieval key body must be { \"apiKey\": \"...\" }.",
        );
      }
      await retrieval.setRetrievalKey(
        context.req.param("providerId"),
        parsed.output.apiKey,
        authContext(context),
      );
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/providers/:providerId/key", async (context) => {
    try {
      await retrieval.clearRetrievalKey(
        context.req.param("providerId"),
        authContext(context),
      );
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.put("/slots/:capability/:slot", async (context) => {
    try {
      const capability = parseParam(
        capabilitySchema,
        context.req.param("capability"),
        "Retrieval capability",
      );
      const slot = parseParam(slotSchema, context.req.param("slot"), "Retrieval slot");

      const parsed = v.safeParse(slotBodySchema, await body(context));
      if (!parsed.success) {
        throw new ProviderConfigurationError(
          "The retrieval slot body must be { \"providerId\": \"...\" } or null.",
        );
      }

      await retrieval.setRetrievalSlot(
        capability,
        slot,
        parsed.output === null ? undefined : parsed.output.providerId,
        authContext(context),
      );
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/slots/:capability/:slot", async (context) => {
    try {
      const capability = parseParam(
        capabilitySchema,
        context.req.param("capability"),
        "Retrieval capability",
      );
      const slot = parseParam(slotSchema, context.req.param("slot"), "Retrieval slot");
      await retrieval.setRetrievalSlot(capability, slot, undefined, authContext(context));
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  return routes;
}
