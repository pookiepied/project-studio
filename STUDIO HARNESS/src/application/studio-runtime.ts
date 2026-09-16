import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { Sandbox, SandboxFactory, SkillReference } from "@flue/runtime";

import { KeyringCredentialStore } from "../credentials/keyring-store.js";
import type { SecureCredentialStore } from "../credentials/credential-store.js";
import { capabilityKey, type ExecutionScope } from "../contracts/capabilities.js";
import {
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  type ReasoningLevel,
} from "../contracts/models.js";
import {
  bootstrappedModelRegistry,
  bootstrappedSupportedReasoningLevels,
} from "../gateway/language/bootstrap.js";
import { ExtendError } from "../extend/errors.js";
import { ExtensionInventory } from "../extend/inventory.js";
import { ExtensionReconciler } from "../extend/reconcile.js";
import {
  CapabilityInventory,
  type CapabilityInventoryEntry,
} from "../context/capability-inventory.js";
import { McpCapabilityCatalog } from "../extend/mcp/capabilities.js";
import type { McpTool } from "../extend/mcp/capabilities.js";
import { BROWSER_SERVER_ID, COMPUTER_SERVER_ID, registerBuiltInServers } from "../extend/mcp/builtin.js";
import { createMcpLauncher } from "../extend/mcp/launcher.js";
import { createMcpReconciler } from "../extend/mcp/reconcile.js";
import { McpServerRegistry } from "../extend/mcp/registry.js";
import type { McpServerRecord } from "../extend/mcp/registry.js";
import { McpSupervisor } from "../extend/mcp/supervisor.js";
import { ExtensionSelectionStore, type ResolutionContext } from "../extend/selection.js";
import { McpManagementService, type McpAdministration } from "./mcp-management.js";
import { SkillManagementService, type SkillAdministration } from "./skill-management.js";
import { SkillRegistry } from "../extend/skills/registry.js";
import { modelToolName } from "./tool-name.js";
import { ProjectStore } from "../projects/store.js";
import { SandboxScopeStore } from "../sandbox/scope-store.js";
import { ScopeDeclines } from "../sandbox/scope-questions.js";
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
  copyDeliveredAttachments,
  type DeliveredAttachmentImage,
} from "../conversations/attachments.js";
import {
  conversationArtifactsDirectory,
  conversationAttachmentsDirectory,
  conversationScratchDirectory,
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
import { FileAccessLog, ImageBudget } from "../tools/filesystem/index.js";
import { BackgroundJobs, finishedNotice, type JobStatus } from "../process/background.js";
import { JobPings } from "../process/job-pings.js";
import { MediaService } from "../gateway/media/service.js";
import type { MediaJobs } from "../gateway/media/jobs.js";
import type { MediaAdapters } from "../gateway/media/adapters/types.js";
import { CapabilityResolver } from "../gateway/connections/capability-defaults.js";
import { ConnectionStore } from "../gateway/connections/connection-store.js";
import { ModelCatalog } from "../gateway/connections/model-catalog.js";
import { mediaFinishedNotice, mediaJobLines } from "../tools/media/index.js";
import { ConversationStore } from "../conversations/store.js";
import type { PlanItemStore } from "../plan/plan-items.js";

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
  /**
   * The plan the runs write and the person ticks.
   *
   * Optional the same way: a composition without it does not offer the plan
   * tool, rather than offering one that writes nowhere. It is a store, not a
   * broker - nothing about a plan parks, so there is no waiting channel to
   * hold.
   */
  readonly plans?: PlanItemStore;
  readonly credentials?: SecureCredentialStore;
  readonly projectRoot?: string;
  readonly clientId?: string;
  readonly sessionId?: string;
  /**
   * The generation jobs and the vendors' adapters, when this harness has
   * media. Shared with the HTTP surface that lists and stops the jobs, so
   * the tools and the panel see one registry.
   */
  readonly mediaJobs?: MediaJobs;
  readonly mediaAdapters?: MediaAdapters;
  /**
   * Where a finished job's news goes: one conversation, one message.
   *
   * The composition root binds this to the conversation's own agent
   * (Flue's dispatch, a signal delivery), and that is the whole of the
   * wiring: the registries announce an ending, this port carries it. Without
   * the port the pings never exist at all - no hub, no announcements, no
   * drains - because a mechanism that collected the endings and had nowhere
   * to put them would swallow exactly the news the other two delivery points
   * (the tool-result tail, the next turn's block) exist to carry. Optional
   * for the same reason the media surfaces are: a composition without it
   * simply does not wake anybody, rather than pretending to.
   */
  readonly deliverJobPing?: (conversationId: string, body: string) => Promise<void>;
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

function modelToolResult(value: unknown, notice?: string): ModelToolResult {
  // Appended as its own block rather than spliced into the text of the result.
  // The result belongs to the tool that was called and a model parsing it -
  // reading JSON out of a search, counting lines from a read - must not find
  // a sentence about something else inside it.
  const appended: readonly ModelTextContent[] =
    notice === undefined ? [] : [{ type: "text", text: notice }];

  if (isRecord(value) && Array.isArray(value["content"])) {
    return {
      content: [
        ...value["content"].map((block) =>
          isSupportedContent(block) ? block : asText(block),
        ),
        ...appended,
      ],
      details: value,
      ...(value["isError"] === true ? { isError: true } : {}),
    };
  }

  return {
    content: [asText(value), ...appended],
    details: value,
  };
}

/** Two notices, or one, or none: the background commands' and the generations'. */
function joinNotices(...notices: readonly (string | undefined)[]): string | undefined {
  const present = notices.filter((notice): notice is string => notice !== undefined);
  return present.length === 0 ? undefined : present.join("\n\n");
}

/**
 * One ended command, as a line the model reads.
 *
 * Tenseless on purpose, because two delivery points use it: the next turn's
 * environment block, where the ending may be hours old, and the finished-job
 * announcement, where it is seconds old. Both drain the same registry, so
 * only one of them ever carries the line - which is exactly why the line
 * itself must be the same in both, and why the wording lives here rather
 * than at either call site.
 */
function shellEndedLine(job: JobStatus): string {
  const how =
    job.state === "stopped"
      ? "was stopped"
      : job.state === "failed"
        ? "never started"
        : job.exitCode === 0
          ? "finished"
          : `exited ${job.exitCode ?? "?"}`;
  return `${job.id} ${how}: ${job.command}`;
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
 * The refusal for a project folder that is not a directory when a turn starts.
 *
 * One message naming the project and saying what is wrong, with the two
 * remedies beside it. Checked at turn start rather than at the render because
 * the two are not the same moment: the folder can be removed, or its row
 * written, in between. `unavailable` rather than a permission kind - the
 * sandbox genuinely cannot start here, and after the person creates the
 * folder, resending can succeed.
 */
async function missingFolderRefusal(
  folder: string,
  projectName: string,
): Promise<SandboxError | undefined> {
  let found;
  try {
    found = await stat(folder);
  } catch {
    return new SandboxError("unavailable", {
      message:
        `The project "${projectName}" is missing its folder ${folder}. ` +
        "Create that folder, or point the project at a directory that exists, and send again.",
    });
  }
  if (!found.isDirectory()) {
    return new SandboxError("unavailable", {
      message:
        `The project "${projectName}" has a file where its folder should be (${folder}). ` +
        "Point the project at a directory that exists, and send again.",
    });
  }
  return undefined;
}

/**
 * One entry per root, case-insensitively on the platform that is.
 *
 * A project folder can also carry a scope grant, and then the same directory
 * arrives from two stores. Containment reads duplicates harmlessly, but the
 * policy should say each root once, and the comparison in `paths.ts` is
 * case-insensitive on Windows for the same reason this is.
 */
function withoutDuplicateRoots(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const path of paths) {
    const key = process.platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(path);
  }
  return kept;
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
  /**
   * The reasoning levels one stored reference supports, in Pi's order, empty
   * for a model that does not reason.
   *
   * Read once per render, synchronously, beside `conversationTurnSettings`.
   * The Pi catalog it reads is composed synchronously where
   * `applyOpenRouterDefaultReasoning` mutates it, so this never awaits the
   * async `ModelCatalog`. The render feeds the answer into
   * `runThinkingLevelForChoice` so a stored "default" rests on medium.
   */
  supportedReasoningLevels(modelId: string | null): readonly ReasoningLevel[];
  /**
   * The extra roots one conversation may reach beyond its workspace.
   *
   * Read once per render, synchronously, for the environment block. A run
   * that knows it can write `~/.cargo` does not spend a call discovering it.
   * Optional so a test double that predates scope still satisfies the host.
   */
  conversationExtraRoots?(conversationId: string): readonly string[];
  /**
   * The folders of the project one conversation is filed under, in the order
   * the person arranged them, and empty when the conversation has no project
   * or the project has none.
   *
   * Read once per render, synchronously, like `conversationTurnSettings`. The
   * render derives where the conversation stands - the first folder, or the
   * conversation's own tree when this comes back empty - and the factory
   * derives the same list for the policy's roots, so both sides of one run
   * read one source. Optional so a test double that predates folders still
   * satisfies the host.
   */
  conversationProjectFolders?(conversationId: string): readonly string[];
  /**
   * The background commands to name in this turn's environment block.
   *
   * Lines rather than records, because the shaping is a prompt decision and
   * the agent module is where prompt decisions belong. Calling this drains the
   * ended ones - it is a delivery, not a read - so nothing else may call it.
   * Optional for the same reason the folders are: a test double that predates
   * background commands still satisfies the host.
   */
  conversationBackgroundJobs?(conversationId: string): readonly string[];
  /**
   * The capability inventory section for this conversation's system block.
   *
   * Empty when nothing is enabled, and the render appends it unconditionally -
   * so a conversation with no MCP servers gets a prompt byte-identical to the
   * one it got before this section existed. Session-stable by construction:
   * the runtime answers the same string for the whole conversation, so nothing
   * discovery later loads can move the system block and re-bill the history
   * behind it. Optional so a test double that predates the inventory still
   * satisfies the host.
   */
  conversationCapabilityInventory?(conversationId: string): string;
  /**
   * The skills switched on for one conversation, ready for `useSkill`.
   *
   * Skills are not in the capability inventory above and not behind the
   * discover tool: Flue owns this surface. Each reference becomes one catalog
   * line in the system prompt and is loaded in full only when the model calls
   * Flue's `activate_skill`, which is the same shape as every other harness
   * that reads the Agent Skills format. Optional for the same reason as the
   * inventory.
   */
  conversationSkills?(conversationId: string): readonly SkillReference[];
  /**
   * Copies one delivery's attached images into the conversation's own
   * `attachments/` directory, so the run's file tools can read them.
   *
   * Called from the render, because that is where the delivery is in hand:
   * the hook (`useDelivery`) is the model's own access to what it was sent,
   * and this is the harness's. Nothing returns - the note the render composes
   * names the directory, not the files, so there is no answer to carry.
   * Optional so a test double that predates attachment copies still satisfies
   * the host, like every member here.
   */
  persistDeliveredAttachments?(
    conversationId: string,
    attachments: readonly DeliveredAttachmentImage[],
  ): void;
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
  readonly #projects: ProjectStore;
  readonly #scopes: SandboxScopeStore;
  readonly #declines: ScopeDeclines;
  readonly #grants: PermissionGrantStore;
  readonly #trust: WorkspaceTrustStore;
  readonly #selection: ExtensionSelectionStore;
  readonly #inventory: ExtensionInventory;
  readonly #extensions: ExtensionReconciler;
  readonly #registry: McpServerRegistry;
  readonly #supervisor: McpSupervisor;
  readonly #catalog: McpCapabilityCatalog;
  readonly #management: McpManagementService;
  readonly #skills: SkillRegistry;
  readonly #skillManagement: SkillManagementService;
  readonly #capabilities: CapabilityInventory;
  /**
   * The capability keys discovery has adopted, one set per conversation.
   *
   * Here rather than beside the registration it feeds, because of when things
   * are built: `createAgentSandbox` runs once per submission, so the gate, the
   * registration bookkeeping and the `refreshTools` closure are rebuilt every
   * turn. What discovery adopts has to survive that, because the next
   * submission's tools array is rebuilt too — and under the withhold (ADR 0048
   * §3, as 0049 §5 narrowed it) that rebuild starts from the
   * system-provenance servers alone. An adoption remembered only inside one
   * submission would vanish from the very next turn's array, which is the
   * ruinous direction of §3.3, taken silently, by the code that was supposed
   * to prevent it.
   *
   * Keys, not definitions: which definition of `mcp:blender/add_camera` to
   * register is the catalog's question, answered fresh at the turn boundary —
   * that is 0029 §5's replacement, and it is also what keeps the definition
   * hash on the grants honest. Only the fact of the adoption belongs to the
   * conversation.
   *
   * Keyed by conversation, like the access logs, for the same reason: what
   * this conversation asked for is its knowledge, not its neighbour's. Entries
   * are kept for the conversation's lifetime, which for these maps means the
   * process's; each is a set of strings, which is the same order of cost the
   * access logs accepted.
   */
  readonly #discoveredToolKeys = new Map<string, Set<string>>();

  readonly #logger: Logger | undefined;
  readonly #approver: PermissionApprover | undefined;
  readonly #questions: QuestionBroker | undefined;
  readonly #plans: PlanItemStore | undefined;
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
  /**
   * One budget for the whole runtime, keyed inside by conversation.
   *
   * Held here rather than per run for the same reason the access logs are:
   * a run is one turn, and what these count - the images a transcript has
   * accumulated, which every later turn resends - only means anything across
   * turns.
   */
  readonly #imageBudget = new ImageBudget();
  /**
   * Background commands, one registry for the runtime.
   *
   * Here rather than per run because that is the whole point of them: a dev
   * server started on one turn has to still be there on the next. Stopped in
   * `stop()`, so nothing of ours outlives the harness.
   */
  readonly #jobs = new BackgroundJobs();
  /**
   * The media service the generation tools dispatch through: its own
   * resolver over the same database and keyring as the provider surface,
   * the way the web tools build theirs. Undefined when the harness was
   * built without a job registry, and then no generation tool is
   * registered.
   */
  readonly #media: MediaService | undefined;
  /**
   * The generation jobs, as the options carried them in - the registry
   * itself, kept beside the service that wraps it because the two read it at
   * different layers: the service hands it to the generation tools, and the
   * finished-job announcement registers on it right here, where the
   * conversation index that guards the delivery lives. It is undefined
   * exactly when `#media` is - the one option decides both.
   */
  readonly #mediaJobs: MediaJobs | undefined;
  #started: Promise<void> | undefined;

  constructor(options: StudioRuntimeOptions) {
    this.#logger = options.logger;
    this.#approver = options.approver;
    this.#questions = options.questions;
    this.#plans = options.plans;
    this.#credentials = options.credentials ?? new KeyringCredentialStore();
    this.#projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.#projectId = projectKey(this.#projectRoot);
    this.#clientId = options.clientId ?? "standalone";
    this.#sessionId = options.sessionId ?? "standalone";

    this.#db = options.database;
    this.#mediaJobs = options.mediaJobs;
    this.#media =
      options.mediaJobs === undefined
        ? undefined
        : (() => {
            const connections = new ConnectionStore({ db: this.#db, credentials: this.#credentials });
            return new MediaService({
              resolver: new CapabilityResolver({
                connections,
                catalog: new ModelCatalog({ db: this.#db, connections }),
                credentials: this.#credentials,
              }),
              jobs: options.mediaJobs,
              ...(options.mediaAdapters === undefined ? {} : { adapters: options.mediaAdapters }),
            });
          })();
    this.#conversations = new ConversationStore(this.#db);
    this.#projects = new ProjectStore(this.#db);
    this.#scopes = new SandboxScopeStore(this.#db);
    this.#declines = new ScopeDeclines();
    this.#grants = new PermissionGrantStore(this.#db);
    this.#trust = new WorkspaceTrustStore(this.#db);
    this.#selection = new ExtensionSelectionStore(this.#db);
    this.#inventory = new ExtensionInventory(this.#selection);
    this.#extensions = new ExtensionReconciler(this.#inventory);
    this.#registry = new McpServerRegistry(this.#db);
    // Studio's own capabilities become rows before anything reads the
    // registry, so they are ordinary servers to everything downstream: the
    // settings screen, the inventory, the reconciler and the three scopes all
    // treat the browser exactly as they treat one somebody installed.
    registerBuiltInServers(this.#registry, this.#selection);
    this.#catalog = new McpCapabilityCatalog({
      diagnostic: (message, serverId) =>
        this.#logger?.warn(message, { server_id: serverId }),
      // Resolved rather than read at one scope: a server with no decision for
      // this conversation inherits its project's answer, and then the user's
      // global default, which is what makes a freshly created project useful
      // without visiting a settings screen. The conversation the dispatch
      // belongs to is what makes the chain; the tools array, the discovery and
      // this predicate all resolve it the same way (see #enablementContext),
      // because two readers answering differently is how a tool that is
      // announced stops being callable.
      isServerEnabled: (serverId, conversationId) =>
        this.#selection
          .resolve("mcp", serverId, this.#enablementContext(conversationId))
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
    // The second kind the spine was built for. No reconciler joins it: a
    // skill is a folder of text, and there is nothing to start or stop when
    // one is switched on - the render reads what is on and mounts it.
    this.#skills = new SkillRegistry();
    this.#inventory.register("skill", () => this.#skills.asExtensions());
    this.#extensions.register(
      "mcp",
      createMcpReconciler({
        registry: this.#registry,
        supervisor: this.#supervisor,
        onStop: (serverId) => this.#catalog.remove(serverId),
      }),
    );
    // Built here, from the same two sources the tools array is built from, so
    // the prose and the array can never describe different configurations.
    // The closure does read its conversation id now: the conversation's own
    // decision is the narrowest leg of its enablement, so the note a
    // conversation is announced with must be built from that conversation's
    // chain. What has not changed is when it is settled - the first build
    // decides, and the memo (not the closure) is what keeps the block still
    // for the conversation's life, which is ADR 0048 §1's rule.
    //
    // The second argument is §1's one narrow exception, and it exists because
    // of the order a turn runs in: the render that asks this question happens
    // before `createSandbox` has launched a newly switched-on server, so the
    // first build of a conversation that races a settings change would
    // otherwise freeze "0 tools" for that server into the system block for
    // the conversation's whole life. `#capabilityEntriesAreSettled` decides
    // when an answer is one worth keeping; until it says yes, the inventory
    // rebuilds on every ask and settles the moment the server answers (or
    // fails for good). See ADR 0048 §1 for the trade, and for why it is an
    // exception rather than a violation.
    this.#capabilities = new CapabilityInventory(
      (conversationId) => this.#capabilityEntries(this.#enablementContext(conversationId)),
      (entries) => this.#capabilityEntriesAreSettled(entries),
    );
    this.#management = new McpManagementService({
      registry: this.#registry,
      grants: this.#grants,
      selection: this.#selection,
      supervisor: this.#supervisor,
      extensions: this.#extensions,
      credentials: this.#credentials,
      projectId: this.#projectId,
      conversationProject: (conversationId) => this.#conversationProject(conversationId),
      // The fast half of every settings change: the pass runs now, in the
      // background, over every project that may want a server (the same list
      // `reconcile()` reads - a decision made on a project's own screen has
      // to be enough to start what that project's conversations resolve to).
      // Fire-and-forget by contract, and cannot throw - not even
      // synchronously - so a settings change never waits on a handshake and
      // never fails because the pass did. See the method for what a failure
      // costs.
      reconcile: () => this.#reconcileAfterSettingsChange(),
    });
    this.#skillManagement = new SkillManagementService({
      registry: this.#skills,
      selection: this.#selection,
      extensions: this.#extensions,
      projectId: this.#projectId,
      conversationProject: (conversationId) => this.#conversationProject(conversationId),
    });

    // The finished-job announcements, wired once: both registries - the
    // commands above, the generations when this harness has them - call the
    // one hub, and the hub's drain is what decides who tells the model. The
    // sources speak the same lines the environment block would have, because
    // whichever of the two delivery points wins, the model reads one
    // vocabulary for the same fact. Built only when this composition has
    // somewhere to deliver, and held by the listeners it registers - a hub
    // nobody hears is a hub nobody needs, and the promise it keeps is
    // registered once per process, not once per run: a job outlives the turn
    // that started it, and so does the promise to tell the model when it ends.
    if (options.deliverJobPing !== undefined) {
      const deliverJobPing = options.deliverJobPing;
      const pings = new JobPings({
        deliver: deliverJobPing,
        // A job can outlive its conversation row - the purge asks
        // nothing of the job registries - and a signal delivered there
        // would resurrect the conversation's agent as an instance
        // nobody sees. Only a conversation the index still holds gets
        // its news.
        exists: (conversationId) => this.#conversations.get(conversationId) !== undefined,
        onFailure: (reason) =>
          this.#logger?.warn(
            `A finished background job could not be told to its conversation: ` +
              `${reason instanceof Error ? reason.message : String(reason)}`,
          ),
      });
      pings.addSource({
        drain: (conversationId) =>
          this.#jobs.drainFinished(conversationId).map((job) => shellEndedLine(job)),
      });
      const media = this.#media;
      if (media !== undefined) {
        pings.addSource({
          // The ended lines, drained - the running half of the same
          // builder is the next turn's block's business, not the
          // announcement's.
          drain: (conversationId) => mediaJobLines(media, conversationId).ended,
        });
        this.#mediaJobs?.onEnded((conversationId) => pings.announce(conversationId));
      }
      this.#jobs.onEnded((conversationId) => pings.announce(conversationId));
    }
  }

  /** The MCP administration surface, for the HTTP layer. */
  get servers(): McpAdministration {
    return this.#management;
  }

  /** The skill administration surface, for the HTTP layer. */
  get skills(): SkillAdministration {
    return this.#skillManagement;
  }

  /**
   * The skills this conversation mounts, resolved through its own chain.
   *
   * Two things a mounted set must never do are handled here rather than left
   * to the render. It must not fail the run: a skill whose folder stopped
   * packaging since it was switched on is dropped with a warning, because a
   * settings decision made last week must not turn into a 500 today. And it
   * must not collide with a workspace skill: Flue discovers
   * `<cwd>/.agents/skills/` on its own and throws when a name appears in both
   * places, so a name that is also a folder there is left to the workspace,
   * which is the nearer of the two.
   */
  conversationSkills(conversationId: string): readonly SkillReference[] {
    const workspace = this.conversationProjectFolders(conversationId)[0];
    const references: SkillReference[] = [];
    for (const entry of this.#inventory.active("skill", this.#enablementContext(conversationId))) {
      if (workspace !== undefined && existsSync(join(workspace, ".agents", "skills", entry.id))) {
        this.#logger?.warn(
          `The skill "${entry.id}" is switched on and also in the project's .agents/skills folder; the project's copy is the one mounted.`,
          { skill_id: entry.id },
        );
        continue;
      }
      try {
        references.push(this.#skills.reference(entry.id));
      } catch (error) {
        this.#logger?.warn(
          `The skill "${entry.id}" could not be mounted: ${error instanceof Error ? error.message : String(error)}`,
          { skill_id: entry.id },
        );
      }
    }
    return references;
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

  supportedReasoningLevels(modelId: string | null): readonly ReasoningLevel[] {
    return bootstrappedSupportedReasoningLevels(modelId);
  }

  /**
   * The project one conversation is filed under, when it is filed anywhere.
   *
   * The conversation index owns the filing; the sandbox factory owns the
   * workspace. A conversation with no project reads the machine-wide scope
   * rows only, and is never trusted - there is no project to trust it.
   */
  #conversationProject(conversationId: string): string | undefined {
    const record = this.#conversations.get(conversationId);
    return record?.projectId ?? undefined;
  }

  conversationExtraRoots(conversationId: string): readonly string[] {
    const projectId = this.#conversationProject(conversationId);
    const roots = this.#scopes.resolveRoots(projectId);
    return [...roots.readRoots, ...roots.writeRoots.filter((root) => !roots.readRoots.includes(root))];
  }

  /**
   * The project folders one conversation stands to work in, by position.
   *
   * The store returns them ordered; this maps to bare paths for the render
   * and the policy build, which are the two readers.
   */
  conversationProjectFolders(conversationId: string): readonly string[] {
    const projectId = this.#conversationProject(conversationId);
    if (projectId === undefined) return [];
    return (this.#projects.get(projectId)?.folders ?? []).map((folder) => folder.path);
  }

  /**
   * The chain one conversation's enablement resolves through.
   *
   * Narrowest first: this conversation, then the project it is filed under,
   * then this harness's project, then off. A conversation filed nowhere
   * resolves through the harness's project, because that leg is what the
   * historic projectless-conversation bug taught `refreshTools` never to lose
   * (see the comment there); it loses its turn only to the conversation's own
   * project when there is one. Everything that reads enablement for a
   * conversation - the tools array, the discovery, the dispatch predicate -
   * comes through here, so the three cannot disagree about the same
   * conversation.
   */
  #enablementContext(conversationId: string): ResolutionContext {
    return {
      conversationId,
      projectId: this.#conversationProject(conversationId) ?? this.#projectId,
    };
  }

  /**
   * Every project whose decisions may start a server.
   *
   * This harness's project leads, because a conversation standing in no
   * project resolves through it. Every recorded project joins it, because the
   * reconciler runs a server while at least one project wants it, and a
   * decision made on a project's own screen has to be enough to start what
   * that project's conversations will resolve to. It was never a decision to
   * end a process; it was never a decision about one workspace either.
   */
  #reconcileProjects(): readonly string[] {
    return [this.#projectId, ...this.#projects.list().map((project) => project.id)];
  }

  /**
   * A settings change just altered the desired set; run a pass now.
   *
   * Background and never throwing, both by contract with the management
   * service: its HTTP response has already answered by now, and the point of
   * this pass is to shorten the window between a switch being flipped and a
   * server being reachable - not to make the settings screen wait for a
   * handshake, and not to fail one because a server refused to start. A
   * failure costs what a startup failure already costs: the supervisor holds
   * the reason and the retry, the kind's own pass aborts with the message,
   * and the generation is left dirty - the turn boundary's reconcile remains
   * the correct slow path, so a fast path that dies changes when the change
   * applies, never whether it does.
   *
   * Nothing here resets a backoff by design: the reconciler asks `ensure` for
   * what is live and not what is failed, and a server mid-retry is left for
   * its own timer - `mcp/reconcile.ts` says so, and this pass runs the same
   * code the turn boundary does.
   */
  #reconcileAfterSettingsChange(): void {
    try {
      this.#extensions
        .reconcile(this.#reconcileProjects())
        .catch((error: unknown) => {
          this.#logger?.warn(
            `Extension reconcile after a settings change failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    } catch (error) {
      // The synchronous half of the same contract: a store that refuses a
      // read throws before any promise exists, and the settings response is
      // not the place it surfaces.
      this.#logger?.warn(
        `Extension reconcile after a settings change could not start: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The installed servers one context actually gets.
   *
   * One function because two readers must never disagree. `refreshTools`
   * builds the tools array from this, and the capability inventory builds the
   * prose from it; a second copy of the filter is how the prompt ends up
   * announcing a server whose tools are not there, or the reverse.
   *
   * The context comes from `#enablementContext`, so it always answers for a
   * conversation. Enablement was resolved against the harness's project alone
   * until the conversation scope gained a route, and a projectless
   * conversation still resolves through it - deriving the project leg from
   * where a conversation happens to stand made the enabled set come back
   * empty and every MCP tool vanish from every conversation, which is why the
   * leg falls to this harness's project rather than to a key derived from
   * where the conversation happens to stand.
   */
  #enabledMcpServers(context: ResolutionContext): readonly McpServerRecord[] {
    return this.#registry
      .list()
      .filter(
        (record) =>
          this.#selection.resolve("mcp", record.id, context).enabled,
      );
  }

  /**
   * What the inventory says, assembled from the registry and the live catalog.
   *
   * The count and the names come from the catalog rather than from anything
   * stored, because how many tools a server has is a fact about the running
   * server and a stored copy would go stale the first time one changed its
   * list - silently, which is the worst way for a number in the system prompt
   * to be wrong.
   *
   * A server with no tools in the catalog still gets a line. It is enabled and
   * the person can see it in their settings, so announcing nothing about it
   * would leave a model to conclude the setting did nothing; "0 tools" is the
   * true answer for a server that has not connected yet.
   */
  #capabilityEntries(context: ResolutionContext): readonly CapabilityInventoryEntry[] {
    const records = this.#enabledMcpServers(context);
    const names = new Map<string, string[]>(
      records.map((record) => [McpServerRegistry.namespaceOf(record.id), []]),
    );
    for (const tool of this.#catalog.tools(records.map((record) => record.id))) {
      names.get(tool.descriptor.id.namespace)?.push(tool.descriptor.id.name);
    }
    return records.map((record) => ({
      id: McpServerRegistry.namespaceOf(record.id),
      description: record.description,
      toolNames: names.get(McpServerRegistry.namespaceOf(record.id)) ?? [],
      builtIn: record.provenance === "system",
    }));
  }

  /**
   * Whether one build of the inventory is an answer worth keeping for the
   * conversation's whole life.
   *
   * The one question this answers is: has every enabled server *answered*?
   * Not "does it have tools" - a connected server that exposes nothing has
   * answered, and `0 tools` is then the true sentence, settled like any
   * other. What is not keepable is a server that has not spoken yet, and the
   * two states that mean that are `starting` (the handshake is in flight) and
   * `failed` (the handshake failed and the supervisor's backoff is still
   * deciding; a server that recovers on its second attempt would otherwise be
   * described as empty for this conversation's life by a note that settled on
   * its worst moment). `given-up` is keepable - the supervisor has decided it
   * will not try again, and that is as answered as a server gets.
   *
   * Read from the supervisor and the catalog rather than inferred from the
   * entries: the entries say what the tools *are*, and an empty list is the
   * honest answer for a server with nothing to expose. And both conditions,
   * not the supervisor's alone: the supervisor reports `ready` the moment the
   * handshake lands, which is before the catalog's `tools/list` has been
   * read - settling there would freeze "0 tools" in the window between the
   * two, which is the same bug one handshake later.
   *
   * An empty entry list settles: a conversation with no enabled servers has
   * nothing to wait for, and the byte-identical empty block must not become
   * a moving target.
   */
  #capabilityEntriesAreSettled(entries: readonly CapabilityInventoryEntry[]): boolean {
    return entries.every((entry) => {
      // The id is one this runtime just wrote via `namespaceOf`, so the inverse
      // is always defined here; the undefined branch is the type system's
      // answer to "what if it were not", and an unrecognized namespace is
      // treated as settled rather than as a reason to never settle.
      const serverId = McpServerRegistry.serverOf(entry.id);
      if (serverId === undefined) return true;
      const status = this.#supervisor.status(serverId);
      return (
        status?.state === "given-up" ||
        (status?.state === "ready" && this.#catalog.hasRefreshed(serverId))
      );
    });
  }

  /**
   * The capability inventory for one conversation's system block.
   *
   * A string rather than records, for the same reason the background jobs are
   * lines: how a capability is described to a model is a prompt decision, and
   * prompt decisions belong to the prose. The empty string when this
   * conversation has no enabled servers, which leaves the block byte-identical
   * to what it was before the section existed.
   */
  conversationCapabilityInventory(conversationId: string): string {
    return this.#capabilities.blockFor(conversationId);
  }

  /**
   * Re-asks this conversation's capability note, before a run renders.
   *
   * The HTTP middleware calls this between submissions, which is the one
   * boundary a note may move. Two notes are rebuilt and re-memoized here, so
   * the next run's first render composes the current truth: a *pending* note
   * - an enabled server that had not answered - and a note written about a
   * different set of capabilities than the person has switched on now. Every
   * other settled note is refused untouched, for the conversation's life.
   * Nothing inside a run calls this, because
   * Flue digests the composed instruction document per render and a note
   * that moved between the renders of one submission would be narrated as an
   * instructions signal and re-bill the prefix mid-turn - the ruinous
   * direction, taken inside a single run.
   */
  reopenCapabilityInventory(conversationId: string): void {
    this.#capabilities.reopen(conversationId);
  }

  /**
   * What this conversation's background commands are, for the turn's block.
   *
   * Running jobs are listed every turn: they are current state, and a turn
   * that knows the dev server is up does not start a second one. Ended jobs
   * are drained, so each is announced once and then stops being mentioned -
   * an exit code repeated on every turn for the rest of a conversation is
   * noise that eventually reads as a job that keeps failing.
   *
   * The drained end is also one of two places the end can arrive: when this
   * harness composes the finished-job announcement, the announcement's own
   * drain usually wins, and this block then says nothing - the other half of
   * the exactly-once bargain, and why the ended lines are one wording shared
   * with it (`shellEndedLine`).
   */
  conversationBackgroundJobs(conversationId: string): readonly string[] {
    const running = this.#jobs
      .list(conversationId)
      .filter((job) => job.state === "running")
      .map((job) => `${job.id} is running: ${job.command}`);
    const ended = this.#jobs.drainFinished(conversationId).map((job) => shellEndedLine(job));
    const media =
      this.#media === undefined ? { running: [], ended: [] } : mediaJobLines(this.#media, conversationId);
    return [...running, ...ended, ...media.running, ...media.ended];
  }

  /**
   * Files one delivery's pictures where the conversation's own permission
   * policy can read them.
   *
   * The render calls it once per turn, which is when the delivery is in hand
   * and when the copies must already exist - the same submission's factory
   * builds the policy that grants the folder, so a turn's own attachments
   * have to be on disk before its tools are. What running twice means, and
   * why it is harmless, is the copy's own contract: `conversations/attachments.ts`.
   * A failure is logged, never thrown - the pixels ride the message either
   * way, and a turn that loses its copies loses only the convenience.
   */
  persistDeliveredAttachments(
    conversationId: string,
    attachments: readonly DeliveredAttachmentImage[],
  ): void {
    try {
      copyDeliveredAttachments(conversationId, attachments);
    } catch (error) {
      this.#logger?.warn(
        `The pictures on this message could not be copied into the conversation's ` +
          `own folder, so its tools cannot read them: ${conversationId}`,
        { reason: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * The background commands, for the HTTP surface that shows them.
   *
   * Exposed as the registry rather than as a copy of its listing, because the
   * panel needs three operations on it and a snapshot would answer none of
   * them - a list read a second ago cannot stop anything.
   */
  get backgroundJobs(): BackgroundJobs {
    return this.#jobs;
  }

  /**
   * Ends one conversation's browser, at the person's request.
   *
   * ADR 0049 §4: the browser is visible and it can be stopped. It is not a
   * background command - the process belongs to the browser server, not to
   * the harness - so the stop is the same call the model's own
   * `studio_browser_quit` makes, addressed to the same conversation, and
   * deliberately not a different path. A server that is not connected has no
   * browser to end, and this must not start one to ask: `ensure` is only
   * reached behind a `ready` status. Answers whether a browser was running.
   */
  async stopBrowser(conversationId: string): Promise<boolean> {
    const text = await this.#askSystemServer(BROWSER_SERVER_ID, "studio_browser_quit", conversationId);
    return text.includes("is closed");
  }

  /**
   * Ends one conversation's computer control, at the person's request.
   *
   * ADR 0055 §7: the pill on screen says the computer is being driven and
   * offers a stop, and this is that stop - the model's own
   * `studio_computer_stop`, which releases anything held before the driver
   * ends. Answers whether a driver was running.
   */
  async stopComputer(conversationId: string): Promise<boolean> {
    const text = await this.#askSystemServer(COMPUTER_SERVER_ID, "studio_computer_stop", conversationId);
    return text.includes("has stopped");
  }

  /**
   * One tool of a system server, called on a conversation's behalf, as text.
   * A server that is not connected has nothing to end, and this must not
   * start one to ask: `ensure` is only reached behind a `ready` status.
   */
  async #askSystemServer(serverId: string, tool: string, conversationId: string): Promise<string> {
    const record = this.#registry.get(serverId);
    if (record === undefined) return "";
    if (this.#supervisor.status(record.id)?.state !== "ready") return "";
    const connection = await this.#supervisor.ensure(record);
    const result = await connection.request("tools/call", {
      name: tool,
      arguments: {},
      _meta: { "studio/conversation": conversationId },
    });
    return typeof result === "object" && result !== null && Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: { text?: unknown }[] }).content
          .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
          .join(" ")
      : "";
  }

  /** Whether one conversation runs uncontained. Trusted is per project. */
  #conversationTrusted(projectId: string | undefined): boolean {
    if (projectId === undefined) return false;
    try {
      return this.#projects.sandboxLevelOf(projectId) === "trusted";
    } catch {
      return false;
    }
  }

  /**
   * Whether one conversation has declined one resolved path.
   *
   * A declined path is not asked twice in that conversation. The record lives
   * here, beside the access logs, because it is conversation-scoped runtime
   * state rather than a durable row - the next conversation asks again.
   */
  scopeDeclined(conversationId: string, resolvedPath: string): boolean {
    return this.#declines.isDeclined(conversationId, resolvedPath);
  }

  /** Records that one conversation declined one resolved path. */
  markScopeDeclined(conversationId: string, resolvedPath: string): void {
    this.#declines.markDeclined(conversationId, resolvedPath);
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
   * What one conversation has adopted through discovery, created on its first
   * submission and grown from there. Never forgotten within the process: the
   * next submission of the same conversation resumes the same adoption, and a
   * conversation's own discoveries are invisible to every other.
   */
  #discoveredToolKeysFor(conversationId: string): Set<string> {
    let keys = this.#discoveredToolKeys.get(conversationId);
    if (keys === undefined) {
      keys = new Set<string>();
      this.#discoveredToolKeys.set(conversationId, keys);
    }
    return keys;
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
    this.#started ??= this.#extensions.reconcile(this.#reconcileProjects()).then(() => undefined);
    return this.#started;
  }

  async reconcile(): Promise<void> {
    await this.#extensions.reconcile(this.#reconcileProjects());
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
    // The startup pass first, and awaited rather than raced.
    //
    // `start()` is kicked off at boot with `void`, so a turn arriving in the
    // first moments of a harness would otherwise open a *second* reconcile
    // beside the one already in flight. The second pass returns as soon as its
    // own plan is empty - the server is already being started by the first -
    // so it returns before any catalog has been read, and the turn renders
    // believing an enabled server has no tools.
    //
    // That was invisible while nothing was enabled by default. A built-in
    // capability makes it the ordinary case: Studio restarts often, and the
    // first turn after a restart would freeze a "still being read" note, then
    // replace it at the next submission - moving the system block and
    // re-billing the whole prefix behind it, on the second turn of every
    // conversation. `start()` memoises, so awaiting it here costs nothing
    // after the first call and makes the first turn wait for the work it was
    // already depending on.
    await this.start();
    await this.reconcile();
    await this.#catalog.refreshDirty(this.#registry.list());
    for (const snapshots of this.#turnSnapshots.values()) snapshots.beginTurn();
  }

  createAgentSandbox(options: StudioAgentSandboxOptions): SandboxFactory {
    const conversationProject = this.#conversationProject(options.conversationId);
    // The chain this conversation's enablement resolves through, computed once
    // and read by both of the readers below: the discovery's answers and the
    // tools array are built from the same context, so neither can describe a
    // conversation the other does not.
    const enablement = this.#enablementContext(options.conversationId);
    // The conversation's project record, read where the sandbox is built. A
    // conversation filed under a project with folders stands in the project's
    // first folder and reaches the others as roots; a project with no folders
    // is a label, and its conversations keep the tree of their own.
    const projectRecord =
      conversationProject === undefined ? undefined : this.#projects.get(conversationProject);
    const projectFolders = (projectRecord?.folders ?? []).map((folder) => folder.path);
    const firstFolder = projectFolders[0];
    const projectRoot = resolve(firstFolder ?? options.projectRoot ?? this.#projectRoot);
    const projectId = conversationProject ?? options.projectId ?? projectKey(projectRoot);
    const scope: ExecutionScope = {
      clientId: this.#clientId,
      sessionId: this.#sessionId,
      agentId: options.agentId,
      conversationId: options.conversationId,
      projectId,
    };
    // Read where the policy is built. A conversation with no project reads the
    // machine-wide rows only; a filed conversation reads both. The level lives
    // on the project: trusted removes containment for that project's
    // conversations, and contained is what an untouched project still gets.
    const scopeProject = conversationProject ?? (options.projectId === undefined ? undefined : projectId);
    const roots = this.#scopes.resolveRoots(scopeProject);
    const trusted = this.#conversationTrusted(conversationProject ?? options.projectId);
    // The roots one project conversation stands to work with: the person's
    // other folders join the scope rows, and the workspace root leads the
    // write roots explicitly. It has to be named, because the policy replaces
    // its default write set with whatever arrives here - a scope grant
    // arriving alone used to take the conversation's own directory out of the
    // writable set, which is the opposite of what a grant means.
    const otherFolders = projectFolders.slice(1);
    // The conversation's own scratch directory, writable in every mode.
    //
    // Named here because the policy replaces its default write set with
    // whatever arrives, and a project conversation's set is built from the
    // person's folders - none of which is this. The prompt has always told a
    // project conversation it has a private directory of its own; until this
    // line the sandbox did not agree, and the first write to it was refused
    // as outside the workspace. In a plain conversation it is a second
    // writable root beside the workspace the run stands in.
    const scratchRoot = conversationScratchDirectory(options.conversationId);
    // Readable, and readable only. Both are the harness's to write - the
    // delivery's pictures at submission, the generations' outputs at
    // completion - and the run's to read, which is the half that used to be
    // missing: an uploaded image lived outside every read root, so the one
    // tool that could work on it had no path to reach it through. A second
    // writer to a folder this application files would be a state nobody can
    // explain, which is why neither joins the write roots below.
    const attachmentsRoot = conversationAttachmentsDirectory(options.conversationId);
    const artifactsRoot = conversationArtifactsDirectory(options.conversationId);
    const policy = createSandboxPolicy({
      workspaceRoot: projectRoot,
      // The scratch root is readable as well as writable, and not only for
      // symmetry: the policy refuses a writable root that sits inside no
      // readable one, because a place you may write and never read back is a
      // place you cannot work in.
      readRoots: withoutDuplicateRoots([
        scratchRoot,
        attachmentsRoot,
        artifactsRoot,
        ...otherFolders,
        ...roots.readRoots,
      ]),
      writeRoots: withoutDuplicateRoots([
        projectRoot,
        scratchRoot,
        ...otherFolders,
        ...roots.writeRoots,
      ]),
      ...(trusted ? { trusted: true } : {}),
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
    const planStore = this.#plans;
    // What this submission has registered, and what this conversation has
    // adopted across all of its submissions. The two have different lifetimes
    // and that difference is the whole design: the gate and this map are
    // rebuilt with the run, the adopted keys are not (see the field's
    // comment), and the withhold depends on the second surviving the first.
    const registeredMcp = new Map<string, McpTool>();
    const discovered = this.#discoveredToolKeysFor(options.conversationId);

    // The one door through which an MCP capability enters the gate, for the
    // eager refresh and for discovery alike. A second registration path would
    // be a second bookkeeping map that could disagree with this one, and the
    // disagreement would surface as a registration the gate refuses to
    // duplicate, or - through the replace below - as a tool offered twice.
    const registerMcpTool = (tool: McpTool): void => {
      const key = capabilityKey(tool.descriptor.id);
      const existing = registeredMcp.get(key);
      if (existing === tool) return;
      if (existing !== undefined) {
        // A different definition under the same key is 0029 §5's sanctioned
        // replacement, not a removal: the definition hash on the grants makes
        // the next approval a new one, which is the whole cost of replacing,
        // and the one thing that keeps an approval from outliving the schema
        // it was given for.
        gate.unregister(existing.descriptor.id);
      }
      gate.register(tool);
      registeredMcp.set(key, tool);
    };

    registerNativeTools(gate, {
      database: this.#db,
      credentials: this.#credentials,
      acceptsImages: (conversationId) => this.#modelAcceptsImages(conversationId),
      accessLog: this.#accessLogFor(options.conversationId),
      imageBudget: this.#imageBudget,
      jobs: this.#jobs,
      // The generations join the jobs tool's listing and its Stop: a
      // conversation's background work, one tool. Present exactly when the
      // generation tools are, since both come from the one mediaJobs option.
      ...(this.#mediaJobs === undefined ? {} : { mediaJobs: this.#mediaJobs }),
      ...(this.#media === undefined
        ? {}
        : {
            media: {
              media: this.#media,
              acceptsImages: (conversationId) => this.#modelAcceptsImages(conversationId),
              imageBudget: this.#imageBudget,
            },
          }),
      discover: {
        // Bound here rather than passed around, because what they answer is
        // decided where they are built: enablement as this conversation's
        // chain resolves it - the same context `refreshTools` resolves, so the
        // discovery's answer and the tools array cannot disagree about what
        // this conversation can reach, and the inventory would be the loser.
        // When the conversation's own scope decides, both readers have already
        // had the decision, because they resolve through the same chain.
        entries: () => this.#capabilityEntries(enablement),
        server: (serverId) => {
          const record = this.#registry.get(serverId);
          if (record === undefined) return undefined;
          return {
            record,
            resolution: this.#selection.resolve("mcp", serverId, enablement),
          };
        },
        tools: (serverId) => this.#catalog.tools([serverId]),
        // Adoption is registration plus remembering: the registration makes
        // the tool callable, the key makes the adoption survive the
        // submission. Forgetting the key here would work for the current
        // turn and silently drop the tool from the next one's array - which
        // is exactly the failure the integration test watches for, because
        // it is the one nothing else would catch.
        adopt: (tool) => {
          registerMcpTool(tool);
          discovered.add(capabilityKey(tool.descriptor.id));
        },
      },
      ...(questionBroker === undefined
        ? {}
        : {
            ask: {
              ask: (conversationId, payloads, timeoutMs, signal) =>
                questionBroker.ask(conversationId, payloads, timeoutMs, signal),
              closing,
            },
          }),
      ...(planStore === undefined
        ? {}
        : {
            plan: {
              // Writes through the tool are the model's, always; the person's
              // tick path is the HTTP route, which names itself.
              merge: (conversationId, items) => planStore.merge(conversationId, items, "model"),
            },
          }),
    });

    const refreshTools = (): void => {
      // Enablement resolves through this conversation's chain
      // (`#enablementContext`): this conversation, then the project it is
      // filed under, then this harness's project. The project leg is not a
      // key derived from the sandbox root, and this is why: the fallback
      // sandbox root *was* the harness's project, so the derived key happened
      // to match the one the registry, the selection store, the catalog and
      // the reconcile pass all use. Once a projectless conversation stood in
      // `~/.studio/workspace/<conversation>`, the derived key stopped
      // matching, the enabled set came back empty, and every MCP tool a user
      // had enabled for their project vanished from every conversation's
      // tool list - while the server itself still started, because the
      // reconcile pass asks the harness's project. That bug is what the
      // harness's project leg protects, which is why a projectless
      // conversation keeps it.
      const active = this.#enabledMcpServers(enablement);
      const enabledIds = new Set(active.map((record) => record.id));

      // The withhold, and it is now total for MCP. ADR 0048 §3 first said
      // system-provenance servers load eagerly; ADR 0049 §5 corrected that,
      // because it conflated **who owns a capability** with **how expensive it
      // is to load**. A Studio-owned browser is still twenty-four schemas, and
      // ownership does not make a schema cheap. The rule that replaced it:
      // eager loading is for capabilities small enough and general enough that
      // most turns might use them - which means the natives, registered above.
      // Everything reached over MCP is discovered, whoever wrote it.
      //
      // Kept as a loop over nothing rather than deleted, because what it
      // leaves behind is the important part: this function's *only* eager
      // contribution is the natives, and every MCP tool below is here because
      // this conversation asked for it. Nothing removes anything either - a
      // tool already registered keeps its place, since withholding applies at
      // registration and this function only ever declines to add. That is ADR
      // 0029's rule, kept.

      // This conversation's own adoptions, at the definitions the
      // catalog holds now. Reading the catalog instead of remembering the
      // definition is what lets 0029 §5's replacement happen at this turn
      // boundary when a connection refreshed, and it is what keeps the
      // adoption alive across submissions: this closure dies with the run,
      // the adopted keys do not. A key whose server no longer resolves to
      // enabled stays remembered but registers nothing - a new submission
      // starts from the current selection (0029 §4) - and the key itself
      // stays, so a server that comes back brings its discovered tools with
      // it, without anyone discovering again.
      for (const key of discovered) {
        const separator = key.indexOf("/");
        if (separator < 0) continue;
        const namespace = key.slice(0, separator);
        // The namespace here is the one `McpServerRegistry.namespaceOf`
        // wrote and the discovery scope speaks, so it is read back with the
        // same grammar: one unescaped slash, nothing before "mcp:".
        if (!namespace.startsWith("mcp:")) continue;
        const serverId = namespace.slice("mcp:".length);
        if (!enabledIds.has(serverId)) continue;
        const tool = this.#catalog
          .tools([serverId])
          .find((candidate) => capabilityKey(candidate.descriptor.id) === key);
        if (tool !== undefined) registerMcpTool(tool);
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
        // A project folder is the person's, and one that is not there is a
        // mistake to report, never a directory to make: a model told it is in
        // a project, writing into an empty directory it believes is a
        // repository, is worse than a refusal. The conversation's own tree is
        // ours and starts empty, so it is still created below - only the
        // sandbox root's meaning changed, not who owns what.
        if (firstFolder !== undefined) {
          const refusal = await missingFolderRefusal(
            firstFolder,
            projectRecord?.name ?? conversationProject ?? "",
          );
          if (refusal !== undefined) throw refusal;
        }
        // Admission of the first prompt is when a conversation comes into
        // existence on disk. The render computed this conversation's roots
        // and passed them in; creating the tree here rather than in the
        // render keeps a refused send from creating anything, and the
        // sandbox root is in place before the runtime's first AGENTS.md and
        // skills discovery reads the environment.
        // The working directory, only when it is this conversation's own. A
        // project conversation stands in the person's repository, so its
        // `workspace/` would be a folder nothing writes to, nothing reads
        // from, and nobody can explain - the third place in a design that has
        // two. Both modes get exactly the working directory they stand in and
        // one scratch directory beside it.
        if (projectRoot === conversationWorkspaceDirectory(options.conversationId)) {
          ensureDirectory(conversationWorkspaceDirectory(options.conversationId));
        }
        ensureDirectory(scratchRoot);
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
                // A job that ended mid-turn is told here, on the way back
                // from an unrelated call. This is the delivery point that
                // matters: a model that starts a download and keeps working
                // learns it finished without anyone having polled for it, and
                // without the harness starting a turn nobody asked for.
                return modelToolResult(
                  result,
                  joinNotices(
                    finishedNotice(this.#jobs.drainFinished(scope.conversationId)),
                    this.#media === undefined
                      ? undefined
                      : mediaFinishedNotice(mediaJobLines(this.#media, scope.conversationId).ended),
                  ),
                );
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
    // Before the supervisor, because these are the children nothing else
    // knows about: a dev server the model started still holding port 3000
    // after Studio has closed is a process the person never started and
    // cannot see to end.
    this.#jobs.stopAll();
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
