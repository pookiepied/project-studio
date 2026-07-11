import { jsonSchema, type Tool, type ToolSet } from "ai";
import {
  DEFAULT_TOOL_POLICY,
  type ContextPackage,
  type StudioToolDescriptor,
  type ToolPolicy,
} from "@studio/v2-contracts";
import { ToolExecutionCoordinator } from "./coordinator";
import type { Env } from "../system/env";

/**
 * Tool execution boundary (RUNTIME-CHECKLIST.md §7–§9). Every tool the model
 * can call passes through `wrapToolSet`, which enforces the runtime's
 * guarantees around the AI SDK's execution:
 *
 * - Idempotency: the operation is atomically reserved before executing; a
 *   retried/recovered run returns the previous result instead of repeating a
 *   side effect, and a non-idempotent operation that may already have run is
 *   refused rather than blindly repeated.
 * - Approval: the runtime never decides permissions — the frontend/parent
 *   does. `requestApproval` persists the request, parks the run at the
 *   boundary, and waits for exactly one resolution.
 * - Timeout and result-size limits from the tool's policy.
 */

/** What a registered tool looks like: the AI SDK tool plus its policy. */
export interface RegisteredTool {
  tool: Tool;
  policy: ToolPolicy;
}

/** Runtime services the wrapper needs from the ExecutionSession. */
export interface ToolRuntime {
  runId: string;
  coordinator: ToolExecutionCoordinator;
  reserve(toolCallId: string): {
    status: "reserved" | "executing" | "completed" | "failed";
    result?: string;
  };
  mark(
    toolCallId: string,
    status: "executing" | "completed" | "failed",
    result?: string,
  ): void;
  /** Park the run and ask the frontend; resolves with its verdict. */
  requestApproval(
    toolCallId: string,
    toolName: string,
    input: unknown,
    policy: ToolPolicy,
  ): Promise<boolean>;
}

export function wrapToolSet(
  tools: Record<string, RegisteredTool>,
  runtime: ToolRuntime,
): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, { tool, policy }] of Object.entries(tools)) {
    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, options: { toolCallId: string }) => {
        if (!tool.execute) {
          throw new Error(`Tool ${name} has no execute implementation.`);
        }
        const execute = tool.execute;
        const { toolCallId } = options;
        const record = runtime.reserve(toolCallId);

        // A previous attempt already ran this call — never repeat the effect.
        if (record.status === "completed") {
          return record.result !== undefined
            ? JSON.parse(record.result)
            : undefined;
        }
        // It may have started and died mid-flight. Idempotent → safe to
        // re-run; otherwise refusing is the only safe answer (§8).
        if (record.status === "executing" && !policy.idempotent) {
          runtime.mark(toolCallId, "failed");
          throw new Error(
            `Operation ${name}:${toolCallId} may already have executed; refusing to repeat a non-idempotent side effect.`,
          );
        }

        return runtime.coordinator.run(policy.concurrencyKey, async () => {
          if (policy.requiresApproval) {
            const approved = await runtime.requestApproval(
              toolCallId,
              name,
              input,
              policy,
            );
            if (!approved) {
              runtime.mark(toolCallId, "failed", JSON.stringify("denied"));
              throw new Error(`Tool call ${name} was denied by the user.`);
            }
          }

          runtime.mark(toolCallId, "executing");
          try {
            const result = await withTimeout(
              Promise.resolve(execute(input as never, options as never)),
              policy.timeoutMs,
              name,
            );
            const serialized = clamp(JSON.stringify(result) ?? "null", policy.maxResultBytes);
            runtime.mark(toolCallId, "completed", serialized);
            return JSON.parse(serialized);
          } catch (error) {
            runtime.mark(toolCallId, "failed");
            throw error;
          }
        });
      },
    } as Tool;
  }
  return wrapped;
}

function withTimeout<T>(work: Promise<T>, ms: number, name: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool ${name} timed out after ${ms}ms.`)), ms),
    ),
  ]);
}

function clamp(json: string, maxBytes: number): string {
  if (json.length <= maxBytes) return json;
  return JSON.stringify(`${json.slice(0, maxBytes)}… [truncated]`);
}

/**
 * Tool exposure: translates the context package's relevant capabilities
 * (connectors, MCP servers, skills, delegation) into RegisteredTools. Lands
 * with the Studio Context integration — until then the loop runs tool-less.
 */
export function buildToolSet(
  context: ContextPackage,
  env: Pick<Env, "MCP">,
  executeLocal: (toolCallId:string,descriptor:StudioToolDescriptor,input:unknown)=>Promise<unknown>,
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};
  for (const descriptor of context.tools) {
    tools[descriptor.name] = {
      tool: descriptorToAiTool(descriptor, context, env, executeLocal),
      policy: {
        ...DEFAULT_TOOL_POLICY,
        locality: descriptor.location,
        ...descriptor.policy,
      },
    };
  }
  return tools;
}

export { DEFAULT_TOOL_POLICY };

function descriptorToAiTool(
  descriptor: StudioToolDescriptor,
  context: ContextPackage,
  env: Pick<Env, "MCP">,
  executeLocal: (toolCallId:string,descriptor:StudioToolDescriptor,input:unknown)=>Promise<unknown>,
): Tool {
  return {
    description: descriptor.description,
    inputSchema: jsonSchema(descriptor.inputSchema),
    execute: async (input: unknown, options: { toolCallId: string }) => {
      const args = withRuntimeArgs(input, descriptor, context);
      switch (descriptor.route.kind) {
        case "connector":
          return callHub(env.MCP, descriptor.route.hubPath ?? "/internal/composio/execute", {
            slug: descriptor.route.slug,
            connectionId: descriptor.route.connectionId,
            entityId: descriptor.route.entityId,
            args,
          });
        case "native-cloud":
          return callHub(env.MCP, descriptor.route.hubPath ?? "/internal/native/execute", {
            serviceId: descriptor.route.serviceId,
            toolName: descriptor.route.toolName,
            toolArgs: args,
          });
        case "remote-mcp":
          return callHub(env.MCP, descriptor.route.hubPath ?? "/internal/remote/execute", {
            url: descriptor.route.endpoint,
            toolName: descriptor.route.toolName,
            args,
          });
        case "local-relay":
          return executeLocal(options.toolCallId, descriptor, args);
        case "client":
          throw new Error(
            `Tool ${descriptor.name} requires client action '${descriptor.route.action}'; client tool result protocol is not wired yet.`,
          );
      }
    },
  } as Tool;
}

function withRuntimeArgs(
  input: unknown,
  descriptor: StudioToolDescriptor,
  context: ContextPackage,
): Record<string, unknown> {
  const args =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};
  const properties = descriptor.inputSchema.properties;
  if (
    properties &&
    typeof properties === "object" &&
    "user_id" in properties &&
    args.user_id === undefined
  ) {
    args.user_id = context.userId;
  }
  return args;
}

async function callHub(
  hub: Fetcher,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await hub.fetch(`http://internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload: { success?: boolean; data?: unknown; error?: unknown };
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Studio MCP hub returned HTTP ${response.status}.`);
  }
  if (!response.ok || payload.success === false) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : JSON.stringify(payload.error ?? `Studio MCP hub returned HTTP ${response.status}`),
    );
  }
  return payload.data ?? payload;
}
