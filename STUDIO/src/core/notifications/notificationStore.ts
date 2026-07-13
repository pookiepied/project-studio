/**
 * In-app notification store.
 *
 * A singleton pub/sub (same shape as backgroundSessionTracker) that holds an
 * account-visible history of notifications: currently sub-agent lifecycle
 * (research agent running / done / failed / cancelled). Entries persist to
 * localStorage so they survive an app restart, and a terminal outcome also
 * fires an OS toast (via NotificationService) when the window is unfocused.
 *
 * Fed from ChatProvider via recordAgentToolResult(): the spawn_agent /
 * await_agents tool results already stream in over the chat WebSocket, so no
 * extra backend channel is needed. The TitleBar bell subscribes for the live
 * list + unread badge.
 */

import { NotificationService } from "./notificationService";

export type AgentNotificationStatus = "running" | "done" | "failed" | "cancelled";

export interface AppNotification {
  /** Stable key: the agent's runId, so running to done updates one entry. */
  id:              string;
  kind:            "agent";
  status:          AgentNotificationStatus;
  title:           string;
  body:            string;
  conversationId?: string;
  timestamp:       number;
  read:            boolean;
}

type Listener = (items: AppNotification[]) => void;

const STORAGE_KEY = "studio.notifications.v1";
const MAX_ITEMS   = 50;

function statusLabel(status: AgentNotificationStatus): string {
  switch (status) {
    case "running":   return "started";
    case "done":      return "completed";
    case "failed":    return "failed";
    case "cancelled": return "cancelled";
  }
}

class NotificationStore {
  private items:     AppNotification[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    this.load();
  }

  // Persistence

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppNotification[];
        if (Array.isArray(parsed)) this.items = parsed.slice(0, MAX_ITEMS);
      }
    } catch {
      // Corrupt or unavailable storage; start empty.
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items.slice(0, MAX_ITEMS)));
    } catch {
      // Non-fatal; persistence is best-effort.
    }
  }

  // Mutations

  /** Upsert an agent notification by id. running to done updates one entry. */
  upsertAgent(n: {
    id:              string;
    status:          AgentNotificationStatus;
    title:           string;
    body:            string;
    conversationId?: string;
  }): void {
    const now      = Date.now();
    const existing = this.items.find((i) => i.id === n.id);

    // Immutable updates: a fresh array reference each change so
    // useSyncExternalStore detects it (and stays stable between changes).
    let next: AppNotification[];
    if (existing) {
      const updated: AppNotification = {
        ...existing,
        status:         n.status,
        body:           n.body || existing.body,
        timestamp:      now,
        conversationId: n.conversationId ?? existing.conversationId,
        // A terminal transition re-surfaces the entry as unread.
        read:           n.status === "running" ? existing.read : false,
      };
      next = [updated, ...this.items.filter((i) => i.id !== n.id)];
    } else {
      next = [
        {
          id:             n.id,
          kind:           "agent",
          status:         n.status,
          title:          n.title,
          body:           n.body,
          conversationId: n.conversationId,
          timestamp:      now,
          read:           false,
        },
        ...this.items,
      ];
    }

    this.items = next.slice(0, MAX_ITEMS);
    this.persist();
    this.notify();

    // Alert on terminal outcomes only, and only when the window is unfocused.
    if (n.status !== "running") {
      void this.maybeToast(n.status, n.title, n.body);
    }
  }

  markAllRead(): void {
    if (!this.items.some((i) => !i.read)) return;
    this.items = this.items.map((i) => (i.read ? i : { ...i, read: true }));
    this.persist();
    this.notify();
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items = [];
    this.persist();
    this.notify();
  }

  // Reads

  /**
   * Stable snapshot for useSyncExternalStore: the SAME array reference is
   * returned until a mutation replaces it, so React does not loop.
   */
  getSnapshot(): AppNotification[] {
    return this.items;
  }

  unreadCount(): number {
    return this.items.reduce((n, i) => (i.read ? n : n + 1), 0);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Internals

  private notify(): void {
    for (const l of this.listeners) l(this.items);
  }

  private async maybeToast(status: AgentNotificationStatus, title: string, body: string): Promise<void> {
    try {
      let unfocused = true;
      if ("__TAURI_INTERNALS__" in window) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unfocused = !(await getCurrentWindow().isFocused());
      } else if (typeof document !== "undefined") {
        unfocused = document.visibilityState !== "visible";
      }
      if (!unfocused) return;

      await NotificationService.requestPermission();
      const summary = body ? ` - ${body.slice(0, 80)}` : "";
      await NotificationService.showNative("STUDIO", `${title} ${statusLabel(status)}${summary}`, {
        tag: `agent-${Date.now()}`,
      });
    } catch {
      // OS toast is best-effort.
    }
  }
}

export const notificationStore = new NotificationStore();

// ---------------------------------------------------------------------------
// Adapter: turn spawn_agent / await_agents tool results into notifications.
// Kept here (not inline in ChatProvider) so the parsing lives with the store.
// ---------------------------------------------------------------------------

interface AwaitOutcome {
  agent_id?: string;
  status?:   string;   // "completed" | "failed" | "cancelled" | "running" | ...
  summary?:  string;
  content?:  string;
  error?:    string;
}

function titleFor(agentType: unknown): string {
  const t = typeof agentType === "string" ? agentType : "";
  if (t === "research") return "Research agent";
  return t ? `${t[0]!.toUpperCase()}${t.slice(1)} agent` : "Sub-agent";
}

/** Map an await_agents outcome status onto our notification status. */
function mapOutcome(status: string | undefined): AgentNotificationStatus {
  if (status === "completed") return "done";
  if (status === "failed")    return "failed";
  if (status === "cancelled") return "cancelled";
  return "running";
}

/**
 * Feed the store from a completed spawn_agent / await_agents tool call.
 * Safe to call with any result shape; unrecognized shapes are ignored.
 */
export function recordAgentToolResult(
  tool:           string,
  result:         unknown,
  conversationId: string | undefined,
): void {
  if (!result || typeof result !== "object") return;
  const r = result as Record<string, unknown>;

  if (tool === "spawn_agent") {
    const id = typeof r.agent_id === "string" ? r.agent_id : undefined;
    if (!id) return;
    notificationStore.upsertAgent({
      id,
      status:         "running",
      title:          titleFor(r.agent_type),
      body:           typeof r.description === "string" ? r.description : "Working…",
      conversationId,
    });
    return;
  }

  if (tool === "await_agents") {
    const agents = Array.isArray(r.agents) ? (r.agents as AwaitOutcome[]) : [];
    for (const a of agents) {
      if (!a.agent_id) continue;
      const status = mapOutcome(a.status);
      const body =
        status === "failed"    ? (a.error ?? "Agent failed.")
      : status === "cancelled" ? "Cancelled."
      : (a.summary ?? a.content ?? "Completed.");
      notificationStore.upsertAgent({
        id:     a.agent_id,
        status,
        title:  "Research agent",
        body:   typeof body === "string" ? body.slice(0, 160) : "Completed.",
        conversationId,
      });
    }
  }
}
