import type { Context, MiddlewareHandler } from "hono";

import type { AuthContext } from "../../../admission/context.js";
import type { AdmissionVerifier } from "../../../admission/verifier.js";
import { hasAdmissionScope, type AdmissionScope } from "../../../admission/scopes.js";
import {
  createRootExecutionContext,
  runWithExecutionContext,
  type ExecutionContext,
} from "../../../execution/context.js";
import { isStudioUuid } from "../../../contracts/uuid.js";
import { STUDIO_AGENT_ID } from "../../../contracts/agents.js";
import { bindObservationContext, createObservationWriter } from "../../../observability/recorder.js";
import { forgetProvisionalInvocation, rememberInvocation } from "../../../observability/invocations.js";
import { performance } from "node:perf_hooks";

const AUTH_CONTEXT = "authContext" as const;
const EXECUTION_CONTEXT = "executionContext" as const;

export interface AdmissionEnv {
  Variables: {
    [AUTH_CONTEXT]: AuthContext;
    [EXECUTION_CONTEXT]: ExecutionContext;
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
    const header = context.req.header("X-Project-Studio-Request-Id");
    const execution = bindObservationContext(createRootExecutionContext({
      ...(isStudioUuid(header) ? { requestId: header } : {}),
      clientId: result.context.clientId,
      sessionId: result.context.sessionId,
    }));
    context.set(EXECUTION_CONTEXT, execution);
    context.header("X-Project-Studio-Request-Id", execution.requestId);
    return runWithExecutionContext(execution, async () => {
      // Reading/control must not generate observations of itself.
      if (/^\/api\/(diagnostics|observations)(\/|$)/.test(context.req.path)) return next();
      const recordObservation = createObservationWriter();
      const started = performance.now();
      const match = /^\/agents\/([a-zA-Z0-9_-]{1,128})\/([a-zA-Z0-9_-]{1,256})(\/.*)?$/.exec(context.req.path);
      const agentName = match?.[1];
      const instanceId = match?.[2];
      const suffix = match?.[3] ?? "";
      const direct = suffix === "" || suffix === "/";
      const conversationId = agentName === STUDIO_AGENT_ID ? instanceId : undefined;
      const linkSubmission = direct && agentName !== undefined && instanceId !== undefined && context.req.method === "POST"
        ? rememberInvocation(agentName, instanceId, execution, conversationId) : undefined;
      const identity = agentName === undefined || instanceId === undefined ? {} : { agentName, agentInstanceId: instanceId,
        ...(conversationId === undefined ? {} : { conversationId }) };
      const attributes = { method: context.req.method,
        ...(agentName === undefined ? {} : { stage: suffix === "/abort" ? "agent_abort" : direct ? "agent_instance" : "agent_transport" }) };
      recordObservation({ name: "http.response", phase: "start", identity, attributes });
      let nextFailed = true;
      try {
        await next();
        nextFailed = false;
      } finally {
        recordObservation({ name: "http.response", phase: "end", identity,
          outcome: context.error || context.res.status >= 400 ? "failed" : "completed",
          attributes: { ...attributes, status: context.res.status, durationMs: performance.now() - started,
            route: context.req.routePath } });
        if (nextFailed || !context.res.ok) forgetProvisionalInvocation(execution.operationId);
      }
      // Admission acknowledges work; it does not mean the run has completed.
      if (direct && agentName && instanceId && context.req.method === "POST" && context.res.ok &&
          context.res.headers.get("content-type")?.includes("application/json")) {
        try {
          const receipt: unknown = await context.res.clone().json();
          if (receipt && typeof receipt === "object" && "submissionId" in receipt && typeof receipt.submissionId === "string") {
            const deduplicated = "deduplicated" in receipt && receipt.deduplicated === true;
            linkSubmission?.(receipt.submissionId, deduplicated);
            recordObservation({ name: "http.admission", phase: "end", outcome: "completed",
              identity: { agentName, agentInstanceId: instanceId, submissionId: receipt.submissionId,
                ...(conversationId === undefined ? {} : { conversationId }) }, attributes: { deduplicated } });
          }
        } catch { /* Failed diagnostic receipt parsing never changes admission. */ }
      }
      forgetProvisionalInvocation(execution.operationId);
    });
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

export function executionContext(
  context: Context<AdmissionEnv>,
): ExecutionContext {
  return context.get(EXECUTION_CONTEXT);
}
