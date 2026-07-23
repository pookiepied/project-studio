import { defineTool } from "@flue/runtime";
import * as v from "valibot";

export const workspaceSummary = defineTool({
  name: "workspace_summary",
  description: "Return a deterministic summary for a named workspace.",
  input: v.object({
    workspace: v.pipe(v.string(), v.minLength(1)),
  }),
  output: v.object({
    workspace: v.string(),
    status: v.literal("ready"),
  }),
  async run({ input }) {
    return {
      workspace: input.workspace,
      status: "ready" as const,
    };
  },
});
