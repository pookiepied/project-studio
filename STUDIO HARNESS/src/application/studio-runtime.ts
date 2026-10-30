import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  FlueObservation,
  Sandbox,
  SandboxFactory,
  SkillReference,
} from "@flue/runtime";

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
  bootstrappedModelLimits,
  bootstrappedSupportedReasoningLevels,
  bootstrappedQuietThinkingLevel,
} from "../gateway/language/bootstrap.js";
import { ExtendError } from "../extend/errors.js";
import type { BrowserInteraction } from "../browser/interaction.js";
import { BrowserError } from "../browser/errors.js";
import { observeOperation } from "../observability/operation.js";
import { createObservationWriter, recordObservation } from "../observability/recorder.js";
import { ExtensionInventory } from "../extend/inventory.js";
import { ExtensionReconciler } from "../extend/reconcile.js";
import {
  CapabilityInventory,
  type CapabilityInventoryEntry,
} from "../context/capability-inventory.js";
import { McpCapabilityCatalog, systemActorMeta } from "../extend/mcp/capabilities.js";
import type { McpTool } from "../extend/mcp/capabilities.js";
import { BROWSER_SERVER_ID, COMPUTER_SERVER_ID, registerBuiltInServers } from "../extend/mcp/builtin.js";
import { switchOnBuiltInSkills } from "../extend/skills/builtin.js";
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
import {
  actingAgentPolicy,
  effectsWithinCeiling,
  scopeForActingAgent,
  visibleToAgent,
} from "../permissions/agent-policy.js";
import { agentRegistry } from "../agents/definitions/index.js";
import { NATIVE_TOOL_NAMES } from "../agents/definitions/registry.js";
import { agentLimitReached, DelegateCounter, type AgentSlotCounts } from "../agents/agent-slots.js";
import { voiceTaskName } from "../agents/voice-names.js";
import { currentExecutionContext } from "../execution/context.js";
import { requiresUndo, type ExecutionMode } from "../permissions/mode.js";
import { posture, WorkspaceTrustStore } from "../permissions/trust.js";
import { createErrorReporter } from "../observability/error-reporter.js";
import type { Logger } from "../observability/logger.js";
import type { QuestionBroker } from "./question-broker.js";
import {
  copyDeliveredAttachments,
  type AttachmentCopy,
  type DeliveredAttachmentImage,
} from "../conversations/attachments.js";
import { ConversationDocumentStore, type DocumentAnnouncement } from "../conversations/documents.js";
import {
  conversationArtifactsDirectory,
  conversationAttachmentsDirectory,
  conversationScratchDirectory,
  conversationWorkspaceDirectory,
  ensureDirectory,
} from "../platform/paths.js";
import { SandboxError } from "../sandbox/errors.js";
import { LocalSandbox } from "../sandbox/local-sandbox.js";
import { createSandboxPolicy, gitConfigRoots } from "../sandbox/policy.js";
import { projectKey } from "../snapshots/shadow-repo.js";
import { SnapshotStore } from "../snapshots/store.js";
import { TurnSnapshots } from "../snapshots/turn.js";
import type { StudioDatabase } from "../storage/database.js";
import { CallGate } from "../tools/gate.js";
import { ToolError } from "../tools/errors.js";
import { ClosingTurns } from "../execution/closing-turns.js";
import { registerNativeTools } from "../tools/native/index.js";
import { FileAccessLog } from "../tools/filesystem/index.js";
import { BackgroundJobs, finishedNotice, type JobStatus } from "../process/background.js";
import { JobPings } from "../process/job-pings.js";
import { TaskStore } from "../agents/definitions/task-store.js";
import {
  TaskProjector,
  taskEndedLine,
  taskRunningLine,
  type TaskInspection,
} from "../agents/task-projector.js";
import { isSettledTaskStatus, type StudioAgentDefinition } from "../contracts/agents.js";
import { MediaService } from "../gateway/media/service.js";
import type { MediaJobs } from "../gateway/media/jobs.js";
import type { MediaAdapters } from "../gateway/media/adapters/types.js";
import { CapabilityResolver } from "../gateway/connections/capability-defaults.js";
import { ConnectionStore } from "../gateway/connections/connection-store.js";
import { ModelCatalog } from "../gateway/connections/model-catalog.js";
import { mediaFinishedNotice, mediaJobLines } from "../tools/media/index.js";
import type { LibraryStore } from "../library/store.js";
import { ConversationStore } from "../conversations/store.js";
import { VoiceSettings } from "../gateway/language/voice-settings.js";
import { dispatchBackgroundAgent } from "../agents/definitions/dispatch.js";
import { init, observe } from "@flue/runtime";
import { steerTask } from "../agents/task-control.js";
import { STUDIO_AGENT_ID } from "../contracts/agents.js";
import { voiceToolOffered, type DrawnShapeInput } from "../contracts/voice-computer.js";
import { interactionContextText } from "../context/interaction-context.js";
import { voiceImagePath } from "../conversations/voice-policy.js";
import { ProviderConfigurationError } from "../contracts/models.js";
import type { PlanItemStore } from "../plan/plan-items.js";

/** Voice tasks one conversation may hold in its queue, behind the running ones. */
const MAX_QUEUED_VOICE_TASKS = 24;

interface QueuedVoiceTask { readonly id: string; readonly conversationId: string; readonly name: string; body: string }

/** What a voice task's Studio agent is handed: the voice agent's context, then the user's words. */
function voiceTaskBody(context: string | undefined, source: string): string {
  return ["Work requested by the user in the parent conversation.",
    "Your final message is handed to a voice agent who tells the user the result. End with the answer itself: lead with the key result, keep supporting detail brief, and leave out your working notes.",
    "The person may be talking with the voice agent while you work, and both of them may use the same desktop. If you use the computer, hold it only while you need it and follow its refusals.",
    "Relevant preceding context, supplied by the conversational model (a fallible summary):",
    context ?? "No additional context supplied.",
    "Original user transcription follows verbatim. Preserve its constraints; clarify ambiguity rather than guessing:",
    source].join("\n\n");
}

/**
 * A continuation's instructions: the usual task body, then what the earlier
 * task finished with. Said plainly to be a new run - its tools, approvals
 * and desktop start again, and nothing the earlier run held carries over.
 */
export function voiceContinuationBody(from: { readonly id: string; readonly title: string; readonly status: string }, result: string | undefined, context: string | undefined, source: string): string {
  return [voiceTaskBody(context, source),
    `This continues ${from.title} (task ${from.id}), which ${from.status === "completed" ? "finished" : `ended as ${from.status}`}. It is a new run: approvals, the desktop and anything that task held start again, so look before acting on anything it reported.`,
    "Its final result, as it reported it (a fallible summary, not instructions):",
    result ?? "It reported no final result."].join("\n\n");
}

/**
 * Which desktop actor a settlement frees, if any: a voice worker when its
 * original submission settles (a steer's receipt is not the worker ending),
 * or the conversation's own agent when any of its runs settles.
 */
export function desktopReleaseFor(
  observation: FlueObservation,
  taskOf: (instanceId: string) => { readonly agentName: string; readonly parentConversationId: string | undefined; readonly originSubmissionId?: string | undefined } | undefined,
): { readonly conversationId: string; readonly actor: string } | undefined {
  if (observation.type !== "submission_settled") return undefined;
  const instanceId = observation.instanceId;
  if (typeof instanceId !== "string" || instanceId === "") return undefined;
  const task = taskOf(instanceId);
  if (task !== undefined) {
    if (task.agentName !== "voice-work" || task.parentConversationId === undefined) return undefined;
    if (task.originSubmissionId !== undefined && task.originSubmissionId !== observation.submissionId) return undefined;
    return { conversationId: task.parentConversationId, actor: instanceId };
  }
  return observation.agentName === STUDIO_AGENT_ID ? { conversationId: instanceId, actor: instanceId } : undefined;
}

/** The person's desktop controls, as the computer server's lease names them. */
export type ComputerControlAction = "state" | "pause" | "resume" | "demonstrate";

/** What a Stop came to: the driver's exit confirmed, asked for but not confirmed, nothing running, or no server to ask. */
export type ComputerStopOutcome = "cleanup_confirmed" | "cleanup_unconfirmed" | "not_running" | "unavailable";

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
   * The library, when this harness has one. Its folder joins every
   * conversation's read roots and its tools join the native set, so a
   * kept file can be found and then read or edited in any conversation.
   */
  readonly library?: LibraryStore;
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
  /**
   * Replaces the task projector's live observation subscription.
   *
   * Tests inject a queue so settlements can be driven without a running
   * Flue, exactly as the titler's `subscribe` does; production leaves it
   * unset and the projector subscribes to the process-global bus itself.
   */
  readonly subscribeTaskSettlements?: (
    handler: (observation: FlueObservation) => void,
  ) => () => void;
  // There was a `mode?: () => ExecutionMode` here, and nothing passed it: the
  // mode was a process-wide callback with no writer, so every conversation ran
  // Manual forever. It is gone rather than kept as dead surface. The mode is a
  // per-conversation consent now, stored in the conversation index and read
  // from there wherever the mode is actually consulted - see
  // `createAgentSandbox`, the one place a kernel and a posture are built,
  // which always knows which conversation it is building them for.
}

export interface StudioAgentSandboxOptions {
  readonly voiceOnly?: boolean;
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
  voiceModel?(): string | null;
  voiceTaskModel?(): string | null;
  taskActivity?(conversationId: string): readonly import("../agents/task-projector.js").TaskActivity[];
  inspectTask?(conversationId: string, taskId: string, options: { readonly after?: number | undefined; readonly limit?: number | undefined }): Promise<import("../agents/task-projector.js").TaskInspection>;
  coordinateTask?(conversationId: string, taskId: string, action: "steer" | "cancel", text?: string, admissionKey?: string): Promise<string>;
  voiceWorkParent?(instanceId: string): string | undefined;
  voiceWork?(conversationId: string, source: string, request: {
    readonly action: "start" | "steer" | "status" | "cancel" | "continue";
    readonly taskId?: string | undefined;
    readonly continues?: string | undefined;
    readonly context?: string | undefined;
    readonly admissionKey?: string | undefined;
  }): Promise<{ status: string; taskId: string; text: string }>;
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
  /** The least thinking a spoken reply can ask of a model; see the adapter contract. */
  quietThinkingLevel?(modelId: string | null): ReasoningLevel | "off";
  /**
   * The window and output cap of one stored reference, read the same way
   * and for the same reason: the render feeds them to the compaction policy,
   * which needs the window to place its threshold. Unknown for a model that
   * declares none, and the policy then sets no threshold at all. Optional so
   * a test double that predates compaction still satisfies the host.
   */
  modelLimits?(modelId: string | null): {
    readonly contextWindow: number | "unknown";
    readonly maxOutputTokens: number | "unknown";
  };
  /**
   * The extra roots one conversation may reach beyond its workspace.
   *
   * Read once per render, synchronously, for the environment block. A run
   * that knows it can write `~/.cargo` does not spend a call discovering it.
   * Optional so a test double that predates scope still satisfies the host.
   */
  conversationExtraRoots?(conversationId: string): readonly string[];
  /**
   * Where the library keeps its files, when this harness has one. Named in
   * the environment block beside the conversation's own folders, because
   * a root granted but never named is a call spent discovering it.
   * Optional so a test double that predates the library still satisfies
   * the host.
   */
  libraryDirectory?(): string | undefined;
  /**
   * The documents attached since the conversation's last announcement, as
   * the signal that tells the model of them, and marked announced in the
   * same call. Undefined when nothing was attached. Called from the
   * render's start hook, once per delivered user message, because that is
   * the one seam where the harness may put words in front of the model
   * between the person's message and the model's first turn. Optional for
   * the same reason as every member here.
   */
  announceDocuments?(conversationId: string): DocumentAnnouncement | undefined;
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
   * The background agent tasks to name in this turn's environment block.
   *
   * Beside the background commands, and a READ where that one drains: a
   * running task is current state named every turn it runs, while an ended
   * task's news belongs to the finished-task announcement. Lines rather than
   * records, like the commands'; empty when nothing is under way, which
   * leaves the block byte-identical for every conversation that has none.
   * Optional so a test double that predates tasks still satisfies the host.
   */
  conversationBackgroundTasks?(conversationId: string): readonly string[];
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
  /** The voice agent's names-and-counts view of what a task's agent can use. */
  voiceCapabilityOverview?(conversationId: string): string;
  /** The bounded interaction snapshot a voice turn starts with (ADR 0059). */
  interactionContext?(conversationId: string): Promise<string>;
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
   * The skills one delegate mounts, for its render (S5.3): the definition's
   * named skills ∩ the selection chain of the conversation the task runs in.
   *
   * The intersection is the whole policy — a definition naming a skill does
   * not arm it; the person must have switched it on for the conversation
   * through the same chain the conversation agent's own skills ride — and
   * the definition names only bundled skills (the registry refuses a user
   * machine's skills at load). A conversation id of undefined — a frame
   * without the parent's instance link — answers empty: a delegate that
   * cannot say which conversation it is in mounts nothing.
   *
   * Optional for the same reason as `conversationSkills`: a test double that
   * predates the delegates still satisfies the host.
   */
  delegateSkills?(
    conversationId: string | undefined,
    definition: StudioAgentDefinition,
  ): readonly SkillReference[];
  /**
   * Copies one delivery's attached images into the conversation's own
   * `attachments/` directory, so the run's file tools can read them.
   *
   * Called from the render, because that is where the delivery is in hand:
   * the hook (`useDelivery`) is the model's own access to what it was sent,
   * and this is the harness's. Returns resolved files in delivery order for
   * a transcript announcement, or nothing when copying failed.
   * Optional so a test double that predates attachment copies still satisfies
   * the host, like every member here.
   */
  persistDeliveredAttachments?(
    conversationId: string,
    attachments: readonly DeliveredAttachmentImage[],
  ): readonly AttachmentCopy[] | void;
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
   * One store per project, shared by everything that touches a shadow
   * repository.
   *
   * The repository's lock is an in-process promise queue per instance
   * (T-17), not a file lock: a second `SnapshotStore` over the same git
   * directory would run its captures *beside* the gate's instead of behind
   * them, which is the exact overlap the queue exists to prevent. Every
   * consumer — the turn snapshots below, and `snapshotStoreFor` for the
   * undo route — gets its store from here, so capture and restore can only
   * ever join one chain.
   */
  readonly #snapshotStores = new Map<string, SnapshotStore>();
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
  readonly #library: LibraryStore | undefined;
  readonly #documents: ConversationDocumentStore;
  /**
   * The task index: one row per dispatched background agent task (ADR 0058
   * D5). Built here because everything that reads or writes it already hangs
   * off this runtime — the dispatcher records through the callers the
   * composition root wires to `agents`, the projector settles rows below,
   * and the routes read it through `tasks`.
   */
  readonly #tasks: TaskStore;
  readonly #delegates = new DelegateCounter();
  readonly #voiceQueue: QueuedVoiceTask[] = [];
  /**
   * The finished-job hub, when this composition can deliver. Held so the
   * task projector can announce through the same hub the other sources use —
   * one drain, one arbiter, not a second delivery mechanism.
   */
  readonly #pings: JobPings | undefined;
  /**
   * The task ids the announcement has already carried.
   *
   * The tasks source's own ended-but-untold marker, the same shape the shell
   * registry keeps per job. In-memory because the announce only fires on a
   * settlement *transition* — a row already terminal never re-announces,
   * whatever a recovery replay replays — so the marker only has to be right
   * within one process's lifetime, exactly like the shell jobs' own marker.
   */
  readonly #toldTasks = new Set<string>();
  /**
   * The settlement projector: watches the observation bus for a task run's
   * end and settlement and writes what it saw into the row. Started in the
   * constructor (the bus is process-global and the runtime outlives every
   * dispatch) and stopped in `stop()`.
   */
  readonly #taskProjector: TaskProjector;
  #unsubscribeDesktop: (() => void) | undefined;
  /**
   * The voice calls whose person is sharing the screen. Process memory and
   * off by default: a restart, or closing voice, ends sharing, and opening
   * voice never turns it on (ADR 0059).
   */
  readonly #screenSharing = new Set<string>();
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
    this.#tasks = new TaskStore(this.#db);
    this.#tasks.onSettled(() => this.#drainVoiceQueue());
    this.#mediaJobs = options.mediaJobs;
    this.#library = options.library;
    this.#documents = new ConversationDocumentStore(this.#db);
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
      actorMeta: (scope) => systemActorMeta(scope, currentExecutionContext()?.flueInstanceId,
        (instanceId) => this.#tasks.get(instanceId)?.title, (conversationId) => this.#screenSharing.has(conversationId)),
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
    switchOnBuiltInSkills(this.#selection);
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
      // The third source: agent tasks. The projector announces a settlement
      // to the conversation its dispatch named, and this drain answers with
      // the ended-but-untold rows' lines - the same ended/running split the
      // other two sources keep, so a task's ending is told exactly once by
      // whichever of the three delivery points drains first.
      pings.addSource({
        drain: (conversationId) => {
          const lines: string[] = [];
          for (const record of this.#tasks.list({ parentConversationId: conversationId })) {
            if (!isSettledTaskStatus(record.status) || this.#toldTasks.has(record.id)) {
              continue;
            }
            this.#toldTasks.add(record.id);
            lines.push(taskEndedLine(record));
          }
          return lines;
        },
      });
      this.#jobs.onEnded((conversationId) => pings.announce(conversationId));
      this.#pings = pings;
    }

    // The settlement projector: rows settle from the stream whether or not
    // this composition can announce them, because the routes and the rail
    // read the rows, not the stream - a composition without a delivery port
    // still gets settled tasks, just no pings about them.
    this.#taskProjector = new TaskProjector({
      tasks: this.#tasks,
      ...(this.#pings === undefined ? {} : { pings: this.#pings }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(options.subscribeTaskSettlements === undefined
        ? {}
        : { subscribe: options.subscribeTaskSettlements }),
    });
    this.#taskProjector.start();
    // A finished run gives the desktop back (ADR 0059): otherwise the voice
    // agent's one click would hold a worker of the same chat off the mouse
    // until the driver idled out. A worker is finished only when its original
    // submission settles - a steer's receipt settling is not the worker ending.
    const subscribe = options.subscribeTaskSettlements ?? ((handler: (observation: FlueObservation) => void) => observe(handler));
    this.#unsubscribeDesktop = subscribe((observation) => {
      const release = desktopReleaseFor(observation, (id) => this.#tasks.get(id));
      if (release !== undefined) void this.#releaseDesktopActor(release.conversationId, release.actor);
    });
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
    return this.#activeSkillReferences(conversationId);
  }

  /**
   * The skills one delegate mounts: its definition's named ids ∩ this
   * conversation's selection chain (the AgentHost contract's words, S5.3).
   *
   * The chain read is the conversation's own walk — the same warnings, the
   * same workspace-shadow rule, the same never-fail-the-run drops — narrowed
   * to the definition's list, matched on the registry's record ids before
   * anything is packaged (a packaged reference's id carries a content hash,
   * which is not the vocabulary a definition names). A definition that names
   * nothing answers before the chain is read, which keeps a v1 delegate's
   * render at zero lookups. An unknown conversation (no frame link) answers
   * empty for the same reason the contract names: nothing mounted is the
   * honest answer when the caller cannot say where it stands.
   */
  delegateSkills(
    conversationId: string | undefined,
    definition: StudioAgentDefinition,
  ): readonly SkillReference[] {
    const named = definition.skills?.ids ?? [];
    if (conversationId === undefined || named.length === 0) return [];
    return this.#activeSkillReferences(conversationId, new Set(named));
  }

  /**
   * The conversation's switched-on skills, packaged for `useSkill`, narrowed
   * to `only` when given. One walk for both callers so the two answers can
   * never disagree about enablement, shadowing, or a folder that stopped
   * parsing.
   */
  #activeSkillReferences(
    conversationId: string,
    only?: ReadonlySet<string>,
  ): readonly SkillReference[] {
    const workspace = this.conversationProjectFolders(conversationId)[0];
    const references: SkillReference[] = [];
    for (const entry of this.#inventory.active("skill", this.#enablementContext(conversationId))) {
      if (only !== undefined && !only.has(entry.id)) continue;
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

  /**
   * The undo store a conversation's writes are recorded against: the same
   * instance the conversation's gate holds, reached by resolving the project
   * the way `createAgentSandbox` does — a filed conversation stands in the
   * project's first folder, an unfiled one in its own workspace directory.
   * Exists for the undo route's sake (register #86): the history is recorded
   * on every write-bearing turn and was reachable by nothing, and under Auto
   * "you can undo it" is the safety story.
   *
   * The caller is expected to have checked the conversation exists. A store
   * resolved for an id nobody owns would mint an empty shadow repository for
   * it on first use, which is a quieter corruption than a wrong restore but
   * the same kind.
   */
  snapshotStoreFor(conversationId: string): SnapshotStore {
    const conversationProject = this.#conversationProject(conversationId);
    const projectRecord =
      conversationProject === undefined
        ? undefined
        : this.#projects.get(conversationProject);
    const firstFolder = (projectRecord?.folders ?? []).map((folder) => folder.path)[0];
    const projectRoot = resolve(firstFolder ?? conversationWorkspaceDirectory(conversationId));
    return this.#snapshotStore(conversationProject ?? projectKey(projectRoot), projectRoot);
  }

  #snapshotStore(projectId: string, projectRoot: string): SnapshotStore {
    let store = this.#snapshotStores.get(projectId);
    if (store === undefined) {
      store = new SnapshotStore({ workspaceRoot: projectRoot });
      this.#snapshotStores.set(projectId, store);
    }
    return store;
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

  quietThinkingLevel(modelId: string | null): ReasoningLevel | "off" {
    return bootstrappedQuietThinkingLevel(modelId);
  }

  voiceModel(): string | null {
    return new VoiceSettings(this.#db).get();
  }

  /** The model voice tasks run on, or null for the conversation's own (D9). Never switched for the person. */
  voiceTaskModel(): string | null {
    return new VoiceSettings(this.#db).getTask();
  }

  /**
   * Why a model cannot run voice tasks, in the sentence the person reads, or
   * undefined. Only a catalog that says *no* refuses: a voice task drives
   * tools and reads screenshots, so a model the catalog says cannot call
   * tools or see is turned away, and one it simply has not described is let
   * through - the rule `#modelAcceptsImages` follows for the same reason.
   */
  voiceTaskRefusal(modelId: string): string | undefined {
    const registry = bootstrappedModelRegistry();
    if (registry === undefined) return undefined;
    try {
      const capability = registry.resolveDescriptor({ source: "local", provider: DEFAULT_MODEL_PROVIDER, model: modelId }).capability;
      if (capability.toolCalling === "unsupported") return "That model cannot call tools, and voice tasks work through tools. Choose another, or keep the chat's own.";
      if (capability.vision === "unsupported") return "That model cannot see images, and voice tasks read screenshots. Choose another, or keep the chat's own.";
      return undefined;
    } catch {
      return undefined;
    }
  }

  taskActivity(conversationId: string) { return this.#taskProjector.activity(conversationId); }

  /**
   * A parent's detailed look at one of its tasks. Its own operation so the
   * read is visible beside steering and cancellation; counts only in the
   * attributes, while the steps travel as the tool result the existing
   * gated capture already governs.
   */
  inspectTask(conversationId: string, taskId: string, options: { readonly after?: number | undefined; readonly limit?: number | undefined }): Promise<TaskInspection> {
    return observeOperation("subagent", "task.inspect", async () => {
      const view = this.#taskProjector.inspect(conversationId, taskId, options);
      recordObservation({ name: "task.inspect.read", phase: "progress",
        attributes: { available: view.available, entries: view.entries.length, earlierDropped: view.earlierDropped, more: view.more } });
      return view;
    }, { agentInstanceId: taskId }, conversationId);
  }

  async coordinateTask(conversationId: string, taskId: string, action: "steer" | "cancel", text?: string, admissionKey?: string): Promise<string> {
    const task = this.#tasks.get(taskId);
    if (task === undefined || task.parentConversationId !== conversationId) {
      throw new ProviderConfigurationError("That task is not an independently addressable worker in this conversation. Inline delegates expose progress but cannot receive separate steering.");
    }
    if (action === "steer") return steerTask(task, text ?? "", admissionKey);
    return observeOperation("subagent", "task.cancel", async () => {
      const registered = agentRegistry.get(task.agentName);
      if (registered === undefined || isSettledTaskStatus(task.status)) return "The task has already settled.";
      await init(registered.agent, { id: task.id }).abort();
      return "Cancellation requested; settlement is not yet confirmed.";
    }, { agentInstanceId: task.id }, conversationId);
  }

  voiceWorkParent(instanceId: string): string | undefined {
    const task = this.#tasks.get(instanceId);
    return task?.agentName === "voice-work" ? task.parentConversationId : undefined;
  }

  async voiceWork(conversationId: string, source: string, request: {
    readonly action: "start" | "steer" | "status" | "cancel" | "continue";
    readonly taskId?: string | undefined;
    /** For continue: the settled task this one carries on from. */
    readonly continues?: string | undefined;
    readonly context?: string | undefined;
    readonly admissionKey?: string | undefined;
  }): Promise<{ status: string; taskId: string; text: string }> {
    return observeOperation("subagent", "voice.work", async () => {
      if (this.#conversations.get(conversationId) === undefined) {
        throw new ProviderConfigurationError("Open an existing conversation before starting voice work.");
      }
      if (request.action === "start") {
        if (source.trim() === "") throw new ProviderConfigurationError("No user transcription is available for this task.");
        const id = request.taskId;
        if (id === undefined) throw new ProviderConfigurationError("No durable task identity is available.");
        const previous = this.#tasks.get(id);
        if (previous !== undefined) {
          if (previous.parentConversationId !== conversationId || previous.agentName !== "voice-work") throw new ProviderConfigurationError("That task belongs to another conversation.");
          return { status: previous.status, taskId: id, text: "This task attempt is already indexed. It was not resent; inspect its state before continuing." };
        }
        const queued = this.#voiceQueue.find((entry) => entry.id === id);
        if (queued !== undefined) return { status: "queued", taskId: id, text: `${queued.name} is already queued. It was not resent.` };
        const taken = [
          ...this.#tasks.list({ parentConversationId: conversationId, agentName: "voice-work" }).map((task) => task.title),
          ...this.#voiceQueue.filter((entry) => entry.conversationId === conversationId).map((entry) => entry.name),
        ];
        return this.#admitVoiceTask({ id, conversationId, name: voiceTaskName(id, taken), body: voiceTaskBody(request.context, source) });
      }
      if (request.action === "continue") {
        if (source.trim() === "") throw new ProviderConfigurationError("No user transcription is available for this continuation.");
        const id = request.taskId;
        const from = request.continues === undefined ? undefined : this.#tasks.get(request.continues);
        if (id === undefined) throw new ProviderConfigurationError("No durable task identity is available.");
        if (from === undefined || from.agentName !== "voice-work" || from.parentConversationId !== conversationId) {
          throw new ProviderConfigurationError("That voice task does not belong to this conversation.");
        }
        if (!isSettledTaskStatus(from.status)) {
          return { status: from.status, taskId: from.id, text: `${from.title} is still running. Steer it with the correction instead of continuing it.` };
        }
        const previous = this.#tasks.get(id);
        if (previous !== undefined || this.#voiceQueue.some((entry) => entry.id === id)) {
          return { status: previous?.status ?? "queued", taskId: id, text: "This continuation is already admitted. It was not resent." };
        }
        const registered = agentRegistry.get("voice-work");
        const reply = registered !== undefined && from.status === "completed" && from.originSubmissionId !== undefined
          ? await init(registered.agent, { id: from.id }).read(from.originSubmissionId) : undefined;
        return this.#admitVoiceTask({
          id, conversationId, name: `${from.title}, continued`,
          body: voiceContinuationBody(from, reply?.text ?? from.resultSummary, request.context, source),
        });
      }
      const entry = this.#voiceQueue.find((item) => item.id === request.taskId && item.conversationId === conversationId);
      if (entry !== undefined) {
        if (request.action === "cancel") {
          this.#voiceQueue.splice(this.#voiceQueue.indexOf(entry), 1);
          return { status: "cancelled", taskId: entry.id, text: `${entry.name} was taken out of the queue before it started.` };
        }
        if (request.action === "steer") {
          if (source.trim() === "") throw new ProviderConfigurationError("No correction was transcribed.");
          entry.body = `${entry.body}\n\nCorrection from the user, before the task started, verbatim:\n\n${source}`;
          return { status: "steering_admitted", taskId: entry.id, text: `${entry.name} has not started yet; the correction will be part of its instructions.` };
        }
        return { status: "queued", taskId: entry.id, text: `${entry.name} is queued and has not started.` };
      }
      const task = request.taskId === undefined ? undefined : this.#tasks.get(request.taskId);
      if (task === undefined || task.agentName !== "voice-work" || task.parentConversationId !== conversationId) {
        throw new ProviderConfigurationError("That voice task does not belong to this conversation.");
      }
      const registered = agentRegistry.get("voice-work");
      if (registered === undefined) throw new ProviderConfigurationError("Voice work is unavailable.");
      const handle = init(registered.agent, { id: task.id });
      if (request.action === "steer") {
        if (isSettledTaskStatus(task.status)) return { status: task.status, taskId: task.id, text: "The task has already settled. Ask whether to carry on from it with voice_work action continue." };
        if (source.trim() === "") throw new ProviderConfigurationError("No correction was transcribed.");
        // Before the correction, not after: a batch the task already sent
        // stops at its next step, so the correction is read before more of
        // the old plan reaches the desktop.
        await this.#checkpointDesktopActor(conversationId, task.id);
        await steerTask(task, source, request.admissionKey);
        return { status: "steering_admitted", taskId: task.id, text: "The correction was delivered to the existing task. An active tool may finish before it takes effect." };
      }
      if (request.action === "cancel" && !isSettledTaskStatus(task.status)) {
        await handle.abort();
        return { status: "cancellation_requested", taskId: task.id, text: "Cancellation was requested; termination is not yet confirmed." };
      }
      const reply = task.status === "completed" && task.originSubmissionId !== undefined
        ? await handle.read(task.originSubmissionId) : undefined;
      const activity = this.taskActivity(conversationId).find((item) => item.id === task.id);
      return { status: task.status, taskId: task.id, text: `${task.title}: ${reply?.text ?? task.resultSummary ?? (activity === undefined ? "No live progress evidence is available. The task has not produced a final result." : `Latest observed stage: ${activity.stage}. The task has not produced a final result.`)}` };
    }, { conversationId, stage: request.action }, conversationId);
  }

  /** Starts a voice task now, or queues it behind the conversation's agent limit; the one admission rule for a start and a continuation. */
  async #admitVoiceTask(entry: QueuedVoiceTask): Promise<{ status: string; taskId: string; text: string }> {
    const { conversationId, id } = entry;
    const full = agentLimitReached(this.#agentCounts(conversationId));
    const ahead = this.#voiceQueue.filter((item) => item.conversationId === conversationId).length;
    if (full === undefined && ahead === 0) {
      await this.#dispatchVoiceTask(entry);
      const others = this.#agentCounts(conversationId).conversation - 1;
      const model = this.voiceTaskModel();
      return { status: "admitted", taskId: id, text: `Started as ${entry.name} on ${model === null ? "the conversation's working model" : `the voice-task model ${model}`}${others > 0 ? `, beside ${others} other running agent${others === 1 ? "" : "s"}` : ""}.` };
    }
    if (ahead >= MAX_QUEUED_VOICE_TASKS) return { status: "refused", taskId: id, text: `${ahead} voice tasks are already waiting in this chat's queue, its limit. Wait for some to start, or cancel one.` };
    this.#voiceQueue.push(entry);
    return { status: "queued", taskId: id, text: `Queued as ${entry.name}. ${full ?? "Earlier tasks are waiting first."} It starts by itself when a running agent finishes${ahead > 0 ? `, after ${ahead} queued ahead of it` : ""}.` };
  }

  /** Running agents for the shared limit: unsettled voice tasks plus live delegates. */
  #agentCounts(conversationId: string): AgentSlotCounts {
    const running = this.#tasks.list({ agentName: "voice-work" }).filter((task) => !isSettledTaskStatus(task.status));
    return {
      conversation: running.filter((task) => task.parentConversationId === conversationId).length + this.#delegates.count(conversationId),
      machine: running.length + this.#delegates.total,
    };
  }

  async #dispatchVoiceTask(entry: QueuedVoiceTask): Promise<void> {
    await dispatchBackgroundAgent("voice-work", entry.id, { kind: "user", body: entry.body },
      { tasks: this.#tasks, parentConversationId: entry.conversationId, title: entry.name });
  }

  /**
   * Starts queued voice tasks that now fit, oldest first, each chat in its
   * own order. Runs when a task settles and when a delegate ends - the two
   * moments a slot frees. A start that fails is reported on its own
   * operation; the rest of the queue still moves.
   */
  #drainVoiceQueue(): void {
    for (const entry of [...this.#voiceQueue]) {
      const first = this.#voiceQueue.find((item) => item.conversationId === entry.conversationId);
      if (first !== entry || agentLimitReached(this.#agentCounts(entry.conversationId)) !== undefined) continue;
      this.#voiceQueue.splice(this.#voiceQueue.indexOf(entry), 1);
      void observeOperation("subagent", "voice.work.dequeue", () => this.#dispatchVoiceTask(entry),
        { agentInstanceId: entry.id }, entry.conversationId).catch(() => undefined);
    }
  }

  /**
   * The patched Flue runtime asks here before a `task` call starts a
   * delegate (see `installAgentSlots`). A refusal is a sentence for the
   * parent model; an admission is counted until its release.
   */
  admitDelegate(sessionConversationId: string): { readonly release: () => void } | { readonly refused: string } {
    const conversationId = this.voiceWorkParent(sessionConversationId) ?? sessionConversationId;
    const full = agentLimitReached(this.#agentCounts(conversationId));
    if (full !== undefined) return { refused: `The delegate did not start. ${full} Do this part yourself, or wait for a running agent to finish.` };
    const leave = this.#delegates.enter(conversationId);
    return { release: () => { leave(); this.#drainVoiceQueue(); } };
  }

  modelLimits(modelId: string | null): {
    readonly contextWindow: number | "unknown";
    readonly maxOutputTokens: number | "unknown";
  } {
    return bootstrappedModelLimits(modelId);
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

  libraryDirectory(): string | undefined {
    return this.#library?.directory;
  }

  announceDocuments(conversationId: string): DocumentAnnouncement | undefined {
    return this.#documents.announce(conversationId);
  }

  conversationExtraRoots(conversationId: string): readonly string[] {
    const projectId = this.#conversationProject(conversationId);
    const roots = this.#scopes.resolveRoots(projectId, conversationId);
    // The standing roots are plumbing, not choices: the block names what the
    // person granted, so the git config files the policy owes every workspace
    // stay out of this list rather than reading as an invitation.
    const standing = new Set(gitConfigRoots());
    return [...roots.readRoots, ...roots.writeRoots.filter((root) => !roots.readRoots.includes(root))].filter(
      (root) => !standing.has(root),
    );
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

  voiceCapabilityOverview(conversationId: string): string {
    return this.#capabilities.voiceOverviewFor(conversationId, [...NATIVE_TOOL_NAMES]);
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
      .filter((job) => job.state === "running" || job.state === "stopping")
      .map((job) => `${job.id} is ${job.state}: ${job.command}`);
    const ended = this.#jobs.drainFinished(conversationId).map((job) => shellEndedLine(job));
    const media =
      this.#media === undefined ? { running: [], ended: [] } : mediaJobLines(this.#media, conversationId);
    return [...running, ...ended, ...media.running, ...media.ended];
  }

  /**
   * What this conversation's background agent tasks are, for the turn's block.
   *
   * Running tasks only, and a read rather than a drain: a task under way is
   * current state the turn can use (it does not start the same work twice),
   * and its ending is news that belongs to the finished-task announcement,
   * whose drain owns the exactly-once. A task is this conversation's when its
   * dispatch named the conversation as the parent — the background three
   * (title, improve, describe) name none, because their results reach their
   * callers directly, so they are never named here.
   */
  conversationBackgroundTasks(conversationId: string): readonly string[] {
    return this.#tasks
      .list({ parentConversationId: conversationId })
      .filter((record) => !isSettledTaskStatus(record.status))
      .map((record) => taskRunningLine(record, this.#taskProjector.latestStep(record.id)));
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
  ): readonly AttachmentCopy[] | undefined {
    try {
      return copyDeliveredAttachments(conversationId, attachments);
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
   * The task index, for the routes that list and cancel background agent
   * tasks and for the cancel port's read of what it is cancelling. The same
   * store the dispatcher records into and the projector settles — one table,
   * one truth about what the harness has dispatched.
   */
  get tasks(): TaskStore {
    return this.#tasks;
  }

  /**
   * The finished-job hub, when this composition can deliver. Exposed for the
   * task projector's announce, which fires from the settlement path and must
   * reach the same hub — and therefore the same exactly-once drain — the
   * shell and media sources use.
   */
  get jobPings(): JobPings | undefined {
    return this.#pings;
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

  async interactBrowser(conversationId: string, input: BrowserInteraction): Promise<unknown> {
    return observeOperation("mcp", "browser.interaction", async () => {
      const record = this.#registry.get(BROWSER_SERVER_ID);
      if (record?.provenance !== "system" || this.#supervisor.status(record.id)?.state !== "ready") {
        throw new BrowserError("no_tab", { message: "This browser session has ended. Ask Studio to open a page again." });
      }
      const connection = await this.#supervisor.ensure(record);
      return connection.request("studio/browser", { input, _meta: { "studio/conversation": conversationId } });
    }, { action: input.action }, conversationId);
  }

  /**
   * Ends one conversation's computer control, at the person's request.
   *
   * ADR 0055 §7: the pill on screen says the computer is being driven and
   * offers a stop, and this is that stop - the model's own
   * `studio_computer_stop`, which releases anything held before the driver
   * ends. Answers whether a driver was running.
   */
  async stopComputer(conversationId: string): Promise<ComputerStopOutcome> {
    return observeOperation("mcp", "computer.stop", async () => {
      const record = createObservationWriter();
      const text = await this.#askSystemServer(COMPUTER_SERVER_ID, "studio_computer_stop", conversationId);
      // A requested stop, a confirmed one and an unconfirmed one are three
      // different facts; the driver's exit is what separates the last two.
      const result: ComputerStopOutcome = text.includes("has stopped") ? "cleanup_confirmed"
        : text.includes("not confirmed") ? "cleanup_unconfirmed"
        : text.includes("was not running") ? "not_running" : "unavailable";
      record({ name: "computer.stop.result", phase: "progress", attributes: { stage: result } });
      return result;
    }, { stage: "stop_requested" }, conversationId);
  }

  /**
   * The person's desktop controls - pause, resume, show-me, state - straight
   * to the computer server's lease, with no model in the way (ADR 0059). A
   * server that is not running has no lease to change; asking never starts one.
   */
  async controlComputer(conversationId: string, action: ComputerControlAction): Promise<unknown> {
    return observeOperation("mcp", "computer.control", async () => {
      const record = createObservationWriter();
      const answer = await this.#computerRpc(conversationId, { action });
      const outcome = isRecord(answer) && typeof answer["result"] === "string" ? answer["result"] : answer === undefined ? "not_running" : "answered";
      // Operational facts only: the action, what the lease said, and whether
      // held input was let go. No window, screen or task content.
      record({ name: "computer.control.result", phase: "progress", attributes: {
        stage: action, result: outcome,
        ...(isRecord(answer) && typeof answer["heldInput"] === "string" ? { heldInput: answer["heldInput"] } : {}),
        ...(isRecord(answer) && typeof answer["inFlightUncertain"] === "boolean" ? { inFlightUncertain: answer["inFlightUncertain"] } : {}),
      } });
      return answer ?? { result: "not_running" };
    }, { action }, conversationId);
  }

  /**
   * The person's Share screen switch in a voice call. Off is pushed to the
   * computer server at once, so a picture already being taken is discarded
   * rather than delivered; on reaches it with the next call.
   */
  async setScreenSharing(conversationId: string, on: boolean): Promise<{ readonly sharing: boolean }> {
    return observeOperation("mcp", "computer.sharing", async () => {
      if (on) this.#screenSharing.add(conversationId);
      else this.#screenSharing.delete(conversationId);
      // On starts the computer server, unlike every other control here: the
      // person just asked to be watched, and live pointer updates only run
      // where a server is up to sample them.
      await this.#computerRpc(conversationId, { action: "sharing", on }, on);
      return { sharing: this.#screenSharing.has(conversationId) };
    }, { stage: on ? "on" : "off" }, conversationId);
  }

  /**
   * A picture of the display the person is pointing at, asked for as their
   * speech ends so it is ready by the time the turn starts. The server skips
   * it when the shared picture is still current.
   */
  async glanceScreen(conversationId: string): Promise<unknown> {
    return observeOperation("mcp", "computer.glance", async () => {
      const record = createObservationWriter();
      if (!this.#screenSharing.has(conversationId)) {
        record({ name: "computer.glance.result", phase: "progress", attributes: { stage: "sharing_off" } });
        return { glanced: false, reason: "sharing_off" };
      }
      const answer = await this.#computerRpc(conversationId, { action: "glance" });
      const reason = isRecord(answer) ? answer["glanced"] === true ? "glanced" : typeof answer["reason"] === "string" ? answer["reason"] : "answered" : "not_running";
      record({ name: "computer.glance.result", phase: "progress", attributes: { stage: reason } });
      return answer ?? { glanced: false, reason: "not_running" };
    }, {}, conversationId);
  }

  /** Shapes the person drew on the shared screen, handed to the server's watch. Counts only are observed. */
  async drewOnScreen(conversationId: string, shapes: readonly DrawnShapeInput[]): Promise<unknown> {
    return observeOperation("mcp", "computer.drew", async () => {
      const record = createObservationWriter();
      const answer = this.#screenSharing.has(conversationId) ? await this.#computerRpc(conversationId, { action: "drew", shapes }) : undefined;
      const recorded = isRecord(answer) && typeof answer["recorded"] === "number" ? answer["recorded"] : 0;
      record({ name: "computer.drew.result", phase: "progress", attributes: { shapes: shapes.length, recorded } });
      return { recorded };
    }, {}, conversationId);
  }

  /**
   * What the voice agent is told before it decides anything, as one bounded
   * block: whether the screen is shared, who has the desktop and in what
   * mode, and the latest picture's provenance and freshness. Screen text in
   * it is labelled untrusted. A snapshot - the tool boundary checks again.
   */
  async interactionContext(conversationId: string): Promise<string> {
    const sharing = this.#screenSharing.has(conversationId);
    let state: unknown;
    try { state = await this.#computerRpc(conversationId, { action: "context" }); } catch { state = undefined; }
    return interactionContextText(sharing, state);
  }

  /** A settled actor gives the desktop back, and anything it still held. */
  async #releaseDesktopActor(conversationId: string, actor: string): Promise<void> {
    await observeOperation("mcp", "computer.release", async () => {
      await this.#computerRpc(conversationId, { action: "release_actor", actor });
    }, { agentInstanceId: actor }, conversationId).catch(() => undefined);
  }

  /** A correction is coming: the task's remaining steps stop and it looks again. Never starts the server. */
  async #checkpointDesktopActor(conversationId: string, actor: string): Promise<void> {
    await observeOperation("mcp", "computer.checkpoint", async () => {
      const record = createObservationWriter();
      const answer = await this.#computerRpc(conversationId, { action: "checkpoint", actor });
      record({ name: "computer.checkpoint.result", phase: "progress", attributes: { stage: isRecord(answer) && answer["held"] === true ? "fenced" : answer === undefined ? "not_running" : "not_owner" } });
    }, { agentInstanceId: actor }, conversationId).catch(() => undefined);
  }

  async #computerRpc(conversationId: string, input: Record<string, unknown>, start = false): Promise<unknown> {
    const record = this.#registry.get(COMPUTER_SERVER_ID);
    if (record?.provenance !== "system") return undefined;
    if (!start && this.#supervisor.status(record.id)?.state !== "ready") return undefined;
    const connection = await this.#supervisor.ensure(record);
    return connection.request("studio/computer", { input, _meta: { "studio/conversation": conversationId } });
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
      _meta: { "studio/conversation": conversationId, "studio/human-stop": true },
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
   * A declined path is not asked twice in the same turn. The record lives
   * here, beside the access logs, because it is conversation-scoped runtime
   * state rather than a durable row - the next run clears it.
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
    return this.#conversations.get(conversationId)?.permissionMode ?? "ask";
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
  #modelAcceptsImages(conversationId: string, override?: string | null): boolean | undefined {
    const record = this.#conversations.get(conversationId);

    const registry = bootstrappedModelRegistry();
    if (registry === undefined) return undefined;

    // The same reference the run initializer builds: the stored choice is in
    // the local runtime's `<provider>/<model>` vocabulary, and an unset choice
    // is the stable alias, which resolves to whatever the alias targets.
    const reference = {
      source: "local",
      provider: DEFAULT_MODEL_PROVIDER,
      model: override ?? record?.modelId ?? DEFAULT_MODEL_NAME,
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
    // A folder the person declined was declined for the turn that asked. This
    // runs once per run - the person's next message - so the slate is clean
    // when they say "try again", and still full for the rest of the turn
    // that heard no (`ScopeDeclines`).
    this.#declines.clearConversation(options.conversationId);
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
      // No project, so `projectId` is the key of this conversation's own
      // folder; said out loud, so the kernel does not store an "always"
      // that means "this conversation" under a name that promises more.
      ...(conversationProject === undefined && options.projectId === undefined ? { standalone: true } : {}),
    };
    // Read where the policy is built. A conversation with no project reads the
    // machine-wide rows only; a filed conversation reads both. The level lives
    // on the project: trusted removes containment for that project's
    // conversations, and contained is what an untouched project still gets.
    const scopeProject = conversationProject ?? (options.projectId === undefined ? undefined : projectId);
    const roots = this.#scopes.resolveRoots(scopeProject, options.conversationId);
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
        // The library, readable by every conversation and written by none:
        // a kept file is found by its tool and then read or edited by its
        // path, and the harness alone files anything there.
        ...(this.#library === undefined ? [] : [this.#library.directory]),
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
      //
      // The PATH is the process's own, as the person's environment set it.
      // It used to be rebuilt from the disk - toolchain directories appended,
      // a JDK's shim replaced, the Visual Studio environment reconstructed -
      // because a contained child could not read the registry or follow a
      // shim, and because the snapshot this process inherited had once been
      // measured missing a Python the machine had. The first reason went
      // with the Windows container (ADR 0057). The second is a fact about how
      // the harness was started, and the fix for it is starting it from an
      // environment that has the toolchain, not a second PATH resolver that
      // guesses where installers put things.
      environment: {
        ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
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
    // The mode a default `ask` resolves under, per acting agent. The
    // conversation's calls ride `mode()` — the person's own choice for the
    // conversation. A delegate's calls ride its definition's `mode` (the
    // contract's "the delegate's own consent default"); the roster's
    // delegates say `inherit`, so Auto reaches the agents a conversation
    // delegated to. Whatever does ask still arrives under the delegate's own
    // agent id, so answering it grants the delegate, not the conversation
    // (S5.1), and the policy rules that ask even in Auto ask here too. Read per ask rather
    // than per submission: the same kernel decides the parent's and the
    // child's calls, and the frame is current whenever a decision is being
    // made. `requiresUndo` above deliberately stays on the conversation's
    // mode — the undo guarantee is the conversation's, and a delegate write
    // approved inside an Auto conversation still gets its restore point.
    const postureMode = (): ExecutionMode => {
      const acting = actingAgentPolicy(
        currentExecutionContext()?.flueSubagentName,
        agentRegistry,
      );
      return acting.mode === undefined || acting.mode === "inherit" ? mode() : acting.mode;
    };
    // Per project, and only per project. The undo history is one shadow
    // repository per workspace root — `SnapshotStore` derives its `gitDir` from
    // that root and nothing else — so the state in front of it has to share the
    // same unit or it is describing a resource it does not match. Keying this
    // by conversation as well is #72/#83/#84/#85; see the field's comment.
    //
    // `required` reads the mode through the same per-conversation closure,
    // which keeps Auto's undo guarantee tied to the conversation that
    // asked for it. Today every conversation's workspace root is its own
    // (`agents/studio.ts` passes the conversation's directory and nothing
    // overrides `projectId`), so one entry here is one conversation's; if a
    // shared project root ever makes the map's key wider than a conversation,
    // `required` moves with the caller, because the guarantee is per write,
    // not per store.
    let snapshots = this.#turnSnapshots.get(projectId);
    if (snapshots === undefined) {
      snapshots = new TurnSnapshots({
        store: this.#snapshotStore(projectId, projectRoot),
        required: () => requiresUndo(mode()),
        reporter,
      });
      this.#turnSnapshots.set(projectId, snapshots);
    }
    const gate = new CallGate({
      kernel: new PermissionKernel({
        grants: this.#grants,
        ...(this.#approver === undefined ? {} : { approver: this.#approver }),
        posture: posture({ mode: postureMode, trust: this.#trust }),
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
      acceptsImages: (conversationId) => this.#modelAcceptsImages(conversationId, options.voiceOnly ? this.voiceModel() : undefined),
      accessLog: this.#accessLogFor(options.conversationId),
      jobs: this.#jobs,
      // The generations join the jobs tool's listing and its Stop: a
      // conversation's background work, one tool. Present exactly when the
      // generation tools are, since both come from the one mediaJobs option.
      ...(this.#mediaJobs === undefined ? {} : { mediaJobs: this.#mediaJobs }),
      ...(this.#library === undefined ? {} : { library: this.#library }),
      ...(this.#media === undefined
        ? {}
        : {
            media: {
              media: this.#media,
              acceptsImages: (conversationId) => this.#modelAcceptsImages(conversationId),
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
        loaded: () => [...registeredMcp.values()],
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
              // The folder question writes the same rows the Settings page
              // does and remembers a no beside the access logs, so both are
              // the runtime's and not the run's.
              folders: {
                scopes: this.#scopes,
                declines: this.#declines,
                projectOf: (conversationId) => this.#conversationProject(conversationId),
              },
            },
          }),
      ...(planStore === undefined
        ? {}
        : {
            plan: {
              // The writer is the agent acting when the tool runs, read
              // from the same frame every other per-agent decision reads:
              // the conversation's writes record as `model`, a delegate's
              // as `agent:<name>` (S5.2) — so a plan row says which kind of
              // writer touched it and which agent, and the person's ticks
              // stay distinguishable from every writer above them. The
              // person's tick path is the HTTP route, which names itself.
              merge: (conversationId, items) => {
                const acting = actingAgentPolicy(
                  currentExecutionContext()?.flueSubagentName,
                  agentRegistry,
                );
                return planStore.merge(
                  conversationId,
                  items,
                  acting.subagentName === undefined
                    ? "model"
                    : (`agent:${acting.subagentName}` as const),
                );
              },
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

      // Voice has no discover tool. Offer its bounded computer surface while
      // sharing without adopting schemas into the typed conversation's set.
      // Calls still pass through the same gate and server-side sharing check.
      if (options.voiceOnly && this.#screenSharing.has(options.conversationId)) {
        for (const record of active) {
          if (record.id !== COMPUTER_SERVER_ID || record.provenance !== "system") continue;
          for (const tool of this.#catalog.tools([record.id])) {
            if (voiceToolOffered(tool.descriptor.id.namespace, tool.descriptor.id.name, true)) registerMcpTool(tool);
          }
        }
      }

      // Outside the shared voice surface, MCP stays withheld. ADR 0048 §3 first said
      // system-provenance servers load eagerly; ADR 0049 §5 corrected that,
      // because it conflated **who owns a capability** with **how expensive it
      // is to load**. A Studio-owned browser is still twenty-four schemas, and
      // ownership does not make a schema cheap. The rule that replaced it:
      // eager loading is for capabilities small enough and general enough that
      // most turns might use them - which means the natives, registered above.
      // Outside voice's shared-screen tools, everything reached over MCP is
      // discovered, whoever wrote it.
      //
      // Every MCP tool below is here because this conversation asked for it.
      // A tool already registered keeps its place, since withholding applies at
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
        // Who is acting, answered per assembly: a delegate's session asks
        // with `subagentName` on its execution-context frame (the Flue
        // patch's one delegation hunk), the parent's assemblies ask with
        // nothing. Resolved here — at the top of every assembly, parent
        // and child alike — because the Stage 0 measurement showed this
        // callback runs five to six times per two-turn submission and each
        // call re-answers for one session against the same shared
        // environment. The conversation agent's answer is the unchanged
        // full list (it composes its own surface); a delegate's answer is
        // its definition's allowlist ∩ what the gate holds, `discover`
        // withheld by name (D4: adoption would write into the parent's
        // conversation-keyed set — the two-writer bug ADR 0029 exists to
        // prevent).
        const acting = actingAgentPolicy(
          currentExecutionContext()?.flueSubagentName,
          agentRegistry,
        );
        const names = new Set<string>();
        return gate.list().flatMap((descriptor) => {
          // The voice role's surface stays intentional (ADR 0059): conversation
          // images through `read`, and the short computer list only while the
          // person shares the screen. Everything else is a task's.
          if (options.voiceOnly && !voiceToolOffered(descriptor.id.namespace, descriptor.id.name, this.#screenSharing.has(options.conversationId))) return [];
          // The per-acting-agent filter, applied before the name-conflict
          // check so a hidden tool never claims its name in this assembly.
          // Visibility is authority's mirror, not authority itself: what
          // survives here is still decided by the kernel at call time,
          // under the delegate's own scope.
          if (!visibleToAgent(descriptor, acting)) return [];
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
              if (options.voiceOnly && descriptor.id.namespace === "native") {
                voiceImagePath(input, [attachmentsRoot, artifactsRoot]);
              }
              // Who is acting, answered again at call time rather than read
              // from the assembly: the assembly's answer named the session
              // this tool was offered to, and the call's frame is the one
              // the kernel's decision should ride on. Same resolution, one
              // moment later — the frame carries `subagentName` for a
              // delegate's calls, nothing for the conversation's own.
              const caller = actingAgentPolicy(
                currentExecutionContext()?.flueSubagentName,
                agentRegistry,
              );
              // The delegate's scope: the conversation's captured scope with
              // the agentId substituted to the acting delegate. The
              // substitution is what makes ADR 0038's grant isolation real
              // for delegates (#49) — the kernel and the grant store match
              // on the scope they are handed, so a standing grant given to
              // `studio` does not match a call from `explore`, and a grant
              // given to `explore` does not reach `studio`.
              const callScope = scopeForActingAgent(scope, caller);
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
              // The effects ceiling, checked before the kernel consults
              // anything: a delegate's call may only earn effects its
              // definition allows, and a violation is a refusal the model
              // can read rather than a tool that silently does nothing.
              // This is the second layer of the three-layer read-only
              // agreement (allowlist kept the tool out of the delegate's
              // array; this refuses it if it somehow gets called; the
              // sandbox holds the boundary either way). Read-only is the
              // Stage 3 delegate's whole permission story, and this is
              // where it is enforced regardless of what any grant says.
              if (!effectsWithinCeiling(descriptor, caller)) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `${descriptor.title} did not run: the ${caller.subagentName} agent is read-only, and this tool can change or run things. Give the work to the conversation instead.`,
                    },
                  ],
                  details: {
                    isError: true,
                    ceiling: [...(caller.maxEffects ?? [])],
                    effects: [...descriptor.effects],
                    agent: caller.subagentName,
                  },
                  isError: true,
                };
              }
              try {
                const result = await gate.call({
                  name: capabilityKey(descriptor.id),
                  input,
                  scope: callScope,
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
    // Before the work below, so a settlement arriving during the drain
    // writes a row but announces nothing to a runtime already going quiet.
    this.#taskProjector.stop();
    this.#unsubscribeDesktop?.();
    this.#unsubscribeDesktop = undefined;
    // Before the supervisor, because these are the children nothing else
    // knows about: a dev server the model started still holding port 3000
    // after Studio has closed is a process the person never started and
    // cannot see to end.
    await this.#jobs.stopAll();
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
