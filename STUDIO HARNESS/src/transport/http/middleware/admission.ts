import type { Context, MiddlewareHandler } from "hono";

import type { AuthContext } from "../../../admission/context.js";
import type { AdmissionVerifier } from "../../../admission/verifier.js";
import { hasAdmissionScope, type AdmissionScope } from "../../../admission/scopes.js";

export const AUTH_CONTEXT = "authContext" as const;

export interface AdmissionEnv {
  Variables: {
    [AUTH_CONTEXT]: AuthContext;
  };
}

function unauthorized(context: Context<AdmissionEnv>): Response {
  return context.json(
    {
      error: "Harness admission is required.",
      code: "admission.unauthenticated",
    },
    401,
    { "WWW-Authenticate": "Bearer" },
  );
}

export function createAdmissionMiddleware(
  verifier: AdmissionVerifier,
): MiddlewareHandler<AdmissionEnv> {
  return async (context, next) => {
    const result = verifier.verify(context.req.header("Authorization"));
    if (!result.ok) return unauthorized(context);

    context.set(AUTH_CONTEXT, result.context);
    await next();
  };
}

export function requireAdmissionScope(
  scope: AdmissionScope,
): MiddlewareHandler<AdmissionEnv> {
  return async (context, next) => {
    const auth = context.get(AUTH_CONTEXT);
    if (!hasAdmissionScope(auth, scope)) {
      return context.json(
        {
          error: "The authenticated client is not authorized for this operation.",
          code: "admission.scope_required",
          scope,
        },
        403,
      );
    }

    await next();
  };
}

export function authContext(
  context: Context<AdmissionEnv>,
): AuthContext {
  return context.get(AUTH_CONTEXT);
}
