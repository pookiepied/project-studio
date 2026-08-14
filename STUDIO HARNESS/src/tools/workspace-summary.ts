import { NATIVE_PROVENANCE, type CapabilityDescriptor } from "../contracts/capabilities.js";
import { ToolError } from "./errors.js";
import type { CallGate } from "./gate.js";
import { defineStudioTool, type ToolDefinition } from "./types.js";

export interface WorkspaceSummaryInput {
  readonly workspace: string;
}

export const WORKSPACE_SUMMARY_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "workspace_summary" },
  title: "Summarize workspace",
  description: "Return a deterministic summary for a named workspace.",
  inputSchema: {
    type: "object",
    properties: { workspace: { type: "string", minLength: 1 } },
    required: ["workspace"],
    additionalProperties: false,
  },
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
  idempotent: true,
};

export function createWorkspaceSummaryTool(): ToolDefinition<WorkspaceSummaryInput, {
  readonly workspace: string;
  readonly status: "ready";
}> {
  return defineStudioTool({
    descriptor: WORKSPACE_SUMMARY_DESCRIPTOR,
    resourceKind: "command",
    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;
      if (typeof value.workspace !== "string" || value.workspace.trim() === "") {
        throw new ToolError("invalid_input", { message: "workspace is required." });
      }
      return { workspace: value.workspace };
    },
    resource: () => undefined,
    execute: async (input) => ({
      workspace: input.workspace,
      status: "ready",
    }),
  });
}

export function registerWorkspaceSummaryTool(gate: CallGate): void {
  gate.register(createWorkspaceSummaryTool());
}
