import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import type { BackgroundJobs, JobStatus } from "../../process/background.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";

/**
 * Reading and ending the commands that were started in the background.
 *
 * One tool rather than three, because the three things a caller wants to do
 * here - see what is running, read what one has printed, stop it - are the
 * same question asked with more or less of an id. A separate `list`, `output`
 * and `stop` would be three capabilities to approve for what is, in every
 * case, looking at processes this conversation already started.
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
  title: "Background commands",
  description:
    "Lists the commands this conversation started in the background, reads " +
    "one job's recent output, or stops one. Call with no arguments to list " +
    'them, with {"id": "job_1"} to read that one, and with {"id": "job_1", ' +
    '"stop": true} to end it. Only the most recent output is kept.',
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
  // nothing, and stopping ends a process this same conversation was already
  // approved to start. A second approval to end it would leave "leave it
  // running" as the only unapproved path, which is backwards.
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
  // Listing and reading are; stopping a stopped job is a no-op. Nothing here
  // does something different the second time.
  idempotent: true,
};

/** One job as a person reads it, without its output. */
function summarize(job: JobStatus): string {
  const state =
    job.state === "running"
      ? "running"
      : job.state === "stopped"
        ? "stopped"
        : job.state === "failed"
          ? `failed to start${job.error === undefined ? "" : `: ${job.error}`}`
          : `exited ${job.exitCode ?? "?"}`;
  return `${job.id}  ${state}  ${job.command}`;
}

/** One job with its output, which is what a caller asking by id wants. */
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

export function createJobsTool(jobs: BackgroundJobs): ToolDefinition<JobsInput, string> {
  return defineStudioTool({
    descriptor: JOBS_DESCRIPTOR,
    // No resource of its own: the thing being looked at is a process this
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
        const running = jobs.list(conversationId);
        if (running.length === 0) {
          return "This conversation has started no background commands.";
        }
        return running.map((job) => summarize(job)).join("\n");
      }

      if (input.stop) {
        // Scoped to the conversation, so an id guessed from another one is
        // "no such job" rather than a process somebody else was using.
        if (!jobs.stop(conversationId, input.id)) {
          throw new ToolError("invalid_input", {
            message: `There is no job ${input.id} in this conversation.`,
          });
        }
        const stopped = jobs.get(conversationId, input.id);
        return stopped === undefined ? `Stopped ${input.id}.` : detail(stopped);
      }

      const job = jobs.get(conversationId, input.id);
      if (job === undefined) {
        throw new ToolError("invalid_input", {
          message: `There is no job ${input.id} in this conversation.`,
        });
      }
      return detail(job);
    },
  });
}
