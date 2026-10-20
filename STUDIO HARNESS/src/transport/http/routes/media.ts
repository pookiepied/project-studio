import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

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
import { ImproveError, type TextImproverPort } from "../../../application/text-improver.js";
import { conversationArtifactsDirectory } from "../../../platform/paths.js";
import type { VoiceSettings } from "../../../gateway/language/voice-settings.js";
import { observeOperation } from "../../../observability/operation.js";

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
 *
 * The generation half - the jobs the model's image and video tools start -
 * is read here too: the list of a conversation's jobs, a Stop for one, the
 * finished artifacts those jobs left, and the bytes of one of them. The bytes
 * are served from the conversation's artifacts directory by a file name the
 * job registry made, and the name is checked against the shape the registry
 * produces before any path is built, so a request cannot name a file the
 * registry did not write. A finished output never changes, so the response
 * says so and the webview caches it for the session.
 */

/** `media_<run tag><counter>-<index>.<extension>` - exactly what `MediaJobs` writes. */
const ARTIFACT_FILE_NAME = /^media_[a-z0-9]+-[0-9]+\.[a-z0-9]+$/;

/** A conversation id is a path segment and nothing else. */
const CONVERSATION_ID = /^[A-Za-z0-9_-]+$/;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

/** The type a finished artifact answers as, from the extension its name carries. */
function mimeTypeOf(fileName: string): string {
  return MIME_BY_EXTENSION[fileName.slice(fileName.lastIndexOf(".") + 1)] ?? "application/octet-stream";
}

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

/** The body of `POST /improve`: the dictated passage, and nothing else. */
const improveRequestSchema = v.object({ text: v.pipe(v.string(), v.minLength(1)) });

export function createMediaRoutes(
  media: MediaAdministration,
  options: {
    /**
     * Tidies a dictated passage on the default model. Optional for tests of
     * the other routes; absent, `POST /improve` answers that nothing is
     * wired, which is also what a harness built without one would say.
     */
    readonly improver?: TextImproverPort;
    readonly voiceSettings?: VoiceSettings;
    readonly isModelServed?: (modelId: string) => Promise<boolean>;
  } = {},
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROJECT));

  routes.get("/voice-model", (context) => context.json({ modelId: options.voiceSettings?.get() ?? null }));
  routes.put("/voice-model", async (context) => {
    try {
      const parsed = v.safeParse(v.object({ modelId: v.nullable(v.string()) }), await body(context));
      if (!parsed.success || options.voiceSettings === undefined) throw new MediaRouteError("Choose a connected voice conversation model.");
      const modelId = parsed.output.modelId;
      if (modelId !== null && !(await options.isModelServed?.(modelId))) throw new MediaRouteError("That voice model is not connected.");
      await observeOperation("provider", "voice.settings", async () => { options.voiceSettings?.set(modelId); });
      return context.json({ modelId });
    } catch (error) { return context.json(failure(error), statusOf(error)); }
  });

  routes.post("/improve", async (context) => {
    try {
      const parsed = v.safeParse(improveRequestSchema, await body(context));
      if (!parsed.success) {
        throw new MediaRouteError('The improve body must be { "text": "..." }.');
      }
      if (options.improver === undefined) {
        throw new MediaRouteError("Nothing in this harness improves text.");
      }
      const text = await options.improver.improve(parsed.output.text);
      return context.json({ text }, 200);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

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

  routes.get("/jobs", (context) => {
    const conversationId = context.req.query("conversationId") ?? "";
    if (!CONVERSATION_ID.test(conversationId)) {
      return context.json(failure(new MediaRouteError("A conversationId is required.")), 400);
    }
    return context.json({ jobs: media.listJobs?.(conversationId) ?? [] }, 200);
  });

  routes.post("/jobs/:id/stop", async (context) => {
    try {
      const parsed = v.safeParse(
        v.object({ conversationId: v.pipe(v.string(), v.regex(CONVERSATION_ID)) }),
        await body(context),
      );
      if (!parsed.success) {
        throw new MediaRouteError("The stop body must be { \"conversationId\": \"...\" }.");
      }
      const stopped = media.stopJob?.(parsed.output.conversationId, context.req.param("id")) ?? false;
      return stopped
        ? context.json({ stopped: true }, 200)
        : context.json({ error: "There is no such job.", code: "media.not-found" }, 404);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  /**
   * What a conversation's generations finished with, by the names their
   * files carry.
   *
   * The jobs route answers only what this process's registry holds, and the
   * registry is in memory: a generation from before a restart answers here
   * or nowhere. The files were written before "done" was ever recorded and
   * they stay, and they carry the job's own id, so a caller that knows a
   * forgotten job's id reads this listing and finds exactly its outputs -
   * which is how the transcript's card recovers what the finished notice
   * already said, without the registry's help. The answer moves (the next
   * generation adds a file), so unlike the bytes it says nothing about
   * caching.
   */
  routes.get("/artifacts/:conversationId", async (context) => {
    const conversationId = context.req.param("conversationId");
    if (!CONVERSATION_ID.test(conversationId)) {
      return context.json({ error: "There is no such artifact.", code: "media.not-found" }, 404);
    }
    // A directory that cannot be read is the ordinary no-artifacts answer,
    // not a failure: the directory exists from the conversation's first
    // admitted prompt, and until something is generated into it there is
    // nothing to list. What a caller wants here is "nothing yet", which an
    // error would make it tell apart from.
    let names: readonly string[];
    try {
      names = await readdir(conversationArtifactsDirectory(conversationId));
    } catch {
      names = [];
    }
    const artifacts = names
      .filter((name) => ARTIFACT_FILE_NAME.test(name))
      .sort()
      .map((fileName) => ({ fileName, mimeType: mimeTypeOf(fileName) }));
    return context.json({ artifacts });
  });

  routes.get("/artifacts/:conversationId/:fileName", async (context) => {
    const conversationId = context.req.param("conversationId");
    const fileName = context.req.param("fileName");
    if (!CONVERSATION_ID.test(conversationId) || !ARTIFACT_FILE_NAME.test(fileName)) {
      return context.json({ error: "There is no such artifact.", code: "media.not-found" }, 404);
    }
    try {
      const bytes = await readFile(join(conversationArtifactsDirectory(conversationId), fileName));
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": mimeTypeOf(fileName),
          "content-length": String(bytes.byteLength),
          "cache-control": "private, max-age=31536000, immutable",
        },
      });
    } catch {
      return context.json({ error: "There is no such artifact.", code: "media.not-found" }, 404);
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
  if (error instanceof MediaRouteError) return 400;
  if (error instanceof ImproveError && error.kind === "bad-input") return 400;
  return 502;
}
