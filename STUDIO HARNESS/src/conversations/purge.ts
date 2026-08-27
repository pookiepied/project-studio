import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  conversationDirectory,
  conversationsDirectory,
  studioHome,
} from "../platform/paths.js";
import { StorageError } from "../storage/errors.js";
import type { ConversationStore } from "./store.js";

/**
 * What emptying the archive destroys, and the order it destroys it.
 *
 * The settled behaviour is that permanent destruction is exactly one thing: a
 * person choosing to clear their archive — over a selection or all of it —
 * from Settings. Nothing sweeps, nothing expires, and no migration deletes.
 *
 * The answer this module implements, stated so it can be argued with:
 *
 * - **The index row** is destroyed outright. The conversation stops existing
 *   as far as the product can express existence at all.
 * - **The conversation's own tree** under `~/.studio/data/conversations/<id>/`
 *   — the workspace a projectless turn stood on, its attachments and its
 *   artifacts — is deleted from disk. This data is ours; an archive emptied
 *   while files are still locked by a running turn removes what it can and
 *   reports what it could not, rather than pretending either way.
 * - **The Flue transcript is not touched**, because there is no supported way
 *   to touch it: Flue's adapter contract exposes whole-instance deletion
 *   primitives but "does not promise a public retention or deletion workflow",
 *   and reaching into `flue.db` directly would be one system editing another
 *   system's journal behind its back. Those bytes remain inert and
 *   unreachable — addressed by nothing once these rows are gone, listable by
 *   nothing ever — until Flue ships a supported deletion surface.
 */

export interface PurgeOutcome {
  /** Ids whose index row was destroyed. */
  readonly removed: readonly string[];
  /**
   * Scratch trees that could not be fully removed, with the driver's reason.
   * The index row is gone regardless: recovery-by-keeping-the-row would put
   * half a conversation back into the sidebar under a promise nobody made.
   */
  readonly cleanupFailures: Readonly<Record<string, string>>;
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

export async function purgeConversations(
  store: ConversationStore,
  ids: readonly string[],
): Promise<PurgeOutcome> {
  const removed = store.removeMany(ids);
  const cleanupFailures: Record<string, string> = {};

  for (const id of removed) {
    try {
      await removeTree(id);
    } catch (error) {
      cleanupFailures[id] =
        error instanceof Error ? error.message : "Files could not be removed.";
    }
  }

  return { removed, cleanupFailures };
}
