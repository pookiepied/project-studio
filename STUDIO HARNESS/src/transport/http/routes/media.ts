import { Hono } from "hono";
import * as v from "valibot";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import {
  speechRequestSchema,
  transcribeRequestSchema,
} from "../../../contracts/media.js";
import { StudioError } from "../../../contracts/errors.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import type { MediaAdministration } from "../../../gateway/media/service.js";

/**
 * The media routes: dictation and read-aloud, the app's own voice features.
 *
 * The invoker is the person, not the model - the mic button and the speaker
 * control are the product acting for its user - so these sit behind the
 * PROJECT scope beside the conversation surface, never behind the permission
 * kernel. The hard rule of every provider route holds here too: a request may
 * carry audio and a request may name a voice, and no response ever carries a
 * credential or echoes one.
 *
 * Bodies are JSON with base64 audio, the same encoding the attachments path
 * already speaks; the audio in a dictation is a couple of minutes of opus at
 * most, well inside a JSON round trip.
 */

async function body(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new MediaRouteError("The request body must be valid JSON.");
  }
}

/**
 * A body that failed its contract - a 400 with a sentence, like retrieval's.
 *
 * It extends `StudioError` rather than `Error` so the sentence it carries
 * reports as `media.bad-request` instead of landing in the `unclassified`
 * domain, which is meant to measure code that has not been onboarded rather
 * than to be the permanent home of code that never was. The taxonomy scan in
 * `architecture.test.ts` could not see this one: it was not exported, so the
 * rule anchored on `export class` skipped it, and it was only ever constructed
 * under its own name, so the rule that looks for the unclassified constructors
 * skipped it too. Both rules have been widened alongside this fix.
 */
class MediaRouteError extends StudioError {
  readonly domain = "media" as const;

  constructor(message: string) {
    // Not retryable: the same body sent again fails the same way. Only the
    // caller changing what it sends can fix this.
    super("bad-request", message, { retryable: false });
    this.name = "MediaRouteError";
  }
}

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}

export function createMediaRoutes(media: MediaAdministration): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROJECT));

  routes.post("/transcribe", async (context) => {
    try {
      const parsed = v.safeParse(transcribeRequestSchema, await body(context));
      if (!parsed.success) {
        throw new MediaRouteError(
          "The transcription body must be { \"audio\": base64, \"mimeType\": \"audio/...\" }.",
        );
      }
      const result = await media.transcribe({
        audio: bytesOf(parsed.output.audio),
        mimeType: parsed.output.mimeType,
        ...(parsed.output.modelId === undefined ? {} : { modelId: parsed.output.modelId }),
      });
      return context.json(result, 200);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/speech", async (context) => {
    try {
      const parsed = v.safeParse(speechRequestSchema, await body(context));
      if (!parsed.success) {
        throw new MediaRouteError(
          "The speech body must be { \"text\": \"...\", \"modelId\"?: \"...\", \"voiceId\"?: \"...\" }.",
        );
      }
      const result = await media.speak({
        text: parsed.output.text,
        ...(parsed.output.modelId === undefined ? {} : { modelId: parsed.output.modelId }),
        ...(parsed.output.voiceId === undefined ? {} : { voiceId: parsed.output.voiceId }),
      });
      return context.json(result, 200);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  return routes;
}

/** Base64 arrives in JSON; it leaves as bytes before anything touches a driver. */
function bytesOf(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/**
 * The route's own malformed-body error is a request fault (400); every other
 * error reports as 502 - the far end or the configuration refused, not this
 * body.
 *
 * The test is the class and not the domain. `MediaRouteError` is itself a
 * `StudioError` reporting in the `media` domain, so is `MediaError`, and they
 * mean opposite things about whose fault the request was: one is this body,
 * the other is the provider behind it.
 */
function statusOf(error: unknown): 400 | 502 {
  return error instanceof MediaRouteError ? 400 : 502;
}
