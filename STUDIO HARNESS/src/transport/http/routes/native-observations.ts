import { Hono } from "hono";
import * as v from "valibot";
import { isStudioUuid } from "../../../contracts/uuid.js";
import type { DiagnosticRecorder } from "../../../observability/recorder.js";
import { authContext, requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import { ADMISSION_SCOPES } from "../../../admission/scopes.js";

const uuid = v.pipe(v.string(), v.maxLength(36), v.check((value: string) => isStudioUuid(value)));
const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER));
const code = v.pipe(v.string(), v.regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/));
const batch = v.strictObject({ captureId: uuid, dropped: count, evicted: count,
  events: v.pipe(v.array(v.strictObject({
    v: v.literal(1), eventId: uuid, bootId: uuid, sequence: v.pipe(count, v.minValue(1)),
    unixMs: v.pipe(count, v.maxValue(8_640_000_000_000_000)), monotonicMs: count,
    name: v.picklist(["native.request", "native.bytes", "native.stream", "native.harness", "native.command"]),
    phase: v.picklist(["start", "progress", "end"]),
    outcome: v.nullable(v.picklist(["completed", "failed", "cancelled", "unknown"])),
    operationId: uuid, requestId: v.nullable(uuid),
    streamId: v.nullable(v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{1,128}$/))),
    stage: code, status: v.nullable(v.pipe(count, v.maxValue(599))), durationMs: v.nullable(count), errorCode: v.nullable(code),
  })), v.maxLength(50)) });

/** Local diagnostic-scope writer. The paired proxy refuses this route. */
export function createNativeObservationRoutes(recorder: DiagnosticRecorder): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.DIAGNOSTIC));
  const seen = new Set<string>();
  let epoch = recorder.captureId;
  routes.post("/", async (context) => {
    let input: unknown;
    try { input = await context.req.json(); } catch { return context.json({ code: "diagnostics.invalid_batch" }, 400); }
    const parsed = v.safeParse(batch, input);
    if (!parsed.success) return context.json({ code: "diagnostics.invalid_batch" }, 400);
    if (!recorder.enabled || parsed.output.captureId !== recorder.captureId) return context.json({ accepted: 0, stale: true });
    if (epoch !== recorder.captureId) { seen.clear(); epoch = recorder.captureId; }
    const clientId = authContext(context).clientId;
    let accepted = 0;
    for (const event of parsed.output.events) {
      const key = `${clientId}:${event.bootId}:${event.eventId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > 20_000) { const oldest = seen.values().next().value; if (oldest !== undefined) seen.delete(oldest); }
      recorder.record({ name: event.name, phase: event.phase,
        ...(event.outcome === null ? {} : { outcome: event.outcome }),
        identity: { operationId: event.operationId,
          ...(event.requestId === null ? {} : { requestId: event.requestId }),
          ...(event.streamId === null ? {} : { streamId: event.streamId }) },
        attributes: { stage: event.stage, status: event.status, durationMs: event.durationMs, errorCode: event.errorCode,
          sourceDropped: parsed.output.dropped, sourceEvicted: parsed.output.evicted },
        source: { kind: "native", clientId, eventId: event.eventId, bootId: event.bootId, sequence: event.sequence,
          timestamp: new Date(event.unixMs).toISOString(), monotonicMs: event.monotonicMs },
      });
      accepted++;
    }
    return context.json({ accepted });
  });
  return routes;
}
