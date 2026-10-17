import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import type {
  PlanItemReport,
  PlanItemWrite,
  PlanStatus,
  PlanView,
} from "../../plan/plan.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";

/**
 * The run's stated intention, as durable rows the person can see and change.
 *
 * The plan is not a message the model draws and the transcript scrolls away:
 * the store is the truth, this tool writes into it, the person ticks into it
 * from the panel, and the result of every write is the whole list as it now
 * stands - which is the only channel by which the person's edits reach the
 * model.
 *
 * It declares `read` and nothing else, and that is the honest answer rather
 * than a workaround, for the same reason the ask tool declares `read`: the
 * tool's whole action is recording an intention, it changes nothing outside
 * its own table, and it must work in an untrusted folder. A plan tool that
 * raised an approval would mean the person approves the run's note-taking.
 */

const MIN_ITEMS = 1;
/** A wall, not a target. The description says the useful size is three to seven. */
const MAX_ITEMS = 20;

const STATUS_VALUES: readonly PlanStatus[] = [
  "pending",
  "running",
  "done",
  "failed",
  "cancelled",
];

const STATUS_BY_TEXT: ReadonlyMap<string, PlanStatus> = new Map(
  STATUS_VALUES.map((status) => [status, status]),
);

export const PLAN_TOOL_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "plan" },
  title: "Plan",
  description:
    "Records the run's plan as a list the person can see and change. Use it when the work has " +
    "several distinct steps the person benefits from watching; three to seven items is the " +
    "useful size, twenty is the ceiling, and a plan for a single-step answer is noise that " +
    "trains the person to stop reading. Calls merge by id: an id you have used before addresses " +
    "the same item. Every item you send, including a status update, requires id, text and status. " +
    "For example: {\"items\":[{\"id\":\"build\",\"text\":\"Build the project\",\"status\":\"done\"}]}. " +
    "A call changes only the items it names - every item you leave out keeps " +
    "its current state, because the person may have ticked it in the meantime. The result is the " +
    "whole current list after your change, and it may contain their edits: an item they marked " +
    "done is done, so do not redo it and do not mark it back. Statuses are honest or the list is " +
    "worthless: running means it is happening now (one item at a time in the normal case), done " +
    "means finished rather than started, and failed means it failed - say so when it does, " +
    "because a plan where nothing ever fails is a plan nobody believes. This records intention " +
    "and runs nothing; to hand work to a subagent, use task.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        minItems: MIN_ITEMS,
        maxItems: MAX_ITEMS,
        items: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            text: { type: "string", minLength: 1 },
            status: { type: "string", enum: [...STATUS_VALUES] },
          },
          required: ["id", "text", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
  // A repeated call with the same arguments leaves the same rows: the merge
  // assigns and overwrites rather than appends. A retry after an unknown
  // outcome cannot double-write an item.
  idempotent: true,
};

export interface PlanToolInput {
  readonly items: readonly PlanItemWrite[];
}

/** What the tool returns: the whole list, every time. */
export interface PlanToolReport {
  readonly items: readonly PlanItemReport[];
}

/**
 * The tool depends on the conversation's plan and nothing else. Supplied by
 * the runtime that registers it; a registration without one would offer a
 * plan tool that writes nowhere.
 */
export interface PlanToolDependencies {
  /** Merges the named items as the model, then reads the whole plan back. */
  readonly merge: (conversationId: string, items: readonly PlanItemWrite[]) => PlanView;
}

export function createPlanTool(
  dependencies: PlanToolDependencies,
): ToolDefinition<PlanToolInput, PlanToolReport> {
  return defineStudioTool({
    descriptor: PLAN_TOOL_DESCRIPTOR,
    resourceKind: "command",
    resource: () => undefined,

    parse: (input): PlanToolInput => {
      const value = (input ?? {}) as Record<string, unknown>;
      const rawItems = value["items"];
      if (!Array.isArray(rawItems) || rawItems.length < MIN_ITEMS) {
        throw new ToolError("invalid_input", {
          message: "items is required: at least one item to record.",
        });
      }
      if (rawItems.length > MAX_ITEMS) {
        throw new ToolError("invalid_input", {
          message: `At most ${MAX_ITEMS} items fit in one call; the useful size is three to seven.`,
        });
      }

      const seen = new Set<string>();
      const items: PlanItemWrite[] = [];
      for (const raw of rawItems) {
        const item = parseItem(raw);
        if (seen.has(item.id)) {
          throw new ToolError("invalid_input", {
            message: `Two items in this call share the id "${item.id}"; an id addresses one item.`,
          });
        }
        seen.add(item.id);
        items.push(item);
      }
      return { items };
    },

    execute: async (input, context) => {
      const view = dependencies.merge(context.scope.conversationId, input.items);

      // An unreadable plan cannot be returned as the truth, and a partial one
      // that claims to be whole is worse than an error: the model would build
      // its next step on a list that silently lost rows.
      if (view.damaged) {
        throw new ToolError("execution_failed", {
          message:
            "The plan could not be read back after writing; its stored items are damaged.",
        });
      }
      return {
        items: view.items.map((item) => ({
          id: item.id,
          text: item.text,
          status: item.status,
          updatedBy: item.updatedBy,
        })),
      };
    },
  });
}

function parseItem(raw: unknown): PlanItemWrite {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ToolError("invalid_input", {
      message: "Each item must be an object with an id, a text, and a status.",
    });
  }
  const value = raw as Record<string, unknown>;

  const id = value["id"];
  if (typeof id !== "string" || id.trim() === "") {
    throw new ToolError("invalid_input", {
      message: "Each item needs a short id you will reuse for the same item.",
    });
  }

  const text = value["text"];
  if (typeof text !== "string" || text.trim() === "") {
    throw new ToolError("invalid_input", {
      message: `The item "${id}" needs its sentence.`,
    });
  }

  const rawStatus = value["status"];
  const status = typeof rawStatus === "string" ? STATUS_BY_TEXT.get(rawStatus) : undefined;
  if (status === undefined) {
    throw new ToolError("invalid_input", {
      message: `The status of "${id}" must be one of: ${STATUS_VALUES.join(", ")}.`,
    });
  }

  return { id, text, status };
}
