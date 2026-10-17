import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import type { MediaJobs } from "../../gateway/media/jobs.js";
import type { BackgroundJobs, JobStatus } from "../../process/background.js";
import { ToolError } from "../errors.js";
import { mediaJobDetail, mediaJobSummary } from "../media/index.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";

/**
 * Reading and ending the background work this conversation started: commands
 * and generations alike.
 *
 * One tool rather than two, because the things a caller wants here - see what
 * is running, read how one is doing, stop it - are the same question asked
 * with more or less of an id, whichever kind of job it is. A generation only
 * looked like a second tool's business: its job lives in a registry of its
 * own (`MediaJobs`), but from the outside it is background work this
 * conversation started, started by a tool that answers with an id, exactly
 * the way a background command is. Two listings and two read paths for the
 * same idea would have the model guessing which of them to call.
 *
 * Which registry holds a given id is decided by its prefix - commands mint
 * `job_`, generations mint `media_` - because the ids are the one thing the
 * two registries already made distinct, and a model that has to remember
 * which registry owns which id is being handed a mistake to make. An unknown
 * id is refused the same way either way.
 *
 */

export interface JobsInput {
  /** Which job. Omitted, every job this conversation started is listed. */
  readonly id: string | undefined;
  /** End it rather than read it. */
  readonly stop: boolean;
}

const JOBS_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "jobs" },
  title: "Background jobs",
  description:
    "Lists the background work this conversation started - commands and image or " +
    "video generations alike -, reads one job's output or progress, or stops it. " +
    'Call with no arguments to list them, with {"id": "job_1"} or {"id": "media_1"} ' +
    'to read that one, and with {"id": "job_1", "stop": true} to end it. A command ' +
    "keeps its most recent output; a generation reports the provider's own progress.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1 },
      stop: { type: "boolean" },
    },
    additionalProperties: false,
  },
  // `read`, the same declaration `plan` and `ask` carry while they too write
  // state. It is what a studio-authored capability with no elevated reach
  // declares here, and the reach is the question: listing and reading touch
  // nothing, and stopping ends a process - or cancels a vendor's job - this
  // same conversation was already approved to start. A second approval to
  // end it would leave "leave it running" as the only unapproved path, which
  // is backwards.
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
  // Listing and reading are; stopping a stopped job is a no-op. Nothing here
  // does something different the second time.
  idempotent: true,
};

/** One command as a person reads it, without its output. */
function summarize(job: JobStatus): string {
  const state =
    job.state === "running"
      ? "running"
      : job.state === "stopping"
        ? "stopping (exit not confirmed)"
      : job.state === "stopped"
        ? "stopped"
        : job.state === "failed"
          ? `failed to start${job.error === undefined ? "" : `: ${job.error}`}`
          : `exited ${job.exitCode ?? "?"}`;
  return `${job.id}  ${state}  ${job.command}`;
}

/** One command with its output, which is what a caller asking by id wants. */
function detail(job: JobStatus): string {
  const lines = [summarize(job), ""];
  if (job.dropped > 0) {
    // Said rather than implied. A tail that silently begins mid-stream reads
    // as the whole of the output, and a model looking for a startup line that
    // scrolled away will conclude it never printed.
    lines.push(`[${job.dropped} earlier lines dropped]`);
  }
  lines.push(job.output === "" ? "(no output yet)" : job.output);
  return lines.join("\n");
}

/** The unknown-id refusal, worded once because both registries answer it. */
function noSuchJob(id: string): ToolError {
  return new ToolError("invalid_input", {
    message: `There is no job ${id} in this conversation.`,
  });
}

/**
 * The generations' half, for ids minted by the generation tools.
 *
 * Split from the commands' half rather than merged with it because the two
 * registries answer different things at the same call: a command answers with
 * its output, a generation with its progress, and a shared code path would
 * need a third parameter to say which answer to produce. Undefined when this
 * composition has no generation registry, which is the same condition under
 * which no generation tool exists - so a `media_` id can only arrive when
 * there is a registry to read, and the answer says so plainly when it is not.
 */
function generationAnswer(
  mediaJobs: MediaJobs | undefined,
  conversationId: string,
  id: string,
  stop: boolean,
): string {
  if (mediaJobs === undefined) throw noSuchJob(id);

  if (stop) {
    if (!mediaJobs.stop(conversationId, id)) throw noSuchJob(id);
    const stopped = mediaJobs.get(conversationId, id);
    return stopped === undefined ? `Stopped ${id}.` : mediaJobDetail(stopped);
  }

  const job = mediaJobs.get(conversationId, id);
  if (job === undefined) throw noSuchJob(id);
  return mediaJobDetail(job);
}

export function createJobsTool(
  jobs: BackgroundJobs,
  mediaJobs?: MediaJobs,
): ToolDefinition<JobsInput, string> {
  return defineStudioTool({
    descriptor: JOBS_DESCRIPTOR,
    // No resource of its own: the thing being looked at is work this
    // conversation already started under its own approval.
    resourceKind: "command",
    resource: () => undefined,

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;
      if (value.id !== undefined && (typeof value.id !== "string" || value.id === "")) {
        throw new ToolError("invalid_input", { message: "id must be a job id." });
      }
      if (value.stop !== undefined && typeof value.stop !== "boolean") {
        throw new ToolError("invalid_input", { message: "stop must be true or false." });
      }
      if (value.stop === true && value.id === undefined) {
        // Refused rather than read as "stop everything". A caller that meant
        // one job and forgot the id would otherwise take down a dev server it
        // still needed, with nothing in the call saying so.
        throw new ToolError("invalid_input", {
          message: "Stopping takes the id of the job to stop.",
        });
      }
      return { id: value.id, stop: value.stop === true };
    },

    execute: async (input, context) => {
      const conversationId = context.scope.conversationId;

      if (input.id === undefined) {
        // One listing, both kinds: the commands first, then the generations.
        // A model looking for a running thing - or the person reading over
        // its shoulder - scans one list, not two, and the id's own prefix
        // tells the caller what it is addressing.
        const listed = [
          ...jobs.list(conversationId).map((job) => summarize(job)),
          ...(mediaJobs === undefined ? [] : mediaJobs.list(conversationId).map((job) => mediaJobSummary(job))),
        ];
        if (listed.length === 0) {
          return "This conversation has started no background jobs.";
        }
        return listed.join("\n");
      }

      if (input.id.startsWith("media_")) {
        return generationAnswer(mediaJobs, conversationId, input.id, input.stop);
      }

      if (input.stop) {
        // Scoped to the conversation, so an id guessed from another one is
        // "no such job" rather than a process somebody else was using.
        if (!jobs.stop(conversationId, input.id)) throw noSuchJob(input.id);
        const stopped = await jobs.waitForStop(conversationId, input.id);
        return stopped === undefined ? `Stop requested for ${input.id}; exit is not confirmed.` : detail(stopped);
      }

      const job = jobs.get(conversationId, input.id);
      if (job === undefined) throw noSuchJob(input.id);
      return detail(job);
    },
  });
}
