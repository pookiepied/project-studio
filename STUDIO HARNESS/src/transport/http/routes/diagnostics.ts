import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as v from "valibot";
import type { AdmissionEnv } from "../middleware/admission.js";
import { diagnosticRecorder, type DiagnosticRecorder } from "../../../observability/recorder.js";

const policySchema = v.strictObject({
  expectedCaptureId: v.optional(v.pipe(v.string(), v.maxLength(256))),
  enabled: v.optional(v.boolean()), captureContent: v.optional(v.boolean()),
  conversations: v.optional(v.pipe(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(256))), v.maxLength(100))),
  maxEvents: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000))),
  maxBytes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(4096), v.maxValue(32 * 1024 * 1024))),
  maxEventBytes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(2048), v.maxValue(128 * 1024))),
});

/** Admission and diagnostic scope are applied at the mount, before any payload read. */
export function createDiagnosticRoutes(recorder: DiagnosticRecorder = diagnosticRecorder): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", async (context, next) => { context.header("Cache-Control", "no-store"); await next(); });
  routes.use("/policy", bodyLimit({ maxSize: 32_768 }));
  routes.get("/", (context) => context.json(recorder.health()));
  routes.put("/policy", async (context) => {
    // A control request cannot contain arbitrary diagnostic payloads.
    const text = await context.req.text();
    if (text.length > 32_768) return context.json({ code: "diagnostics.invalid" }, 413);
    let input: unknown;
    try { input = JSON.parse(text); } catch { return context.json({ code: "diagnostics.invalid" }, 400); }
    const parsed = v.safeParse(policySchema, input);
    if (!parsed.success) return context.json({ code: "diagnostics.invalid" }, 400);
    const policy = parsed.output;
    if (policy.expectedCaptureId !== undefined && policy.expectedCaptureId !== recorder.captureId) {
      return context.json({ code: "diagnostics.policy_changed", error: "Recording settings changed in another window. Refresh and try again." }, 409);
    }
    return context.json(recorder.configure({
      ...(policy.enabled === undefined ? {} : { enabled: policy.enabled }),
      ...(policy.captureContent === undefined ? {} : { captureContent: policy.captureContent }),
      ...(policy.conversations === undefined ? {} : { conversations: policy.conversations }),
      ...(policy.maxEvents === undefined ? {} : { maxEvents: policy.maxEvents }),
      ...(policy.maxBytes === undefined ? {} : { maxBytes: policy.maxBytes }),
      ...(policy.maxEventBytes === undefined ? {} : { maxEventBytes: policy.maxEventBytes }),
    }));
  });
  routes.get("/events", (context) => {
    const after = Number(context.req.query("after") ?? "0");
    const limit = Number(context.req.query("limit") ?? "100");
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) {
      return context.json({ code: "diagnostics.invalid_cursor" }, 400);
    }
    context.header("Cache-Control", "no-store");
    return context.json(recorder.read(after, limit, context.req.query("bootId") ?? recorder.bootId));
  });
  routes.delete("/events", (context) => { recorder.clear(); return context.body(null, 204); });
  return routes;
}
