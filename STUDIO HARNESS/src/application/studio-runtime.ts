import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Sandbox, SandboxFactory } from "@flue/runtime";

import { KeyringCredentialStore } from "../credentials/keyring-store.js";
import type { SecureCredentialStore } from "../credentials/credential-store.js";
import { capabilityKey, type ExecutionScope } from "../contracts/capabilities.js";
import { DEFAULT_MODEL_NAME, DEFAULT_MODEL_PROVIDER } from "../contracts/models.js";
import { bootstrappedModelRegistry } from "../models/bootstrap.js";
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
import { McpManagementService, type McpAdministration } from "./mcp-management.js";
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
import type { QuestionBroker } from "./question-broker.js";
import {
  conversationArtifactsDirectory,
  conversationAttachmentsDirectory,
  conversationWorkspaceDirectory,
  ensureDirectory,
} from "../platform/paths.js";
import { SandboxError } from "../sandbox/errors.js";
import { LocalSandbox } from "../sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../sandbox/policy.js";
import { projectKey } from "../snapshots/shadow-repo.js";
import { SnapshotStore } from "../snapshots/store.js";
import { TurnSnapshots } from "../snapshots/turn.js";
import type { StudioDatabase } from "../storage/database.js";
import { CallGate } from "../tools/gate.js";
import { ToolError } from "../tools/errors.js";
import { ClosingTurns } from "../execution/closing-turns.js";
import { registerNativeTools } from "../tools/native/index.js";
import { FileAccessLog } from "../tools/filesystem/index.js";
import { ConversationStore } from "../conversations/store.js";

export interface StudioRuntimeOptions {
  /**
   * The application database.
   *
   * Required, and never resolved from a module global. The runtime used to
   * reach for the process-wide connection, which meant it silently shared
   * whatever was opened first — so a test that set `PROJECT_STUDIO_STORE_PATH`
   * got the *previous* test's database and could not tell (ADR 0035 §3).
   */
  readonly database: StudioDatabase;
  readonly logger?: Logger;
  readonly approver?: PermissionApprover;
  /**
   * The channel the ask-a-question tool asks through.
   *
   * Optional the same way the approver is: the composition root always
   * supplies one, and a composition without it does not offer the tool at
   * all, because a question with nowhere to be answered is not a capability.
   */
  readonly questions?: QuestionBroker;
  readonly credentials?: SecureCredentialStore;
  readonly projectRoot?: string;
  readonly clientId?: string;
  readonly sessionId?: string;
  // There was a `mode?: () => ExecutionMode` here, and nothing passed it: the
  // mode was a process-wide callback with no writer, so every conversation ran
  // Manual forever. It is gone rather than kept as dead surface. The mode is a
  // per-conversation consent now, stored in the conversation index and read
  // from there wherever the mode is actually consulted - see
  // `createAgentSandbox`, the one place a kernel and a posture are built,
  // which always knows which conversation it is building them for.
}

export interface StudioAgentSandboxOptions {
  /** The agent, not the thread - see `contracts/agents.ts`. */
  readonly agentId: string;
  /**
   * The conversation the sandbox and its permission scope belong to.
   *
   * Required, and deliberately without a default. Under Flue 2.0 the agent
   * instance id IS the conversation id, so the caller passes it bare - the
   * 1.0 `conversation:` prefix is gone from the scope vocabulary. The guard
   * #69 bought stays: the scope is built from the instance id, and the agent
   * is named separately, so a standing grant can leave the thread that gave
   * it only through the duration it was granted for. A default here would
   * collapse every conversation of one agent into a single permission scope
   * the moment the two readings of "id" drift apart again (ADR 0015's
   * reasoning, one level down).
   */
  readonly conversationId: string;
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
  /**
   * Ends the agent's turn once the tool batch settles, and only when every
   * result in the batch says so - Flue's own loop-ending contract, reached
   * for exactly once: to hold a stopped run to one closing message.
   */
  readonly terminate?: boolean;
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

function sessionEnvironment(sandbox: LocalSandbox): Sandbox {
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
    // Flue's `exists` is a total predicate, and the runtime calls it
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

/**
 * What the Flue agent module needs from the runtime.
 *
 * `agents/studio.ts` is loaded by Flue's own module resolution, so there is no
 * point at which anything can be injected into it — which is why a service
 * locator exists there at all. This is the narrowest type that locator can
 * return, and it is two members, not the class (ADR 0035 §6): the sandbox
 * factory the render mounts, and the turn-settings read that decides the
 * model. Everything else the run needs - runtime start, extension
 * reconciliation, the conversation's directories - happens inside the
 * factory's `createSandbox`, once per submission, where the measured
 * ordering puts it.
 */
export interface AgentHost {
  createAgentSandbox(options: StudioAgentSandboxOptions): SandboxFactory;
  /**
   * The model and reasoning level a conversation is held with, as the render
   * needs them: the model reference in the local runtime's own
   * `<provider>/<model>` vocabulary, or null for the stable default alias,
   * and the stored reasoning choice or null for the provider's own default.
   *
   * Read once per render, synchronously. Flue re-renders for every run, so a
   * conversation whose model changed between turns takes the new one on the
   * next run, and a run already in flight keeps the model its own
   * submission started with - that is the behaviour, not an accident to fix.
   */
  conversationTurnSettings(conversationId: string): {
    readonly modelId: string | null;
    readonly reasoningLevel: string | null;
  };
}

/**
 * The application runtime.
 *
 * Every repository below is private. They were public because composition
 * happened here and nothing stopped it leaking; counting the callers showed six
 * of the ten had no consumer outside this class at all (ADR 0035 §1). What the
 * outside needs is exposed deliberately: `servers` for the HTTP surface, and
 * the `AgentHost` members for the Flue agent module.
 */
export class StudioRuntime implements AgentHost {
  readonly #db: StudioDatabase;
  readonly #conversations: ConversationStore;
  readonly #grants: PermissionGrantStore;
  readonly #trust: WorkspaceTrustStore;
  readonly #selection: ExtensionSelectionStore;
  readonly #inventory: ExtensionInventory;
  readonly #extensions: ExtensionReconciler;
  readonly #registry: McpServerRegistry;
  readonly #supervisor: McpSupervisor;
  readonly #catalog: McpCapabilityCatalog;
  readonly #management: McpManagementService;

  readonly #logger: Logger | undefined;
  readonly #approver: PermissionApprover | undefined;
  readonly #questions: QuestionBroker | undefined;
  readonly #credentials: SecureCredentialStore;
  readonly #projectRoot: string;
  readonly #projectId: string;
  readonly #clientId: string;
  readonly #sessionId: string;
  /**
   * Turn state, one entry per **project**.
   *
   * Was a `Set` of closures with no key, appended to by `createAgentSandbox`.
   * Flue re-runs an agent's initializer for **every run** — its own words: "Do
   * not treat it as a one-time constructor" — so that set gained an entry per
   * run and `prepareModelTurn` called `beginTurn()` on the snapshots of every
   * sandbox ever built, forever. Keying it fixed that (#67): the entry has to
   * be *reused*, because `TurnSnapshots` carries the turn counter and a fresh
   * one per run restarts it, labelling the first snapshot of every run
   * "turn 1".
   *
   * **The key was `projectId\0conversationId` and is now `projectId` alone.**
   * That is the answer to #72, which asked what should evict this map: nothing
   * should, because per-conversation is the wrong unit and it was the only
   * reason the map grew. Three measured defects came from that key, and all
   * three are the same mistake — conversation-scoped state in front of a
   * project-scoped resource:
   *
   * 1. **Two shadow repositories over one git directory (#83).**
   *    `SnapshotStore`'s `gitDir` is derived from the workspace root alone, so
   *    two conversations in one project built two `ShadowRepository` objects
   *    against the same directory — each with its own serialization queue. That
   *    queue exists *specifically* to stop two `add`/`commit` pairs
   *    interleaving on git's single index (T-17), and two queues do not
   *    serialize against each other.
   * 2. **Every conversation's counter advanced on every turn (#84).**
   *    `prepareModelTurn()` looped the whole map, so an idle conversation's
   *    number climbed with someone else's turns and its pending capture was
   *    cleared underneath it.
   * 3. **Labels collided in a shared history (#85).** Both conversations wrote
   *    "turn 1" into the same log, and nothing distinguished them.
   *
   * With one entry per project all three disappear rather than being fixed
   * separately, and `turn N` regains an unambiguous meaning: the Nth turn taken
   * in this project, which is exactly what the one history it is written to
   * records. Growth is now bounded by the workspace roots a process serves.
   */
  readonly #turnSnapshots = new Map<string, TurnSnapshots>();
  /**
   * What each conversation has read, for as long as the conversation lasts.
   *
   * Held here rather than built inside `registerNativeTools`, because that
   * runs inside `createAgentSandbox` and Flue re-runs an agent's initializer
   * for every turn. A log built there remembered one run: a file read in the
   * first message had to be read again in the second before it could be
   * edited, and the rule that exists to stop a blind overwrite was charging
   * the conversation for a read it had already done. Keyed by conversation
   * for the same reason the log's own key is - "I have seen this file" is one
   * conversation's knowledge - and cleared with the conversation.
   */
  readonly #accessLogs = new Map<string, FileAccessLog>();
  #started: Promise<void> | undefined;

  constructor(options: StudioRuntimeOptions) {
    this.#logger = options.logger;
    this.#approver = options.approver;
    this.#questions = options.questions;
    this.#credentials = options.credentials ?? new KeyringCredentialStore();
    this.#projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.#projectId = projectKey(this.#projectRoot);
    this.#clientId = options.clientId ?? "standalone";
    this.#sessionId = options.sessionId ?? "standalone";

    this.#db = options.database;
    this.#conversations = new ConversationStore(this.#db);
    this.#grants = new PermissionGrantStore(this.#db);
    this.#trust = new WorkspaceTrustStore(this.#db);
    this.#selection = new ExtensionSelectionStore(this.#db);
    this.#inventory = new ExtensionInventory(this.#selection);
    this.#extensions = new ExtensionReconciler(this.#inventory);
    this.#registry = new McpServerRegistry(this.#db);
    this.#catalog = new McpCapabilityCatalog({
      diagnostic: (message, serverId) =>
        this.#logger?.warn(message, { server_id: serverId }),
      // Resolved rather than read at one scope: a server with no decision for
      // this project inherits the user's global default, which is what makes a
      // freshly created project useful without visiting a settings screen. The
      // conversation scope exists in the store and is deliberately not asked
      // here - see the note at the reconcile pass below.
      isServerEnabled: (serverId) =>
        this.#selection.resolve("mcp", serverId, { projectId: this.#projectId })
          .enabled,
    });
    this.#supervisor = new McpSupervisor({
      launch: createMcpLauncher({
        credentials: this.#credentials,
        projectRoot: () => this.#projectRoot,
      }),
      onReady: async (record, connection) => {
        await this.#catalog.refresh(record, connection);
      },
      onUnavailable: (record) => this.#catalog.remove(record.id),
      onNotification: (record, method) => {
        if (method === "notifications/tools/list_changed") {
          this.#catalog.markDirty(record.id);
        }
      },
    });

    this.#inventory.register("mcp", () => this.#registry.asExtensions());
    this.#extensions.register(
      "mcp",
      createMcpReconciler({
        registry: this.#registry,
        supervisor: this.#supervisor,
        onStop: (serverId) => this.#catalog.remove(serverId),
      }),
    );
    this.#management = new McpManagementService({
      registry: this.#registry,
      grants: this.#grants,
      selection: this.#selection,
      supervisor: this.#supervisor,
      extensions: this.#extensions,
      credentials: this.#credentials,
    });
  }

  /** The MCP administration surface, for the HTTP layer. */
  get servers(): McpAdministration {
    return this.#management;
  }

  get projectId(): string {
    return this.#projectId;
  }

  get projectRoot(): string {
    return this.#projectRoot;
  }

  conversationTurnSettings(conversationId: string): {
    readonly modelId: string | null;
    readonly reasoningLevel: string | null;
  } {
    const record = this.#conversations.get(conversationId);
    return {
      modelId: record?.modelId ?? null,
      reasoningLevel: record?.reasoningLevel ?? null,
    };
  }

  /**
   * The read history of one conversation, created on that conversation's first
   * run and kept until the conversation is forgotten.
   */
  #accessLogFor(conversationId: string): FileAccessLog {
    let log = this.#accessLogs.get(conversationId);
    if (log === undefined) {
      log = new FileAccessLog();
      this.#accessLogs.set(conversationId, log);
    }
    return log;
  }

  /**
   * The execution mode the named conversation is held with.
   *
   * Read from the index at the moment it is asked, not captured: the row is
   * settled by the turn-settings middleware before the run is admitted, so
   * the answer a decision gets is the one that conversation's turn was sent
   * under, and a conversation whose mode changed takes the new one on its
   * next decision rather than at its next run. A conversation the index does
   * not know - a test sandbox, or a stream row the admission never wrote -
   * is Manual, which is the same answer an unset row gives: no recorded
   * consent, nothing widened.
   */
  #conversationMode(conversationId: string): ExecutionMode {
    return this.#conversations.get(conversationId)?.permissionMode ?? "manual";
  }

  /**
   * Whether the conversation's model accepts image input, per its own catalog.
   *
   * Pi's catalog marks `input: ["text", "image"]`, carried onto the descriptor
   * as `capability.vision`; this is the read path for it. The answer has three
   * states and two are answered the same way on purpose: `unsupported` returns
   * false, and every other state - the alias with no target, a model the
   * source does not know, a bootstrap that never ran, a record that has no
   * model yet - returns undefined, which the reader treats as "not known to
   * refuse". A guessed refusal would block models the catalog simply has not
   * described; only a catalog that says *no* gets a no.
   */
  #modelAcceptsImages(conversationId: string): boolean | undefined {
    const record = this.#conversations.get(conversationId);

    const registry = bootstrappedModelRegistry();
    if (registry === undefined) return undefined;

    // The same reference the run initializer builds: the stored choice is in
    // the local runtime's `<provider>/<model>` vocabulary, and an unset choice
    // is the stable alias, which resolves to whatever the alias targets.
    const reference = {
      source: "local",
      provider: DEFAULT_MODEL_PROVIDER,
      model: record?.modelId ?? DEFAULT_MODEL_NAME,
    } as const;
    try {
      const vision = registry.resolveDescriptor(reference).capability.vision;
      return vision === "unsupported" ? false : undefined;
    } catch {
      // An unresolvable reference is a configuration problem the turn itself
      // will report; it is not evidence about the model's senses.
      return undefined;
    }
  }

  start(): Promise<void> {
    this.#started ??= this.#extensions.reconcile([this.#projectId]).then(() => undefined);
    return this.#started;
  }

  async reconcile(): Promise<void> {
    await this.#extensions.reconcile([this.#projectId]);
  }

  /**
   * Opens a turn on every project this runtime is holding turn state for.
   *
   * The loop used to be over conversations, which meant one conversation taking
   * a turn advanced the counter of every other one and cleared its pending
   * capture (#84). Over projects the loop is honest: a runtime serves one
   * workspace root in every current path, and a second entry only appears if a
   * sandbox overrode `projectRoot`, in which case both really are between
   * turns. Bounded by workspace roots rather than by conversations, which is
   * why nothing here needs evicting (#72).
   */
  async prepareModelTurn(): Promise<void> {
    await this.reconcile();
    await this.#catalog.refreshDirty(this.#registry.list());
    for (const snapshots of this.#turnSnapshots.values()) snapshots.beginTurn();
  }

  createAgentSandbox(options: StudioAgentSandboxOptions): SandboxFactory {
    const projectRoot = resolve(options.projectRoot ?? this.#projectRoot);
    const projectId = options.projectId ?? projectKey(projectRoot);
    const scope: ExecutionScope = {
      clientId: this.#clientId,
      sessionId: this.#sessionId,
      agentId: options.agentId,
      conversationId: options.conversationId,
      projectId,
    };
    const policy = createSandboxPolicy({
      workspaceRoot: projectRoot,
      // PATH is the one grant a command line needs beyond the workspace: a
      // shell's job is finding programs, and with the policy environment
      // empty its children inherited nothing and could resolve no tool at
      // all. Given deliberately, here, rather than inherited - which is
      // ADR 0039's rule kept, and the move ADR 0046 pairs with approving the
      // programs by name instead of by resolved path. Every other child kind
      // keeps the blanked PATH from `buildEnvironment`.
      // `PATHEXT` beside it, and for the same reason rather than as a
      // afterthought: on Windows a shell handed a perfectly good PATH still
      // cannot run `node`, because command discovery never tries `node.exe`
      // without it. Measured as "The term 'node' is not recognized" from a
      // contained shell whose PATH was correct. It grants no reach of its own
      // - it is a list of file extensions - so it is the cheapest half of
      // making the grant above actually work.
      environment: {
        PATH: process.env.PATH ?? "",
        ...(process.env.PATHEXT === undefined ? {} : { PATHEXT: process.env.PATHEXT }),
      },
    });
    const sandbox = new LocalSandbox(policy);
    const reporter = createErrorReporter(
      this.#logger === undefined ? {} : { logger: this.#logger },
    );
    // The mode this sandbox's decisions are made under. Closed over the
    // conversation the caller named, and read from the index at each ask:
    // the kernel below is the only kernel that will ever consult it, and its
    // `authorize` calls all carry this same conversation's scope, so the
    // mode a decision resolves under belongs to exactly the conversation the
    // call came from. No process-wide value is consulted anywhere.
    const mode = (): ExecutionMode => this.#conversationMode(options.conversationId);
    // Per project, and only per project. The undo history is one shadow
    // repository per workspace root — `SnapshotStore` derives its `gitDir` from
    // that root and nothing else — so the state in front of it has to share the
    // same unit or it is describing a resource it does not match. Keying this
    // by conversation as well is #72/#83/#84/#85; see the field's comment.
    //
    // `required` reads the mode through the same per-conversation closure,
    // which keeps Full Auto's undo guarantee tied to the conversation that
    // asked for it. Today every conversation's workspace root is its own
    // (`agents/studio.ts` passes the conversation's directory and nothing
    // overrides `projectId`), so one entry here is one conversation's; if a
    // shared project root ever makes the map's key wider than a conversation,
    // `required` moves with the caller, because the guarantee is per write,
    // not per store.
    let snapshots = this.#turnSnapshots.get(projectId);
    if (snapshots === undefined) {
      snapshots = new TurnSnapshots({
        store: new SnapshotStore({ workspaceRoot: projectRoot }),
        required: () => mode() === "full-auto",
        reporter,
      });
      this.#turnSnapshots.set(projectId, snapshots);
    }
    const gate = new CallGate({
      kernel: new PermissionKernel({
        grants: this.#grants,
        ...(this.#approver === undefined ? {} : { approver: this.#approver }),
        posture: posture({ mode, trust: this.#trust }),
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
    // One per run, beside the gate it governs. When the person stops a run
    // through the question card, this is what holds the run to one closing
    // turn; dying with the run is what keeps the stop from outliving it.
    const closing = new ClosingTurns();
    const questionBroker = this.#questions;
    registerNativeTools(gate, {
      database: this.#db,
      credentials: this.#credentials,
      acceptsImages: (conversationId) => this.#modelAcceptsImages(conversationId),
      accessLog: this.#accessLogFor(options.conversationId),
      ...(questionBroker === undefined
        ? {}
        : {
            ask: {
              ask: (conversationId, payloads, timeoutMs, signal) =>
                questionBroker.ask(conversationId, payloads, timeoutMs, signal),
              closing,
            },
          }),
    });

    const registeredMcp = new Map<string, McpTool>();

    const refreshTools = (): void => {
      // The project the MCP surface is decided on is this runtime's, not the
      // sandbox root's. The two were the same thing until conversations were
      // given a directory of their own: the fallback sandbox root *was* the
      // runtime's project, so a project key derived from the root happened to
      // match the one the registry, the selection store, the catalog and the
      // reconcile pass all use. Once a projectless conversation stood in
      // `~/.studio/workspace/<conversation>`, the derived key stopped
      // matching, the enabled set came back empty, and every MCP tool a user
      // had enabled for their project vanished from every conversation's
      // tool list - while the server itself still started, because the
      // reconcile pass asks the runtime's project. Enablement is a property
      // of the project the harness serves; where a particular conversation
      // happens to stand is not that.
      const active = this.#registry
        .list()
        .filter(
          (record) =>
            this.#selection.resolve("mcp", record.id, { projectId: this.#projectId })
              .enabled,
        )
        .map((record) => record.id);

      for (const tool of this.#catalog.tools(active)) {
        const key = capabilityKey(tool.descriptor.id);
        const existing = registeredMcp.get(key);
        if (existing === tool) continue;
        if (existing !== undefined) gate.unregister(existing.descriptor.id);
        gate.register(tool);
        registeredMcp.set(key, tool);
      }
    };

    return {
      // The runtime calls this once per initialized harness - measured in
      // Phase 0 as once per submission, with the instance id (= the
      // conversation id) in `options.id`. Everything 1.0's initializer did
      // asynchronously lives here now, and every piece is idempotent per
      // call: `start` memoizes itself, a reconcile pass re-reads the same
      // registry rows, and the directories are created recursively, so a
      // second submission on the same conversation repeats the work for
      // nothing and changes nothing.
      createSandbox: async (_options) => {
        await this.start();
        await this.reconcile();
        // Admission of the first prompt is when a conversation comes into
        // existence on disk. The render computed this conversation's roots
        // and passed them in; creating the tree here rather than in the
        // render keeps a refused send from creating anything, and the
        // sandbox root is in place before the runtime's first AGENTS.md and
        // skills discovery reads the environment.
        ensureDirectory(conversationWorkspaceDirectory(options.conversationId));
        ensureDirectory(conversationAttachmentsDirectory(options.conversationId));
        ensureDirectory(conversationArtifactsDirectory(options.conversationId));
        return sessionEnvironment(sandbox);
      },
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
              // A stop through the question card holds the door here. Past it
              // the run's calls are answered rather than run, and every answer
              // terminates its batch, so the loop ends after the model's one
              // closing message whatever the model tries to do.
              if (closing.isArmed(scope.conversationId)) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `${descriptor.title} did not run: the person stopped this run. Write your closing message now.`,
                    },
                  ],
                  details: { stopped: true },
                  terminate: true,
                };
              }
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

  /**
   * Stops every MCP server and waits for the processes to be gone.
   *
   * Awaited, because the synchronous version returned while children were
   * still alive: they inherit the project directory as their `cwd`, so a
   * caller that deleted that directory next raced them, and on Windows the
   * removal failed outright with `EBUSY`. Orphaned children were the same
   * defect everywhere else, just quieter.
   *
   * It does **not** close the database. It did, and it never owned it — the
   * composition root that opened the connection closes it (ADR 0035 §4).
   */
  async stop(): Promise<void> {
    await this.#supervisor.stopAll();
  }
}

/**
 * The one service locator in the codebase, and the reason it exists.
 *
 * Flue loads `agents/studio.ts` through its own module resolution and calls the
 * default export; nothing in that path accepts a dependency. Rather than a
 * wrapper that hides a global while still being one, it is a global, narrowed
 * to `AgentHost`, with exactly one caller — and an architecture test that fails
 * if a second appears (ADR 0035 §6).
 */
let configuredRuntime: AgentHost | undefined;

export function configureStudioRuntime(runtime: AgentHost): void {
  if (configuredRuntime !== undefined) {
    throw new ExtendError("internal", {
      message: "The Studio runtime has already been configured.",
    });
  }
  configuredRuntime = runtime;
}

export function getStudioRuntime(): AgentHost {
  if (configuredRuntime === undefined) {
    throw new ExtendError("internal", {
      message: "The Studio runtime has not been configured.",
    });
  }
  return configuredRuntime;
}
