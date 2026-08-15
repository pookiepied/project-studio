import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { SandboxFactory, SessionEnv } from "@flue/runtime";

import { KeyringCredentialStore } from "../credentials/keyring-store.js";
import type { SecureCredentialStore } from "../credentials/credential-store.js";
import { capabilityKey, type ExecutionScope } from "../contracts/capabilities.js";
import { ExtendError } from "../extend/errors.js";
import { ExtensionInventory } from "../extend/inventory.js";
import { ExtensionReconciler } from "../extend/reconcile.js";
import { McpCapabilityCatalog } from "../extend/mcp/capabilities.js";
import type { McpTool } from "../extend/mcp/capabilities.js";
import { createMcpLauncher } from "../extend/mcp/launcher.js";
import { createMcpReconciler } from "../extend/mcp/reconcile.js";
import { McpServerRegistry } from "../extend/mcp/registry.js";
import { McpSupervisor } from "../extend/mcp/supervisor.js";
import { ExtensionSelectionStore } from "../extend/selection.js";
import { McpManagementService } from "./mcp-management.js";
import { modelToolName } from "./tool-name.js";
import { PermissionGrantStore } from "../permissions/grant-store.js";
import {
  PermissionKernel,
  type PermissionApprover,
} from "../permissions/kernel.js";
import type { ExecutionMode } from "../permissions/mode.js";
import { posture, WorkspaceTrustStore } from "../permissions/trust.js";
import { createErrorReporter } from "../observability/error-reporter.js";
import type { Logger } from "../observability/logger.js";
import { SandboxError } from "../sandbox/errors.js";
import { LocalSandbox } from "../sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../sandbox/policy.js";
import { projectKey } from "../snapshots/shadow-repo.js";
import { SnapshotStore } from "../snapshots/store.js";
import { TurnSnapshots } from "../snapshots/turn.js";
import { closeDatabase, getDatabase, type StudioDatabase } from "../storage/database.js";
import { CallGate } from "../tools/gate.js";
import { ToolError } from "../tools/errors.js";
import { registerNativeTools } from "../tools/native/index.js";

export interface StudioRuntimeOptions {
  readonly logger?: Logger;
  readonly approver?: PermissionApprover;
  readonly credentials?: SecureCredentialStore;
  readonly projectRoot?: string;
  readonly mode?: () => ExecutionMode;
  readonly clientId?: string;
  readonly sessionId?: string;
}

export interface StudioAgentSandboxOptions {
  readonly agentId: string;
  readonly conversationId?: string;
  readonly projectId?: string;
  readonly projectRoot?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textResult(value: unknown): string {
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "The MCP tool returned no result." : serialized;
}

/**
 * The content blocks the agent loop accepts — text and images, and nothing
 * else.
 *
 * These mirror `TextContent`/`ImageContent` from the model layer structurally
 * rather than importing them: they arrive through Flue from a transitive
 * dependency we do not declare, and importing across that boundary would couple
 * us to a package we have no version relationship with.
 *
 * MCP defines more block kinds than this — `resource` and `audio` among them —
 * and a server may return any of them. While this was `any[]` such a block was
 * forwarded straight into a loop that cannot represent it. It is now converted
 * to text instead, so an unsupported block degrades to something the model can
 * read rather than something the turn can fail on.
 */
type ModelTextContent = { readonly type: "text"; readonly text: string };
type ModelImageContent = {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
};
type ModelToolContent = ModelTextContent | ModelImageContent;

type ModelToolResult = {
  readonly content: ModelToolContent[];
  readonly details: unknown;
  readonly isError?: boolean;
};

function isSupportedContent(value: unknown): value is ModelToolContent {
  if (!isRecord(value)) return false;
  if (value["type"] === "text") return typeof value["text"] === "string";
  if (value["type"] === "image") {
    return typeof value["data"] === "string" && typeof value["mimeType"] === "string";
  }
  return false;
}

/** An unsupported block, rendered so its content still reaches the model. */
function asText(value: unknown): ModelTextContent {
  return { type: "text", text: textResult(value) };
}

function modelToolResult(value: unknown): ModelToolResult {
  if (isRecord(value) && Array.isArray(value["content"])) {
    return {
      content: value["content"].map((block) =>
        isSupportedContent(block) ? block : asText(block),
      ),
      details: value,
      ...(value["isError"] === true ? { isError: true } : {}),
    };
  }

  return {
    content: [asText(value)],
    details: value,
  };
}

function sessionEnvironment(sandbox: LocalSandbox): SessionEnv {
  const workspaceRoot = sandbox.policy.workspaceRoot;

  return {
    cwd: workspaceRoot,
    resolvePath: (path) => resolve(workspaceRoot, path),
    exec: async () => {
      throw new SandboxError("not_permitted", {
        message: "Shell execution is not available in the MCP agent sandbox.",
      });
    },
    readFile: (path) => sandbox.readFile(path),
    readFileBuffer: async (path) => readFile(sandbox.resolveRead(path)),
    writeFile: async (path, content) => {
      const target = sandbox.resolveWrite(path);
      await mkdir(sandbox.resolveWrite(dirname(path)), { recursive: true });
      await writeFile(target, content);
    },
    stat: async (path) => {
      const result = await sandbox.stat(path);
      return {
        isFile: result.isFile,
        isDirectory: result.isDirectory,
        size: result.size,
        mtime: new Date(result.modifiedAt),
      };
    },
    readdir: (path) => sandbox.readdir(path),
    // Flue's `SessionEnv.exists` is a total predicate, and the runtime calls it
    // on *ancestor* directories while discovering `AGENTS.md` before a turn.
    // `LocalSandbox.exists` deliberately throws for a path outside the
    // workspace (see `local-sandbox.ts`) so a model-facing probe cannot walk
    // out; that rule is right for the tool path and wrong here, where the
    // caller is Flue itself and a throw aborts the whole submission with a 500.
    // Answering `false` leaks nothing: it is the same answer for every path
    // outside the workspace, present or not.
    exists: async (path) => {
      try {
        return await sandbox.exists(path);
      } catch (error) {
        if (error instanceof SandboxError) return false;
        throw error;
      }
    },
    mkdir: (path) => sandbox.mkdir(path),
    rm: (path) => sandbox.remove(path),
  };
}

export class StudioRuntime {
  readonly db: StudioDatabase;
  readonly grants: PermissionGrantStore;
  readonly trust: WorkspaceTrustStore;
  readonly selection: ExtensionSelectionStore;
  readonly inventory: ExtensionInventory;
  readonly extensions: ExtensionReconciler;
  readonly registry: McpServerRegistry;
  readonly supervisor: McpSupervisor;
  readonly catalog: McpCapabilityCatalog;
  readonly management: McpManagementService;

  readonly #logger: Logger | undefined;
  readonly #approver: PermissionApprover | undefined;
  readonly #credentials: SecureCredentialStore;
  readonly #projectRoot: string;
  readonly #projectId: string;
  readonly #mode: () => ExecutionMode;
  readonly #clientId: string;
  readonly #sessionId: string;
  readonly #turns = new Set<() => void>();
  #started: Promise<void> | undefined;

  constructor(options: StudioRuntimeOptions = {}) {
    this.#logger = options.logger;
    this.#approver = options.approver;
    this.#credentials = options.credentials ?? new KeyringCredentialStore();
    this.#projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.#projectId = projectKey(this.#projectRoot);
    this.#mode = options.mode ?? (() => "manual");
    this.#clientId = options.clientId ?? "standalone";
    this.#sessionId = options.sessionId ?? "standalone";

    this.db = getDatabase();
    this.grants = new PermissionGrantStore(this.db);
    this.trust = new WorkspaceTrustStore(this.db);
    this.selection = new ExtensionSelectionStore(this.db);
    this.inventory = new ExtensionInventory(this.selection);
    this.extensions = new ExtensionReconciler(this.inventory);
    this.registry = new McpServerRegistry(this.db);
    this.catalog = new McpCapabilityCatalog({
      diagnostic: (message, serverId) =>
        this.#logger?.warn(message, { server_id: serverId }),
      isServerEnabled: (serverId) =>
        this.selection.isEnabled({
          kind: "mcp",
          extensionId: serverId,
          projectId: this.#projectId,
        }),
    });
    this.supervisor = new McpSupervisor({
      launch: createMcpLauncher({
        credentials: this.#credentials,
        projectRoot: () => this.#projectRoot,
      }),
      onReady: async (record, connection) => {
        await this.catalog.refresh(record, connection);
      },
      onUnavailable: (record) => this.catalog.remove(record.id),
      onNotification: (record, method) => {
        if (method === "notifications/tools/list_changed") {
          this.catalog.markDirty(record.id);
        }
      },
    });

    this.inventory.register("mcp", () => this.registry.asExtensions());
    this.extensions.register(
      "mcp",
      createMcpReconciler({
        registry: this.registry,
        supervisor: this.supervisor,
        onStop: (serverId) => this.catalog.remove(serverId),
      }),
    );
    this.management = new McpManagementService({
      registry: this.registry,
      grants: this.grants,
      selection: this.selection,
      supervisor: this.supervisor,
      extensions: this.extensions,
      credentials: this.#credentials,
    });
  }

  get projectId(): string {
    return this.#projectId;
  }

  get projectRoot(): string {
    return this.#projectRoot;
  }

  start(): Promise<void> {
    this.#started ??= this.extensions.reconcile([this.#projectId]).then(() => undefined);
    return this.#started;
  }

  async reconcile(): Promise<void> {
    await this.extensions.reconcile([this.#projectId]);
  }

  async prepareModelTurn(): Promise<void> {
    await this.reconcile();
    await this.catalog.refreshDirty(this.registry.list());
    for (const beginTurn of this.#turns) beginTurn();
  }

  createAgentSandbox(options: StudioAgentSandboxOptions): SandboxFactory {
    const projectRoot = resolve(options.projectRoot ?? this.#projectRoot);
    const projectId = options.projectId ?? projectKey(projectRoot);
    const scope: ExecutionScope = {
      clientId: this.#clientId,
      sessionId: this.#sessionId,
      agentId: options.agentId,
      conversationId: options.conversationId ?? `conversation:${options.agentId}`,
      projectId,
    };
    const policy = createSandboxPolicy({ workspaceRoot: projectRoot });
    const sandbox = new LocalSandbox(policy);
    const reporter = createErrorReporter(
      this.#logger === undefined ? {} : { logger: this.#logger },
    );
    const snapshots = new TurnSnapshots({
      store: new SnapshotStore({ workspaceRoot: projectRoot }),
      required: () => this.#mode() === "full-auto",
      reporter,
    });
    this.#turns.add(() => snapshots.beginTurn());
    const gate = new CallGate({
      kernel: new PermissionKernel({
        grants: this.grants,
        ...(this.#approver === undefined ? {} : { approver: this.#approver }),
        posture: posture({ mode: this.#mode, trust: this.trust }),
        reporter,
      }),
      sandbox,
      snapshots,
      reporter,
      onWithheld: (event) =>
        this.#logger?.info(
          `Withheld ${event.capability} because ${event.switchName} is off.`,
          { capability: event.capability, switch: event.switchName },
        ),
    });
    registerNativeTools(gate, {
      database: this.db,
      credentials: this.#credentials,
    });

    const registeredMcp = new Map<string, McpTool>();

    const refreshTools = (): void => {
      const active = this.registry
        .list()
        .filter((record) =>
          this.selection.isEnabled({
            kind: "mcp",
            extensionId: record.id,
            projectId,
          }),
        )
        .map((record) => record.id);

      for (const tool of this.catalog.tools(active)) {
        const key = capabilityKey(tool.descriptor.id);
        const existing = registeredMcp.get(key);
        if (existing === tool) continue;
        if (existing !== undefined) gate.unregister(existing.descriptor.id);
        gate.register(tool);
        registeredMcp.set(key, tool);
      }
    };

    return {
      createSessionEnv: async () => sessionEnvironment(sandbox),
      tools: (_env, _options) => {
        refreshTools();
        const names = new Set<string>();
        return gate.list().flatMap((descriptor) => {
          const name = modelToolName(descriptor.id.namespace, descriptor.id.name);
          if (names.has(name)) {
            throw new ToolError("name_conflict", {
              message: `Two capabilities would be exposed as "${name}".`,
              tool: name,
            });
          }
          names.add(name);
          const schema = isRecord(descriptor.inputSchema)
            ? descriptor.inputSchema
            : { type: "object", properties: {} };
          return [{
            name,
            label: descriptor.title,
            description: descriptor.description,
            parameters: schema,
            execute: async (
              _toolCallId: string,
              input: unknown,
              signal?: AbortSignal,
            ): Promise<ModelToolResult> => {
              try {
                const result = await gate.call({
                  name: capabilityKey(descriptor.id),
                  input,
                  scope,
                  ...(signal === undefined ? {} : { signal }),
                });
                return modelToolResult(result);
              } catch (error) {
                if (error instanceof ToolError && error.kind === "unavailable") {
                  return {
                    content: [{ type: "text", text: error.message }],
                    details: { isError: true, unavailable: true },
                    isError: true,
                  };
                }
                throw error;
              }
            },
          }];
        });
      },
    };
  }

  stop(): void {
    this.supervisor.stopAll();
    closeDatabase();
  }
}

let configuredRuntime: StudioRuntime | undefined;

export function configureStudioRuntime(runtime: StudioRuntime): void {
  if (configuredRuntime !== undefined) {
    throw new ExtendError("internal", {
      message: "The Studio runtime has already been configured.",
    });
  }
  configuredRuntime = runtime;
}

export function getStudioRuntime(): StudioRuntime {
  if (configuredRuntime === undefined) {
    throw new ExtendError("internal", {
      message: "The Studio runtime has not been configured.",
    });
  }
  return configuredRuntime;
}
