import { useCallback, useEffect, useState } from "react";
import type { ProjectContextLike, RightWorkspaceView } from "./types";

interface UseRightWorkspaceOptions {
  projectContext?: ProjectContextLike | null;
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  browserOpen: boolean;
  setBrowserOpen: (open: boolean) => void;
  artifactsOpen: boolean;
  setArtifactsOpen: (open: boolean) => void;
}

export function useRightWorkspace({
  projectContext,
  terminalOpen,
  setTerminalOpen,
  browserOpen,
  setBrowserOpen,
  artifactsOpen,
  setArtifactsOpen,
}: UseRightWorkspaceOptions) {
  const [activeView, setActiveView] = useState<RightWorkspaceView>("terminal");
  const [homeOpen, setHomeOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [openViews, setOpenViews] = useState<RightWorkspaceView[]>([]);

  const closeAll = useCallback(() => {
    setTerminalOpen(false);
    setBrowserOpen(false);
    setArtifactsOpen(false);
    setHomeOpen(false);
    setLocalOpen(false);
    setOpenViews([]);
  }, [setArtifactsOpen, setBrowserOpen, setTerminalOpen]);

  const openView = useCallback((view: RightWorkspaceView) => {
    setActiveView(view);
    setOpenViews(prev => prev.includes(view) ? prev : [...prev, view]);
    if (view === "terminal") setTerminalOpen(true);
    if (view === "browser") setBrowserOpen(true);
    if (view === "artifacts") setArtifactsOpen(true);
    setHomeOpen(false);
    if (view === "files" || view === "side-chat") setLocalOpen(true);
  }, [setArtifactsOpen, setBrowserOpen, setTerminalOpen]);

  const closeView = useCallback((view: RightWorkspaceView) => {
    if (view === "terminal") setTerminalOpen(false);
    if (view === "browser") setBrowserOpen(false);
    if (view === "artifacts") setArtifactsOpen(false);

    setOpenViews(prev => {
      const next = prev.filter(v => v !== view);
      const hasLocal = next.some(v => v === "files" || v === "side-chat");
      setLocalOpen(hasLocal);
      if (activeView === view) {
        if (next.length > 0) setActiveView(next[next.length - 1]);
        else setHomeOpen(false);
      }
      return next;
    });
  }, [activeView, setArtifactsOpen, setBrowserOpen, setTerminalOpen]);

  const closeActive = useCallback(() => {
    closeView(activeView);
  }, [activeView, closeView]);

  const openHome = useCallback(() => {
    setTerminalOpen(false);
    setBrowserOpen(false);
    setArtifactsOpen(false);
    setLocalOpen(false);
    setOpenViews([]);
    setHomeOpen(true);
  }, [setArtifactsOpen, setBrowserOpen, setTerminalOpen]);

  useEffect(() => {
    if (terminalOpen) {
      setHomeOpen(false);
      setOpenViews(prev => prev.includes("terminal") ? prev : [...prev, "terminal"]);
      setActiveView("terminal");
    }
  }, [terminalOpen]);

  useEffect(() => {
    if (browserOpen) {
      setHomeOpen(false);
      setOpenViews(prev => prev.includes("browser") ? prev : [...prev, "browser"]);
      setActiveView("browser");
    }
  }, [browserOpen]);

  useEffect(() => {
    if (artifactsOpen) {
      setHomeOpen(false);
      setOpenViews(prev => prev.includes("artifacts") ? prev : [...prev, "artifacts"]);
      setActiveView("artifacts");
    }
  }, [artifactsOpen]);

  useEffect(() => {
    if (!projectContext?.path && activeView === "files") {
      closeView("files");
    }
  }, [activeView, closeView, projectContext?.path]);

  const open = homeOpen || openViews.length > 0 || terminalOpen || browserOpen || artifactsOpen || localOpen;

  const toggleOpen = useCallback(() => {
    if (open) {
      closeAll();
      return;
    }
    openHome();
  }, [closeAll, open, openHome]);

  return {
    activeView,
    homeOpen,
    openViews,
    open,
    openView,
    openHome,
    closeView,
    closeActive,
    closeAll,
    toggleOpen,
  };
}
