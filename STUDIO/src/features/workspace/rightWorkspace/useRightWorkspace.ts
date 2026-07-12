import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectContextLike,
  WorkspaceTab,
  WorkspaceTabCreateOptions,
  WorkspaceTabType,
} from "./types";

interface UseRightWorkspaceOptions {
  projectContext?: ProjectContextLike | null;
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  browserOpen: boolean;
  setBrowserOpen: (open: boolean) => void;
  artifactsOpen: boolean;
  setArtifactsOpen: (open: boolean) => void;
  createBrowserTab?: (initialUrl?: string) => string;
  closeBrowserTab?: (id: string) => void;
}

export function useRightWorkspace({
  projectContext,
  terminalOpen,
  setTerminalOpen,
  browserOpen,
  setBrowserOpen,
  artifactsOpen,
  setArtifactsOpen,
  createBrowserTab,
  closeBrowserTab,
}: UseRightWorkspaceOptions) {
  const [visible, setVisible] = useState(false);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const seq = useRef(0);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs],
  );

  const syncExternalOpen = useCallback((nextTabs: WorkspaceTab[]) => {
    setTerminalOpen(nextTabs.some((tab) => tab.type === "terminal"));
    setBrowserOpen(nextTabs.some((tab) => tab.type === "browser"));
    setArtifactsOpen(nextTabs.some((tab) => tab.type === "artifacts"));
  }, [setArtifactsOpen, setBrowserOpen, setTerminalOpen]);

  const createTab = useCallback((type: WorkspaceTabType, options: WorkspaceTabCreateOptions = {}) => {
    if (type === "side-chat" && options.conversationId) {
      const existing = tabs.find(
        (tab) => tab.type === "side-chat" && "conversationId" in tab.state && tab.state.conversationId === options.conversationId,
      );
      if (existing) {
        setActiveTabId(existing.id);
        return existing.id;
      }
    }

    const id = `workspace-${type}-${++seq.current}`;
    const browserTabId = type === "browser"
      ? options.browserTabId ?? createBrowserTab?.() ?? id
      : undefined;
    const title = options.title
      ?? (type === "review" ? "Review"
        : type === "browser" ? "Browser"
        : type === "terminal" ? "Terminal"
        : type === "files" ? "Files"
        : type === "side-chat" ? "Side chat"
        : "Artifacts");

    const tab: WorkspaceTab = {
      id,
      type,
      title,
      state: type === "review"
        ? {
            rootPath: options.rootPath ?? projectContext?.path ?? null,
            selectedPath: options.selectedPath ?? null,
          }
        : type === "browser"
        ? { browserTabId: browserTabId as string }
        : type === "terminal"
        ? { cwd: options.cwd ?? projectContext?.path ?? null }
        : type === "files"
        ? {
            rootPath: options.rootPath ?? projectContext?.path ?? null,
            selectedPath: options.selectedPath ?? null,
            expandedPaths: options.rootPath ?? projectContext?.path ? [options.rootPath ?? projectContext?.path ?? ""] : [],
          }
        : type === "side-chat"
        ? { conversationId: options.conversationId ?? null }
        : { artifactTabId: options.artifactTabId ?? null },
    };

    setTabs((prev) => {
      const next = [...prev, tab];
      syncExternalOpen(next);
      return next;
    });
    setVisible(true);
    setActiveTabId(id);
    return id;
  }, [createBrowserTab, projectContext?.path, syncExternalOpen, tabs]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const closing = prev.find((tab) => tab.id === id);
      if (closing?.type === "browser" && "browserTabId" in closing.state) {
        closeBrowserTab?.(closing.state.browserTabId);
      }
      const idx = prev.findIndex((tab) => tab.id === id);
      const next = prev.filter((tab) => tab.id !== id);
      syncExternalOpen(next);
      setActiveTabId((current) => {
        if (current !== id) return current;
        return next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null;
      });
      return next;
    });
  }, [closeBrowserTab, syncExternalOpen]);

  const updateTab = useCallback((id: string, patch: Partial<WorkspaceTab>) => {
    setTabs((prev) => prev.map((tab) => tab.id === id ? { ...tab, ...patch } : tab));
  }, []);

  const closeAll = useCallback(() => {
    tabs.forEach((tab) => {
      if (tab.type === "browser" && "browserTabId" in tab.state) {
        closeBrowserTab?.(tab.state.browserTabId);
      }
    });
    setTabs([]);
    setActiveTabId(null);
    setVisible(false);
    setTerminalOpen(false);
    setBrowserOpen(false);
    setArtifactsOpen(false);
  }, [closeBrowserTab, setArtifactsOpen, setBrowserOpen, setTerminalOpen, tabs]);

  const openHome = useCallback(() => {
    setVisible(true);
    if (tabs.length === 0) {
      createTab(projectContext?.path ? "review" : "files", {
        rootPath: projectContext?.path ?? null,
        cwd: projectContext?.path ?? null,
      });
      return;
    }
    setActiveTabId(tabs[0].id);
  }, [createTab, projectContext?.path, tabs]);

  const open = visible || tabs.length > 0 || terminalOpen || browserOpen || artifactsOpen;

  const toggleOpen = useCallback(() => {
    if (open) {
      closeAll();
      return;
    }
    openHome();
  }, [closeAll, open, openHome]);

  const openView = useCallback((type: WorkspaceTabType, options?: WorkspaceTabCreateOptions) => {
    return createTab(type, options);
  }, [createTab]);

  const closeActive = useCallback(() => {
    if (activeTabId) closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  useEffect(() => {
    if (browserOpen && !tabs.some((tab) => tab.type === "browser")) {
      createTab("browser");
    }
  }, [browserOpen, createTab, tabs]);

  useEffect(() => {
    if (terminalOpen && !tabs.some((tab) => tab.type === "terminal")) {
      createTab("terminal");
    }
  }, [createTab, tabs, terminalOpen]);

  useEffect(() => {
    if (artifactsOpen && !tabs.some((tab) => tab.type === "artifacts")) {
      createTab("artifacts");
    }
  }, [artifactsOpen, createTab, tabs]);

  useEffect(() => {
    if (projectContext?.path) return;
    setTabs((prev) => {
      const next = prev.map((tab) => (
        tab.type === "files"
          ? { ...tab, state: { rootPath: null, selectedPath: null, expandedPaths: [] } }
          : tab.type === "review"
          ? { ...tab, state: { rootPath: null, selectedPath: null } }
          : tab
      ));
      return next;
    });
  }, [projectContext?.path]);

  return {
    activeTab,
    activeTabId,
    tabs,
    open,
    openView,
    openHome,
    closeTab,
    closeActive,
    closeAll,
    toggleOpen,
    setActiveTabId,
    updateTab,
  };
}
