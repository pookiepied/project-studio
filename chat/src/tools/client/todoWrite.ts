import { Type } from "@sinclair/typebox";
import { BaseTool } from "../base/BaseTool";
import { ToolContext, ToolResult } from "../base/types";

/**
 * Client-native UI state manager — executed entirely in the STUDIO frontend.
 *
 * executionTarget "client" means the backend defers this to the frontend via
 * local_tools_pending. The STUDIO ChatContext intercepts the call, updates
 * React state, and returns a confirmation — no Worker execution needed.
 */
export class TaskWriteTool extends BaseTool {
  readonly name = "task_write";
  readonly executionTarget = "client" as const;
  readonly group = "client" as const;
  readonly tier = 1 as const;
  readonly allowInSubAgent = false; // task management is the parent agent's responsibility

  readonly description =
    "Create and manage a structured task checklist for the current session. " +
    "Use proactively for multi-step tasks (3+ steps). Each item has a content (imperative), " +
    "activeForm (present-continuous), and status (pending | in_progress | completed). " +
    "Keep exactly one task in_progress at a time. Mark tasks completed immediately when done. " +
    "When all tasks are completed, call this tool with the completed list to clear it.";

  readonly parameters = Type.Object({
    todos: Type.Array(
      Type.Object({
        content: Type.String({
          description: "Imperative form of the task, e.g. 'Fix the authentication bug'",
        }),
        activeForm: Type.String({
          description: "Present-continuous form shown while executing, e.g. 'Fixing the authentication bug'",
        }),
        status: Type.Union([
          Type.Literal("pending"),
          Type.Literal("in_progress"),
          Type.Literal("completed"),
        ], {
          description: "Current status of the task",
        }),
      }),
      { description: "The complete, updated todo list (replaces the previous list)" }
    ),
  });

  async execute(_args: any, _context?: ToolContext): Promise<ToolResult> {
    return this.errorResult("task_write must be handled by the STUDIO client.");
  }
}

export const taskWriteTool = new TaskWriteTool();
