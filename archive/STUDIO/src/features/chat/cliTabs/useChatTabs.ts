import { useCallback, useEffect, useRef, useState } from "react";
import { getCliTool, type CliToolId } from "./cliTools";
import {
  STUDIO_TAB_ID,
  type ChatTab,
  type ChatTabPersistenceContext,
  type PersistedChatTabs,
} from "./types";

const STUDIO_TAB: ChatTab = { id: STUDIO_TAB_ID, kind: "studio", title: "Studio" };
const STORAGE_PREFIX = "studio.chatTabs.v1:";
let sequence = 0;

function persistenceKey(context: ChatTabPersistenceContext): string | null {
  if (context.scope === "local" && context.projectPath) {
    return `${STORAGE_PREFIX}workspace:${context.projectPath.toLowerCase()}`;
  }
  if (context.conversationId) {
    return `${STORAGE_PREFIX}conversation:${context.scope}:${context.conversationId}`;
  }
  return null;
}

function sanitizeRecord(value: unknown, allowCli: boolean): PersistedChatTabs {
  const record = value && typeof value === "object" ? value as Partial<PersistedChatTabs> : {};
  const restored = Array.isArray(record.tabs)
    ? record.tabs.filter((tab): tab is ChatTab => {
        if (!tab || typeof tab.id !== "string" || typeof tab.title !== "string") return false;
        if (tab.id === STUDIO_TAB_ID && tab.kind === "studio") return true;
        if (!allowCli || tab.kind !== "cli" || !tab.cliId) return false;
        try { getCliTool(tab.cliId); return true; } catch { return false; }
      })
    : [];
  const seen = new Set<string>();
  const taskTabs = restored.filter((tab) => {
    if (tab.id === STUDIO_TAB_ID || seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
  const tabs = [STUDIO_TAB, ...taskTabs];
  const activeId = tabs.some((tab) => tab.id === record.activeId) ? record.activeId! : STUDIO_TAB_ID;
  return { version: 1, tabs, activeId };
}

/** Studio is permanently pinned; local task tabs are restored in user-defined order. */
export function useChatTabs(context: ChatTabPersistenceContext) {
  const [tabs, setTabs] = useState<ChatTab[]>([STUDIO_TAB]);
  const [activeId, setActiveId] = useState<string>(STUDIO_TAB_ID);
  const [activatedIds, setActivatedIds] = useState<Set<string>>(() => new Set([STUDIO_TAB_ID]));
  const hydratedKeyRef = useRef<string | null>(null);
  const skipPersistRef = useRef(true);
  const key = persistenceKey(context);
  const allowCli = context.scope === "local";

  useEffect(() => {
    skipPersistRef.current = true;
    hydratedKeyRef.current = null;
    let cancelled = false;
    setTabs([STUDIO_TAB]);
    setActiveId(STUDIO_TAB_ID);
    setActivatedIds(new Set([STUDIO_TAB_ID]));
    let record = sanitizeRecord(null, allowCli);
    if (key) {
      try { record = sanitizeRecord(JSON.parse(localStorage.getItem(key) || "null"), allowCli); } catch { /* discard invalid state */ }
    }
    const apply = (next: PersistedChatTabs) => {
      if (cancelled) return;
      setTabs(next.tabs);
      setActiveId(next.activeId);
      setActivatedIds(new Set([STUDIO_TAB_ID, next.activeId]));
      hydratedKeyRef.current = key;
    };
    const tauri = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
    if (!allowCli || !key || !tauri) {
      apply(record);
      return () => { cancelled = true; };
    }
    void import("@tauri-apps/plugin-fs").then(async (fs) => {
      const checks = await Promise.all(record.tabs.map(async (tab) => (
        tab.kind !== "cli" || !tab.cwd ? [tab.id, true] as const : [tab.id, await fs.exists(tab.cwd)] as const
      )));
      const invalid = new Set(checks.filter(([, valid]) => !valid).map(([id]) => id));
      const tabs = record.tabs.filter((tab) => !invalid.has(tab.id));
      apply({ ...record, tabs, activeId: invalid.has(record.activeId) ? STUDIO_TAB_ID : record.activeId });
    }).catch(() => apply(record));
    return () => { cancelled = true; };
  }, [allowCli, key]);

  useEffect(() => {
    if (!key || hydratedKeyRef.current !== key) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    const persisted: PersistedChatTabs = { version: 1, tabs, activeId };
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(persisted)); } catch { /* best-effort persistence */ }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeId, key, tabs]);

  const openCli = useCallback((cliId: CliToolId, cwd: string | null = null) => {
    const title = getCliTool(cliId).label;
    const id = `cli-${++sequence}-${Date.now()}`;
    setTabs((previous) => [...previous, { id, kind: "cli", cliId, title, cwd }]);
    setActiveId(id);
    setActivatedIds((previous) => new Set(previous).add(id));
  }, []);

  const closeTab = useCallback((id: string) => {
    if (id === STUDIO_TAB_ID) return;
    setTabs((previous) => previous.filter((tab) => tab.id !== id));
    setActiveId((current) => current === id ? STUDIO_TAB_ID : current);
    setActivatedIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const selectTab = useCallback((id: string) => {
    setActivatedIds((previous) => new Set(previous).add(id));
    setActiveId(id);
  }, []);

  const moveTab = useCallback((dragId: string, targetId: string, edge: "before" | "after" = "before") => {
    if (dragId === STUDIO_TAB_ID || targetId === STUDIO_TAB_ID || dragId === targetId) return;
    setTabs((previous) => {
      const from = previous.findIndex((tab) => tab.id === dragId);
      const to = previous.findIndex((tab) => tab.id === targetId);
      if (from < 1 || to < 1) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      const adjustedTarget = from < to ? to - 1 : to;
      next.splice(adjustedTarget + (edge === "after" ? 1 : 0), 0, moved);
      return next;
    });
  }, []);

  const updateStudioMetadata = useCallback((title: string, workspaceLabel: string) => {
    setTabs((previous) => previous.map((tab) => tab.id === STUDIO_TAB_ID
      ? { ...tab, title: title || "Studio", workspaceLabel }
      : tab));
  }, []);

  return { tabs, activeId, activatedIds, selectTab, openCli, closeTab, moveTab, updateStudioMetadata };
}
