/**
 * backgroundSessionTracker — maps background conversation statuses for the UI.
 *
 * Subscribes to wsPool real-time status events so no polling is needed.
 * Only tracks conversations that are running in the background (handlers
 * are detached). When the user is actively viewing a conversation, its
 * status is not shown in the sidebar.
 *
 * Status lifecycle:
 *   streaming        → AI is generating a response
 *   permission_needed → AI paused waiting for a local tool approval
 *   done_unread      → response complete, user hasn't returned yet
 *   error            → something went wrong
 *
 * Statuses are cleared when the user navigates back (acknowledge()).
 */

import { wsPool } from "@/runtime";
import type { NotificationService as NS } from "@/core/notifications/notificationService";

export type ConversationSessionStatus =
  | "streaming"
  | "permission_needed"
  | "done_unread"
  | "error";

type StatusListener = (statuses: Map<string, ConversationSessionStatus>) => void;
export type CompletionCallback = (convId: string, title: string) => void;
export type PermissionCallback = (convId: string, title: string) => void;

// Subset of PoolConnectionStatus values we surface in the UI
const SURFACED: Record<string, ConversationSessionStatus> = {
  streaming:         "streaming",
  permission_needed: "permission_needed",
  done_unread:       "done_unread",
  error:             "error",
};

class BackgroundSessionTracker {
  private statuses  = new Map<string, ConversationSessionStatus>();
  private titles    = new Map<string, string>();
  private listeners = new Set<StatusListener>();
  private onDone?:       CompletionCallback;
  private onPermission?: PermissionCallback;

  constructor() {
    // Subscribe to wsPool status events — no polling needed
    wsPool.subscribe((convId, poolStatus) => {
      const mapped = SURFACED[poolStatus];
      if (!mapped) {
        // idle / connecting / closed → remove from visible statuses
        if (this.statuses.has(convId)) {
          this.statuses.delete(convId);
          this.notify();
        }
        return;
      }

      const prev = this.statuses.get(convId);
      this.statuses.set(convId, mapped);
      this.notify();

      const title = this.titles.get(convId) ?? "Conversation";

      if (mapped === "done_unread" && prev !== "done_unread") {
        this.onDone?.(convId, title);
      }
      if (mapped === "permission_needed" && prev !== "permission_needed") {
        this.onPermission?.(convId, title);
      }
    });
  }

  /** Register a title so notifications can name the conversation. */
  setTitle(convId: string, title: string): void {
    this.titles.set(convId, title);
  }

  /** Called when the user navigates back to a conversation — clears its badge. */
  acknowledge(convId: string): void {
    if (this.statuses.has(convId)) {
      this.statuses.delete(convId);
      this.notify();
    }
  }

  getStatuses(): Map<string, ConversationSessionStatus> {
    return new Map(this.statuses);
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setCompletionCallback(cb: CompletionCallback): void {
    this.onDone = cb;
  }

  setPermissionCallback(cb: PermissionCallback): void {
    this.onPermission = cb;
  }

  private notify(): void {
    const snap = new Map(this.statuses);
    for (const l of this.listeners) l(snap);
  }
}

export const backgroundSessionTracker = new BackgroundSessionTracker();

// Satisfy the type import used in ChatProvider
export type { NS };
