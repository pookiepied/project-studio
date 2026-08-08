import { Hono } from "hono";
import type { Env } from "../../system/env";
import { executeToolCall } from "../../execution/executor";
import { normalizeBatchRequest, normalizeExecutionRequest } from "../../execution/validation";
import { toToolError, ToolExecutionException } from "../../errors";
import { assertSameUser, readJsonObject, requireUserId } from "../../system/http";

export const executeRoute = new Hono<{ Bindings: Env }>();

executeRoute.post("/execute", async (c) => {
  try {
    const headerUserId = requireUserId(c.req.raw);
    const request = normalizeExecutionRequest(await readJsonObject(c.req.raw));
    assertSameUser(headerUserId, request.userId);
    const result = await executeToolCall(c.env, request);
    return c.json(result, result.ok ? 200 : statusFor(result.error.code));
  } catch (error) {
    const normalized = toToolError(error);
    return c.json({ ok: false, error: normalized }, { status: error instanceof ToolExecutionException ? statusForCode(error.status) : 500 });
  }
});

executeRoute.post("/execute/batch", async (c) => {
  try {
    const headerUserId = requireUserId(c.req.raw);
    const batch = normalizeBatchRequest(await readJsonObject(c.req.raw));
    assertSameUser(headerUserId, batch.userId);
    const results = await Promise.all(batch.calls.map((call) => executeToolCall(c.env, call)));
    return c.json({ ok: results.every((result) => result.ok), results });
  } catch (error) {
    const normalized = toToolError(error);
    return c.json({ ok: false, error: normalized }, { status: error instanceof ToolExecutionException ? statusForCode(error.status) : 500 });
  }
});

function statusFor(code: string): 400 | 403 | 409 | 500 | 501 | 502 {
  switch (code) {
    case "invalid_request":
      return 400;
    case "forbidden":
      return 403;
    case "not_implemented":
      return 501;
    case "upstream_error":
      return 502;
    default:
      return 500;
  }
}

function statusForCode(status: number): 400 | 403 | 409 | 500 | 501 | 502 {
  return status === 400 || status === 403 || status === 409 || status === 501 || status === 502 ? status : 500;
}
