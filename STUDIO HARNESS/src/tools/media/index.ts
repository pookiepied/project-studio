import { readFile } from "node:fs/promises";

import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { MediaError } from "../../contracts/media.js";
import type { MediaBytes } from "../../gateway/media/adapters/types.js";
import type { MediaJobStatus } from "../../gateway/media/jobs.js";
import type { MediaService } from "../../gateway/media/service.js";
import { ToolError } from "../errors.js";
import type { CallGate } from "../gate.js";
import { refusalMessage, type ImageBudget } from "../filesystem/image-budget.js";
import { defineStudioTool, type ToolContext, type ToolDefinition } from "../types.js";

/**
 * The generation tools: an image, a video.
 *
 * The surface is Studio's. The model asks for a picture; which vendor
 * paints it is a setting, and no vendor name appears in these schemas -
 * the rule ADR 0049 set for the browser and ADR 0051 restated for every
 * gateway. Both tools dispatch through the media service, so the slot a
 * person chose in Settings decides the model, and the adapter behind it
 * decides the wire.
 *
 * ---- An image returns; a video is started -----------------------------------
 *
 * An image is seconds to a couple of minutes and the model usually wants
 * to look at it, so `studio_image` waits for the job and answers with the
 * picture - as an image block when the current model accepts images and
 * the conversation's image budget has room, as words otherwise. A video is
 * minutes, so `studio_video` answers at once with the job's id and the
 * turn goes on; the job's end is told the way a background command's is, on
 * the tail of the next tool result, in the next turn's block, or - when
 * nobody writes anything - as the finished-job announcement that wakes the
 * conversation on its own. Between those, the jobs tool reads this same
 * registry and answers with the provider's own progress line.
 *
 * ---- What the result says ----------------------------------------------------
 *
 * Every finished output is one `Artifact:` line: the path the harness
 * serves the bytes at, and the type. The line is for two readers. The model
 * reads it as where the file is; the transcript reads it as what to draw,
 * which is why its shape is fixed here and parsed, not guessed, on the
 * other side. The bytes never leave the harness's own directory except by
 * that route.
 */

const IMAGE_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "studio_image" },
  title: "Generate an image",
  description:
    "Generates an image from a description, or edits images from the workspace when " +
    "input_paths are given. Answers with the finished image. Which model paints it is " +
    "chosen in Settings.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1 },
      title: {
        type: "string",
        maxLength: 80,
        description:
          "A short title for the result, a few words the way a caption names a picture - " +
          "\"Cover for the reading note\", not the prompt again. Shown above it.",
      },
      aspect_ratio: {
        type: "string",
        description: 'A ratio such as "1:1", "16:9" or "9:16". Omit for the model\'s default.',
      },
      size: {
        type: "string",
        description: 'Exact pixels such as "1024x1024", when the model takes them. Omit otherwise.',
      },
      count: { type: "integer", minimum: 1, maximum: 4 },
      input_paths: {
        type: "array",
        items: { type: "string" },
        maxItems: 8,
        description: "Workspace paths of images to edit or use as references.",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  effects: ["network"],
  provenance: NATIVE_PROVENANCE,
  idempotent: false,
};

const VIDEO_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "studio_video" },
  title: "Generate a video",
  description:
    "Starts generating a short video from a description, optionally from a first frame " +
    "given as a workspace image path. Answers at once with a job id; the finished video " +
    "is announced when it lands. Which model makes it is chosen in Settings.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1 },
      title: {
        type: "string",
        maxLength: 80,
        description:
          "A short title for the result, a few words the way a caption names a picture - " +
          "\"Cover for the reading note\", not the prompt again. Shown above it.",
      },
      duration_seconds: { type: "integer", minimum: 1, maximum: 60 },
      aspect_ratio: { type: "string", description: 'A ratio such as "16:9" or "9:16".' },
      resolution: { type: "string", description: '"720p" or "1080p", when the model takes one.' },
      image_path: { type: "string", description: "A workspace image to use as the first frame." },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  effects: ["network"],
  provenance: NATIVE_PROVENANCE,
  idempotent: false,
};

interface ImageToolInput {
  readonly prompt: string;
  readonly title?: string;
  readonly aspectRatio?: string;
  readonly size?: string;
  readonly count?: number;
  readonly inputPaths: readonly string[];
}

type ImageToolOutput = {
  readonly content: readonly (
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  )[];
};

interface VideoToolInput {
  readonly prompt: string;
  readonly title?: string;
  readonly durationSeconds?: number;
  readonly aspectRatio?: string;
  readonly resolution?: string;
  readonly imagePath?: string;
}

export interface MediaToolRegistration {
  readonly media: MediaService;
  readonly acceptsImages?: (conversationId: string) => boolean | undefined;
  readonly imageBudget?: ImageBudget;
}

/** Five minutes: OpenRouter's own image example took ninety seconds. */
const IMAGE_DEADLINE_MS = 300_000;
/** Submitting a video is one request; the job runs after the call returns. */
const VIDEO_DEADLINE_MS = 60_000;

const RATIO = /^\d{1,2}(\.\d+)?:\d{1,2}(\.\d+)?$/;
const SIZE = /^\d{2,5}x\d{2,5}$/;

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function optionalString(value: unknown, name: string, pattern?: RegExp): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolError("invalid_input", { message: `${name} must be text.` });
  }
  const trimmed = value.trim();
  if (pattern !== undefined && !pattern.test(trimmed)) {
    throw new ToolError("invalid_input", { message: `${name} is not in a shape the tool takes.` });
  }
  return trimmed;
}

function optionalInteger(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolError("invalid_input", {
      message: `${name} must be a whole number from ${String(min)} to ${String(max)}.`,
    });
  }
  return value;
}

function prompt(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolError("invalid_input", { message: "prompt is required." });
  }
  return value.trim();
}

/** A workspace image, read through the sandbox's containment and straight from disk. */
async function imageAt(path: string, context: ToolContext): Promise<MediaBytes> {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const mimeType = IMAGE_MIME_BY_EXTENSION[extension];
  if (mimeType === undefined) {
    throw new ToolError("invalid_input", {
      message: `${path} is not an image the tool can send (png, jpg, webp or gif).`,
    });
  }
  const absolute = context.sandbox.resolveRead(path);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch {
    throw new ToolError("invalid_input", { message: `${path} could not be read.` });
  }
  return { bytes: new Uint8Array(bytes), mimeType };
}

/** The `Artifact:` line the transcript parses; see the file comment. */
function artifactLine(job: MediaJobStatus, output: MediaJobStatus["outputs"][number]): string {
  return `Artifact: /api/media/artifacts/${job.conversationId}/${output.fileName} (${output.mimeType})`;
}

/** A wait, as words: "45 seconds", "2 minutes 10 seconds". */
function elapsedWords(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return total === 1 ? "1 second" : `${String(total)} seconds`;
  const minutes = Math.floor(total / 60);
  const minutesWord = minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
  const seconds = total % 60;
  return seconds === 0 ? minutesWord : `${minutesWord} ${String(seconds)} seconds`;
}

/**
 * One job as the jobs tool lists it, without its answers' details.
 *
 * The same column shape the background commands' listing uses, because the
 * two kinds of job appear in one listing and a second grammar would read as
 * a second tool. The prompt - not the vendor's word - is what a person, or a
 * model, recognises the job by.
 */
export function mediaJobSummary(job: MediaJobStatus): string {
  const state =
    job.state === "queued"
      ? "queued"
      : job.state === "running"
        ? "generating"
        : job.state === "done"
          ? "finished"
          : job.state === "stopped"
            ? "stopped"
            : "failed";
  return `${job.id}  ${state}  ${job.description}`;
}

/**
 * One job with what a caller asking by id wants: how far, what the vendor
 * last said, what came out.
 *
 * The provider's own detail leads while the job runs, because "generating"
 * alone is what the listing already said and the progress line is the only
 * news a mid-flight check exists for. Finished, the interesting half is the
 * output - as the same Artifact lines the transcript and the finished-job
 * announcement carry, so one asking-again read teaches nothing new about
 * where the file lives. What is deliberately absent: a byte count, a model
 * id, a started-at clock. The model that asked wants the state of the work,
 * and the rest of it is the description's job already.
 */
export function mediaJobDetail(job: MediaJobStatus): string {
  const lines = [mediaJobSummary(job), ""];
  if (job.state === "queued" || job.state === "running") {
    lines.push(`Started ${elapsedWords(Date.now() - job.startedAt)} ago.`);
    if (job.detail !== undefined) {
      lines.push(`The provider last said: ${job.detail}`);
    }
  } else if (job.state === "done") {
    lines.push(`Took ${elapsedWords((job.endedAt ?? job.startedAt) - job.startedAt)}. What it produced:`);
    for (const output of job.outputs) lines.push(artifactLine(job, output));
  } else if (job.state === "stopped") {
    lines.push("Stopped before it finished; nothing is recorded.");
  } else {
    lines.push(`The provider said: ${job.error ?? "nothing"}.`);
  }
  return lines.join("\n");
}

function mediaFailure(error: unknown): never {
  if (error instanceof MediaError) {
    throw new ToolError(error.kind === "slot-unset" ? "unavailable" : "execution_failed", {
      message: error.message,
    });
  }
  throw error;
}

function createImageTool(
  registration: MediaToolRegistration,
): ToolDefinition<ImageToolInput, ImageToolOutput> {
  return defineStudioTool({
    descriptor: IMAGE_DESCRIPTOR,
    resourceKind: "command",
    deadlineMs: IMAGE_DEADLINE_MS,

    parse: (input): ImageToolInput => {
      const value = (input ?? {}) as Record<string, unknown>;
      const paths = value.input_paths;
      if (paths !== undefined && (!Array.isArray(paths) || paths.some((p) => typeof p !== "string"))) {
        throw new ToolError("invalid_input", { message: "input_paths must be a list of paths." });
      }
      const inputPaths = (paths ?? []) as string[];
      if (inputPaths.length > 8) {
        throw new ToolError("invalid_input", { message: "input_paths takes at most 8 images." });
      }
      const aspectRatio = optionalString(value.aspect_ratio, "aspect_ratio", RATIO);
      const size = optionalString(value.size, "size", SIZE);
      const title = optionalString(value.title, "title");
      const count = optionalInteger(value.count, "count", 1, 4);
      return {
        prompt: prompt(value.prompt),
        ...(title === undefined ? {} : { title }),
        ...(aspectRatio === undefined ? {} : { aspectRatio }),
        ...(size === undefined ? {} : { size }),
        ...(count === undefined ? {} : { count }),
        inputPaths,
      };
    },

    // The provider is settings, and one approval covers the tool; the paths
    // an edit reads are listed so a rule can name them.
    resource: () => undefined,
    resources: (input, context) => input.inputPaths.map((path) => context.sandbox.resolveRead(path)),

    execute: async (input, context) => {
      const conversationId = context.scope.conversationId;
      const inputImages = await Promise.all(input.inputPaths.map((path) => imageAt(path, context)));

      const started = await registration.media
        .generateImage(
          {
            prompt: input.prompt,
            ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
            ...(input.size === undefined ? {} : { size: input.size }),
            ...(input.count === undefined ? {} : { count: input.count }),
            ...(inputImages.length === 0 ? {} : { inputImages }),
          },
          { conversationId },
        )
        .catch(mediaFailure);

      const finished = await registration.media.jobs.finished(conversationId, started.id);
      if (finished === undefined || finished.state !== "done") {
        throw new ToolError("execution_failed", {
          message:
            finished?.state === "stopped"
              ? "The image generation was stopped."
              : `The image could not be generated${finished?.error === undefined ? "." : `: ${finished.error}`}`,
        });
      }

      const lines = [
        `Generated ${String(finished.outputs.length)} image${finished.outputs.length === 1 ? "" : "s"} with ${finished.modelId}.`,
        ...finished.outputs.map((output) => artifactLine(finished, output)),
      ];
      const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
        { type: "text", text: lines.join("\n") },
      ];

      // The picture goes back to the model only when it can see one and the
      // conversation's image allowance has room; otherwise the words stand,
      // and the person still sees the picture in the transcript.
      const acceptsImages = registration.acceptsImages?.(conversationId);
      if (acceptsImages !== false) {
        for (const output of finished.outputs) {
          const refusal = registration.imageBudget?.check(conversationId, output.byteLength) ?? null;
          if (refusal !== null) {
            content.push({ type: "text", text: refusalMessage(output.path, refusal) });
            continue;
          }
          const bytes = await readFile(output.path);
          registration.imageBudget?.record(conversationId, bytes.length);
          content.push({ type: "image", data: bytes.toString("base64"), mimeType: output.mimeType });
        }
        if (registration.imageBudget !== undefined) {
          content.push({ type: "text", text: registration.imageBudget.statusMessage(conversationId) });
        }
      }
      return { content };
    },
  });
}

function createVideoTool(
  registration: MediaToolRegistration,
): ToolDefinition<VideoToolInput, string> {
  return defineStudioTool({
    descriptor: VIDEO_DESCRIPTOR,
    resourceKind: "command",
    deadlineMs: VIDEO_DEADLINE_MS,

    parse: (input): VideoToolInput => {
      const value = (input ?? {}) as Record<string, unknown>;
      const duration = optionalInteger(value.duration_seconds, "duration_seconds", 1, 60);
      const aspectRatio = optionalString(value.aspect_ratio, "aspect_ratio", RATIO);
      const resolution = optionalString(value.resolution, "resolution", /^\d{3,4}p$|^[1-9]K$/i);
      const title = optionalString(value.title, "title");
      const imagePath = optionalString(value.image_path, "image_path");
      return {
        prompt: prompt(value.prompt),
        ...(title === undefined ? {} : { title }),
        ...(duration === undefined ? {} : { durationSeconds: duration }),
        ...(aspectRatio === undefined ? {} : { aspectRatio }),
        ...(resolution === undefined ? {} : { resolution }),
        ...(imagePath === undefined ? {} : { imagePath }),
      };
    },

    resource: () => undefined,
    resources: (input, context) =>
      input.imagePath === undefined ? [] : [context.sandbox.resolveRead(input.imagePath)],

    execute: async (input, context) => {
      const conversationId = context.scope.conversationId;
      const image = input.imagePath === undefined ? undefined : await imageAt(input.imagePath, context);
      const started = await registration.media
        .generateVideo(
          {
            prompt: input.prompt,
            ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds }),
            ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
            ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
            ...(image === undefined ? {} : { image }),
          },
          { conversationId },
        )
        .catch(mediaFailure);

      return [
        `Started video job ${started.id} with ${started.modelId}. It takes minutes; carry on, check ` +
          "its progress with the jobs tool if it matters, and you will be told when it has landed - " +
          "even when nobody has written anything. When that happens, tell the user what finished.",
      ].join("\n");
    },
  });
}

export function registerMediaTools(gate: CallGate, registration: MediaToolRegistration): void {
  gate.register(createImageTool(registration));
  gate.register(createVideoTool(registration));
}

/**
 * The lines a turn's block or a tool result carries about generation jobs:
 * running ones as current state, ended ones once. The same two rules the
 * background commands follow, for the same reasons.
 */
export function mediaJobLines(media: MediaService, conversationId: string): {
  readonly running: readonly string[];
  readonly ended: readonly string[];
} {
  const running = media
    .listJobs(conversationId)
    .filter((job) => job.state === "queued" || job.state === "running")
    .map((job) => `${job.id} is generating (${job.slot}): ${job.description}`);
  const ended = media.jobs.drainFinished(conversationId).map((job) => {
    if (job.state === "done") {
      return [`${job.id} finished: ${job.description}`, ...job.outputs.map((o) => artifactLine(job, o))].join("\n");
    }
    if (job.state === "stopped") return `${job.id} was stopped: ${job.description}`;
    return `${job.id} failed${job.error === undefined ? "" : `: ${job.error}`} (${job.description})`;
  });
  return { running, ended };
}

export function mediaFinishedNotice(ended: readonly string[]): string | undefined {
  if (ended.length === 0) return undefined;
  return [
    `Generation ${ended.length > 1 ? "jobs have" : "job has"} ended while you were working:`,
    ...ended,
  ].join("\n");
}
