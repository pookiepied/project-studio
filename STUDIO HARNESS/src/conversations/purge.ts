import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { PermissionGrantStore } from "../permissions/grant-store.js";
import { ExtensionSelectionStore } from "../extend/selection.js";
import type { PlanItemStore } from "../plan/plan-items.js";
import type { PendingQuestionStore } from "../questions/pending-questions.js";
import type { SandboxScopeStore } from "../sandbox/scope-store.js";
import type { ConversationDocumentStore } from "./documents.js";
import {
  conversationDirectory,
  conversationsDirectory,
  studioHome,
} from "../platform/paths.js";
import { StorageError } from "../storage/errors.js";
import {
  deleteFlueJournalForConversation,
  hasActiveFlueSubmissions,
} from "../storage/flue-journal-delete.js";
import { openFlueJournal, resolveFlueJournalPath } from "../storage/flue-journal.js";
import type { ConversationStore } from "./store.js";

/**
 * What emptying the archive destroys, and the order it destroys it.
 *
 * The settled behaviour is that permanent destruction is exactly one thing: a
 * person choosing to delete a conversation - over a selection or all of the
 * archive at once - from the sidebar or from Settings. Nothing sweeps,
 * nothing expires, and no migration deletes.
 *
 * The answer this module implements, stated so it can be argued with:
 *
 * - **The journal rows** in Flue's `flue.db` go first: every stream of the
 *   conversation across all agent names, its batches and chunks, its fold
 *   checkpoints, its attachments, and its submissions with their chunks. The
 *   previous version of this file argued for leaving the transcript untouched
 *   because Flue exposes no supported deletion surface, and that was honest
 *   then: reaching into another system's journal behind its back is not
 *   something to do casually. The position changed because "Clear archive"
 *   left every prompt, reply, and tool call on disk while the person who
 *   chose it believed their conversations were gone - bytes nothing in the
 *   product could ever reach again. That is worse than the trespass, so the
 *   trespass is now deliberate and narrow: `storage/flue-journal-delete.ts`
 *   is the only writer, it deletes only rows keyed to the one id, and its
 *   docblock records the decision and the serialization. The old argument is
 *   kept here rather than deleted so the file records that the position
 *   changed and why.
 * - **The conversation-scoped rows** in the application database go next: its
 *   permission grants, its conversation-scoped extension choices, its plan,
 *   and the questions it put to the person. A deleted conversation's grants
 *   stayed live and kept matching, which is a consent outliving the
 *   conversation it was given to; the same argument reaches every table keyed
 *   by a conversation id, so a new one of those belongs in this list rather
 *   than in a comment saying it does not.
 * - **The index row** goes after the content. The row is what makes a
 *   conversation addressable, so a crash between steps leaves a conversation
 *   that can be deleted again, never one that is unreachable. That ordering
 *   is exactly the bug that produced the orphaned trees on disk: the old code
 *   removed the row first, so anything that failed afterwards was
 *   unreachable by design.
 * - **The conversation's own tree** under `~/.studio/data/conversations/<id>/`
 *   goes last and is best-effort: files still locked by a running turn remove
 *   what they can and report what they could not. A tree left behind this way
 *   has no index row and no journal stream, which is precisely the shape the
 *   orphan sweep below recognizes.
 *
 * A conversation with a turn in flight is refused outright: deleting the
 * transcript of a run in progress is the worst case in this file, and the
 * journal is the harness-side truth for it, not the client's `running` set.
 * The refusal carries the code `storage.conflict`, and nothing is destroyed
 * for that id - not the row, not a single journal row.
 */

export interface PurgeDependencies {
  /** The index of conversations that exist, and the one owner of its rows. */
  readonly conversations: ConversationStore;
  /** The one owner of `permission_grant`. */
  readonly grants: PermissionGrantStore;
  /** The one owner of `extension_scope`. */
  readonly selection: ExtensionSelectionStore;
  /** The one owner of `plan_item`. */
  readonly plans: PlanItemStore;
  /** The one owner of `pending_question`. */
  readonly questions: PendingQuestionStore;
  /** The one owner of `sandbox_scope`, for the folders granted to this conversation alone. */
  readonly folders: SandboxScopeStore;
  /** The one owner of `conversation_document`; the files themselves go with the tree. */
  readonly documents: ConversationDocumentStore;
  /**
   * The journal file to delete from. Resolved per call from the same rule
   * Flue itself follows when unset, so tests point it at a fixture.
   */
  readonly flueJournalPath: string;
}

/** What one purge destroyed for one conversation, step by step. */
interface PurgeDetail {
  readonly indexRow: boolean;
  readonly tree: boolean;
  readonly journal: boolean;
  readonly scoped: boolean;
  /** The failure's code when the failure is a classified one. */
  readonly errorCode?: string;
  /** The failure's sentence, verbatim, when this id did not fully purge. */
  readonly error?: string;
}

export interface PurgeOutcome {
  /**
   * Ids that are fully gone: journal, scoped rows, index row, and tree all
   * destroyed. Anything less is not called removed; see `details`.
   */
  readonly removed: readonly string[];
  /**
   * One sentence per id that did not fully purge, keyed by id. A partial
   * failure is legible here instead of being flattened into "removed".
   */
  readonly cleanupFailures: Readonly<Record<string, string>>;
  /** Per id, what was destroyed and what was not. */
  readonly details: Readonly<Record<string, PurgeDetail>>;
}

/**
 * Removes one conversation's tree, refusing to aim anywhere but home.
 *
 * Double-checked rather than trusted: the accessor already constrains the id
 * to a plain segment, but this call drives a recursive delete, and a delete
 * path that verified only once is one refactor away from verifying never.
 */
async function removeTree(conversationId: string): Promise<void> {
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
      message: "A conversation tree can only be removed from within the Studio home.",
    });
  }
  // `force` makes an absent tree a success: a purge of a conversation whose
  // turn created nothing has nothing to remove, which is not a failure.
  await rm(resolved, { recursive: true, force: true });
}

function failureOf(error: unknown): { message: string; code: string | undefined } {
  if (error instanceof StorageError) {
    return { message: error.message, code: error.code };
  }
  return {
    message: error instanceof Error ? error.message : "Files could not be removed.",
    code: undefined,
  };
}

export async function purgeConversations(
  dependencies: PurgeDependencies,
  ids: readonly string[],
): Promise<PurgeOutcome> {
  const { conversations, grants, selection, plans, questions, folders, documents, flueJournalPath } =
    dependencies;
  const removed: string[] = [];
  const cleanupFailures: Record<string, string> = {};
  const details: Record<string, PurgeDetail> = {};

  for (const id of ids) {
    // Unknown ids are ignored, as before: there is no addressable
    // conversation here, and the orphan sweep - not the purge - owns what no
    // index row addresses.
    if (conversations.get(id) === undefined) continue;

    let journal = false;
    let scoped = false;
    let indexRow = false;
    let tree = false;
    let error: string | undefined;
    let errorCode: string | undefined;

    try {
      deleteFlueJournalForConversation(flueJournalPath, id);
      // A submission admitted while the transcript was being deleted would
      // recreate journal rows for a conversation about to lose its index row.
      // Recheck before touching the row: aborting here keeps the row, so the
      // conversation stays deletable and the retry finishes the job.
      if (hasActiveFlueSubmissions(flueJournalPath, id)) {
        throw new StorageError("conflict", {
          message:
            `Conversation "${id}" started a turn while it was being deleted, ` +
            "so the delete was stopped. Try again once the turn has settled.",
        });
      }
      journal = true;
    } catch (unknown) {
      const failure = failureOf(unknown);
      error = failure.message;
      errorCode = failure.code;
    }

    if (error === undefined) {
      try {
        grants.deleteConversation(id);
        selection.clearConversation(id);
        // The plan and the questions are conversation state like the grants:
        // a deleted conversation leaving either behind would let the next
        // conversation to reuse a workflow read a stranger's plan, or leave a
        // question the person was asked standing after the conversation that
        // asked it is gone.
        plans.clearConversation(id);
        questions.clearConversation(id);
        // A folder granted "for this conversation" was granted for exactly as
        // long as the conversation exists.
        folders.clearConversation(id);
        documents.clearConversation(id);
        scoped = true;
      } catch (unknown) {
        const failure = failureOf(unknown);
        error = failure.message;
        errorCode = failure.code;
      }
    }

    // The row goes after the content, never before: a crash up to this point
    // leaves the conversation deletable again, with its address intact.
    if (error === undefined) {
      try {
        const destroyed = conversations.removeMany([id]);
        indexRow = destroyed.includes(id) || conversations.get(id) === undefined;
        if (!indexRow) {
          error = `Conversation "${id}" could not be removed from the index.`;
        }
      } catch (unknown) {
        const failure = failureOf(unknown);
        error = failure.message;
        errorCode = failure.code;
      }
    }

    // Best-effort, as before: the row is already gone, so a tree left behind
    // is the sweep's recognized shape rather than an unreachable journal.
    if (error === undefined) {
      try {
        await removeTree(id);
        tree = true;
      } catch (unknown) {
        const failure = failureOf(unknown);
        error = failure.message;
        errorCode = failure.code;
      }
    }

    if (error === undefined) {
      removed.push(id);
    } else {
      cleanupFailures[id] = error;
    }
    details[id] = {
      indexRow,
      tree,
      journal,
      scoped,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(error === undefined ? {} : { error }),
    };
  }

  return { removed, cleanupFailures, details };
}

/** Trees under the conversations directory that no index row addresses. */
export interface OrphanTreeScan {
  /** Directory names with no index row and no journal stream: safe to remove. */
  readonly orphans: readonly string[];
}

function journalConversationIds(flueJournalPath: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(flueJournalPath)) return ids;
  const journal = openFlueJournal(flueJournalPath);
  try {
    for (const stream of journal.listStreams()) {
      const segments = stream.path.split("/");
      const candidate = segments[2];
      if (segments.length === 3 && segments[0] === "agents" && candidate !== undefined) {
        ids.add(candidate);
      }
    }
  } finally {
    journal.close();
  }
  return ids;
}

/**
 * Lists the conversation trees left behind by earlier partial deletes.
 *
 * A tree is an orphan only when nothing addresses its id: no index row and
 * no journal stream. A tree whose transcript still exists in the journal is
 * kept - the transcript may be the only copy of that conversation left, and
 * guessing otherwise is how reachable history becomes deleted history.
 * Reproduce the state under a throwaway home by removing index rows directly
 * and leaving the trees; never run the sweep against the user's home to
 * prove it works.
 */
export async function listOrphanConversationTrees(
  store: ConversationStore,
  flueJournalPath: string = resolveFlueJournalPath(),
): Promise<OrphanTreeScan> {
  const root = conversationsDirectory();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return { orphans: [] };
  }
  const journaled = journalConversationIds(flueJournalPath);
  const orphans = entries
    .filter((name) => {
      try {
        resolve(conversationDirectory(name));
      } catch {
        return false;
      }
      return store.get(name) === undefined && !journaled.has(name);
    })
    .sort();
  return { orphans };
}

export interface OrphanSweepOutcome {
  /** Directory names whose trees are gone. */
  readonly removed: readonly string[];
  /** One sentence per tree that could not be removed, keyed by name. */
  readonly failures: Readonly<Record<string, string>>;
}

/**
 * Removes the trees `listOrphanConversationTrees` reports, one by one.
 *
 * Always person-invoked, from the Archived pane - nothing in Studio ever
 * deletes on its own, and an orphan sweep on a timer would be the thing that
 * started. A tree whose index row reappeared between the list and the sweep
 * is left alone rather than argued with.
 */
export async function sweepOrphanConversationTrees(
  store: ConversationStore,
  flueJournalPath: string = resolveFlueJournalPath(),
): Promise<OrphanSweepOutcome> {
  const { orphans } = await listOrphanConversationTrees(store, flueJournalPath);
  const removed: string[] = [];
  const failures: Record<string, string> = {};
  for (const name of orphans) {
    if (store.get(name) !== undefined) continue;
    try {
      await removeTree(name);
      removed.push(name);
    } catch (error) {
      failures[name] =
        error instanceof Error ? error.message : "Files could not be removed.";
    }
  }
  return { removed, failures };
}
