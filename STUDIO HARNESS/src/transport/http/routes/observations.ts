import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as v from "valibot";
import { CLIENT_ATTRIBUTE_KEYS, CLIENT_OBSERVATION_NAMES } from "../../../contracts/source-observations.js";
import { isStudioUuid } from "../../../contracts/uuid.js";
import { diagnosticRecorder, type DiagnosticRecorder } from "../../../observability/recorder.js";
import { authContext, type AdmissionEnv } from "../middleware/admission.js";
import { createNativeObservationRoutes } from "./native-observations.js";

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(256));
const uuid = v.pipe(id, v.check((value: string) => isStudioUuid(value)));
const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER));
const identitySchema = v.strictObject({
  requestId: v.optional(id), operationId: v.optional(id), conversationId: v.optional(id),
  submissionId: v.optional(id), streamId: v.optional(id), messageId: v.optional(id), blockId: v.optional(id),
});
const attributeValue = v.union([v.pipe(v.string(), v.maxLength(160)), v.number(), v.boolean(), v.null()]);
const batchSchema = v.strictObject({
  captureId: uuid, dropped: count,
  events: v.pipe(v.array(v.strictObject({
    v: v.literal(1), eventId: uuid, bootId: uuid, sequence: v.pipe(count, v.minValue(1)),
    timestamp: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)),
    monotonicMs: v.pipe(v.number(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER)),
    name: v.picklist(CLIENT_OBSERVATION_NAMES), phase: v.picklist(["start", "progress", "end"]),
    outcome: v.optional(v.picklist(["completed", "failed", "cancelled", "unknown"])),
    identity: identitySchema, attributes: v.record(v.picklist(CLIENT_ATTRIBUTE_KEYS), attributeValue),
  })), v.maxLength(50)),
});

/** A write-only operational source port, available to paired clients without diagnostic reads. */
export function createObservationRoutes(recorder: DiagnosticRecorder = diagnosticRecorder): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  const seen = new Set<string>();
  let epoch = recorder.captureId;
  routes.use("*", async (context, next) => { context.header("Cache-Control", "no-store"); await next(); });
  routes.use("*", bodyLimit({ maxSize: 1_048_576 }));
  routes.route("/native", createNativeObservationRoutes(recorder));
  routes.get("/policy", (context) => context.json({ enabled: recorder.enabled, captureId: recorder.captureId }));
  routes.post("/", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json({ code: "diagnostics.invalid_batch" }, 400); }
    const parsed = v.safeParse(batchSchema, body);
    if (!parsed.success) return context.json({ code: "diagnostics.invalid_batch" }, 400);
    if (!recorder.enabled || parsed.output.captureId !== recorder.captureId) return context.json({ accepted: 0, stale: true });
    if (epoch !== recorder.captureId) { seen.clear(); epoch = recorder.captureId; }
    const clientId = authContext(context).clientId;
    // The paired proxy strips browser-supplied values and sets this after its gate.
    // Direct callers already hold host admission authority; this is provenance only.
    const deviceHeader = context.req.header("X-Project-Studio-Device-Id");
    const deviceId = deviceHeader && /^pd_[a-zA-Z0-9_-]{1,128}$/.test(deviceHeader) ? deviceHeader : undefined;
    let accepted = 0;
    for (const event of parsed.output.events) {
      const key = `${clientId}:${deviceId ?? "host"}:${event.bootId}:${event.eventId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > 20_000) { const oldest = seen.values().next().value; if (oldest !== undefined) seen.delete(oldest); }
      recorder.record({ name: event.name, phase: event.phase,
        ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
        identity: {
          ...(event.identity.requestId === undefined ? {} : { requestId: event.identity.requestId }),
          ...(event.identity.operationId === undefined ? {} : { operationId: event.identity.operationId }),
          ...(event.identity.conversationId === undefined ? {} : { conversationId: event.identity.conversationId }),
          ...(event.identity.submissionId === undefined ? {} : { submissionId: event.identity.submissionId }),
          ...(event.identity.streamId === undefined ? {} : { streamId: event.identity.streamId }),
          ...(event.identity.messageId === undefined ? {} : { messageId: event.identity.messageId }),
          ...(event.identity.blockId === undefined ? {} : { blockId: event.identity.blockId }),
        },
        attributes: { ...event.attributes, sourceDropped: parsed.output.dropped },
        source: { kind: "client", clientId, eventId: event.eventId, bootId: event.bootId,
          ...(deviceId === undefined ? {} : { deviceId }),
          sequence: event.sequence, timestamp: event.timestamp, monotonicMs: event.monotonicMs },
      });
      accepted++;
    }
    return context.json({ accepted });
  });
  return routes;
}
