import { cpSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";

import { isSettledTaskStatus } from "../contracts/agents.js";
import type { ConversationRecord } from "../contracts/conversations.js";
import type { ExtensionSelectionStore } from "../extend/selection.js";
import type { PermissionGrantStore } from "../permissions/grant-store.js";
import type { PlanItemStore } from "../plan/plan-items.js";
import {
  conversationAttachmentsDirectory,
  conversationDirectory,
  conversationsDirectory,
  ensureDirectory,
  studioHome,
} from "../platform/paths.js";
import type { SandboxScopeStore } from "../sandbox/scope-store.js";
import { StorageError } from "../storage/errors.js";
import {
  copyFlueJournalForConversation,
  type FlueJournalCopyResult,
} from "../storage/flue-journal-copy.js";
import { hasActiveFlueSubmissions } from "../storage/flue-journal-delete.js";
import type { TaskStore } from "../agents/definitions/task-store.js";
import type { ConversationDocumentStore } from "./documents.js";
import type { ConversationStore } from "./store.js";

/**
 * A true fork: a new, independent conversation duplicated from a source.
 *
 * The previous mechanism rendered the source transcript to text and sent it
 * as another conversation's first message. That carried the words and
 * nothing else: no files, no scoped decisions, and - the defect that ended
 * it - two ids minted for one fork, so right-clicking Fork created two
 * conversations (the seed turn admitted under an id the client threw away,
 * and the sidebar row pointing at an id the harness had never heard of).
 *
 * A fork here is one id, minted once by the caller, duplicated server-side:
 *
 * - **The index row**, with the source's project, model, reasoning and
 *   permission mode, titled `<source> (Fork)` and manual from birth.
 * - **The transcript**, duplicated in Flue's journal under the new id:
 *   every stream of the source across all agent names, with batches,
 *   chunks and attachments byte-identical and only the stream identity
 *   renamed. The fork opens on the same words, the same tool runs, the
 *   same images - and nothing runs: no turn is admitted, no model is
 *   called. Continuing the fork appends to the fork alone.
 * - **The scoped rows**: permission grants, extension decisions, plan items,
 *   folder grants and document rows, plus the measured context figure.
 *   Pending questions and background tasks stay with the source - a
 *   question is live state for a run, and a task's stream belongs to the
 *   conversation that dispatched it.
 * - **The conversation tree**: `workspace`, `scratch`, `attachments` and
 *   `artifacts` copied under the new id. `trash` is not carried: it holds
 *   files the person already deleted. A project conversation's repository
 *   is never copied - only the directories the conversation owns.
 *
 * The journal copy deliberately skips fold checkpoints and submissions
 * (see `storage/flue-journal-copy.ts`): checkpoints are a cache the fork's
 * first history read rebuilds by replay, and submissions are write-time
 * coordination history never joins. With `upToSubmissionId` the copy is a
 * branch instead of a whole: each stream carrying that submission is cut
 * after its last batch, so "branch from here" opens where the named answer
 * ended rather than where the conversation did.
 *
 * Ordering mirrors the purge's reasoning in reverse: the index row is
 * written first, so a crash mid-fork leaves a visible empty conversation
 * the person can delete, never invisible scoped rows keyed to an id nothing
 * addresses. Every later step is deletable through the ordinary purge.
 *
 * A fork is refused while the source has a turn in flight or a background
 * task running, for the same reason a delete is: copying state a run is
 * still writing copies a moving target.
 */

export interface ForkDependencies {
  /** The index of conversations that exist, and the one owner of its rows. */
  readonly conversations: ConversationStore;
  /** The one owner of `permission_grant`. */
  readonly grants: PermissionGrantStore;
  /** The one owner of `extension_scope`. */
  readonly selection: ExtensionSelectionStore;
  /** The one owner of `plan_item`. */
  readonly plans: PlanItemStore;
  /** The one owner of `sandbox_scope`, for the folders granted to this conversation alone. */
  readonly folders: SandboxScopeStore;
  /** The one owner of `conversation_document`; the files travel with the tree. */
  readonly documents: ConversationDocumentStore;
  /** The task index, read for the running-task refusal only. Tasks stay with the source. */
  readonly tasks: TaskStore;
  /**
   * The measured context figure, carried to the fork so its meter reads
   * what the source's read. Optional: a composition with no usage tracker
   * forks without it, and the fork measures itself on its next turn.
   */
  readonly usage?: {
    duplicate?(sourceId: string, targetId: string): void;
  };
  /**
   * The journal file checked for a turn in flight. Resolved per call from
   * the same rule Flue itself follows when unset, so tests point it at a
   * fixture.
   */
  readonly flueJournalPath: string;
}

export interface ForkResult {
  /** The forked conversation's index row. */
  readonly conversation: ConversationRecord;
  /** The journal rows duplicated under the new id. */
  readonly journal: FlueJournalCopyResult;
}

/** The fork's title: what it is, and where it came from. */
export function forkTitle(sourceTitle: string | null): string {
  const named = sourceTitle?.trim();
  return `${named === undefined || named === "" ? "Untitled" : named} (Fork)`;
}

/**
 * Asserts that a conversation tree stays inside the Studio home.
 *
 * The id validation in `platform/paths.ts` already refuses separators and
 * traversal, but this call drives a recursive copy, and a copy path that
 * verified only once is one refactor away from verifying never.
 */
function assertTreeInsideHome(conversationId: string): string {
  const directory = conversationDirectory(conversationId);
  const resolved = resolve(directory);
  const root = resolve(conversationsDirectory());
  const home = resolve(studioHome());
  const difference = relative(root, resolved);
  if (
    !resolved.startsWith(home) ||
    difference === "" ||
    difference.startsWith("..")
  ) {
    throw new StorageError("invalid", {
      message: "A conversation tree can only be addressed from within the Studio home.",
    });
  }
  return resolved;
}

/** The conversation-owned subdirectories that travel to a fork. */
const CARRIED_DIRECTORIES = ["workspace", "scratch", "attachments", "artifacts"] as const;

function copyTree(sourceId: string, targetId: string): void {
  const sourceRoot = assertTreeInsideHome(sourceId);
  const targetRoot = assertTreeInsideHome(targetId);
  if (!existsSync(sourceRoot)) return;
  ensureDirectory(targetRoot);
  for (const name of CARRIED_DIRECTORIES) {
    const from = resolve(sourceRoot, name);
    if (!existsSync(from)) continue;
    cpSync(from, resolve(targetRoot, name), { recursive: true });
  }
}

/**
 * Duplicates a conversation under a caller-chosen id.
 *
 * The id arrives minted (the client's `newId`), so one fork is one id
 * everywhere: the row, the journal copy, the scoped copies and the tree all
 * address the same conversation. An id that already exists is a conflict,
 * never a second row. With `options.upToSubmissionId` the fork is a branch:
 * the transcript is cut after that submission's last batch instead of
 * copied whole.
 */
export function forkConversation(
  dependencies: ForkDependencies,
  sourceId: string,
  targetId: string,
  options: { readonly upToSubmissionId?: string } = {},
): ForkResult {
  const { conversations, grants, selection, plans, folders, documents, tasks, usage, flueJournalPath } =
    dependencies;

  // Both ids name trees before anything is read: a traversal never reaches
  // the index, the journal check, or the filesystem.
  assertTreeInsideHome(sourceId);
  assertTreeInsideHome(targetId);

  const source = conversations.get(sourceId);
  if (source === undefined) {
    throw new StorageError("not_found", {
      message: `No conversation "${sourceId}".`,
    });
  }
  if (conversations.get(targetId) !== undefined) {
    throw new StorageError("conflict", {
      message: `Conversation "${targetId}" already exists.`,
    });
  }

  const runningTask = tasks
    .list({ parentConversationId: sourceId })
    .find((record) => !isSettledTaskStatus(record.status));
  if (runningTask !== undefined) {
    throw new StorageError("conflict", {
      message:
        `Conversation "${sourceId}" has a background task still running ` +
        `("${runningTask.title}"), so it cannot be forked. ` +
        "Try again once it has settled.",
    });
  }
  if (hasActiveFlueSubmissions(flueJournalPath, sourceId)) {
    throw new StorageError("conflict", {
      message:
        `Conversation "${sourceId}" has a turn in flight, so it cannot be ` +
        "forked. Stop the turn first and try again.",
    });
  }

  const now = Date.now();
  const conversation = conversations.insertForked({
    id: targetId,
    title: forkTitle(source.title),
    projectId: source.projectId,
    modelId: source.modelId,
    reasoningLevel: source.reasoningLevel,
    permissionMode: source.permissionMode,
    createdAt: now,
  });

  copyTree(sourceId, targetId);
  const journal = copyFlueJournalForConversation(
    flueJournalPath,
    sourceId,
    targetId,
    options.upToSubmissionId === undefined
      ? {}
      : { upToSubmissionId: options.upToSubmissionId },
  );
  grants.duplicateConversation(sourceId, targetId);
  selection.duplicateConversation(sourceId, targetId);
  plans.duplicateConversation(sourceId, targetId);
  folders.duplicateConversation(sourceId, targetId);
  documents.duplicateConversation(
    sourceId,
    targetId,
    ensureDirectory(conversationAttachmentsDirectory(targetId)),
  );
  usage?.duplicate?.(sourceId, targetId);

  return { conversation, journal };
}
