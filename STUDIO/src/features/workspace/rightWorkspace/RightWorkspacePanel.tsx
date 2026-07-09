import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { setRightPanelWidth } from "@/app/shell/workspaceLayoutStore";
import { ArtifactPanel } from "@/features/artifacts";
import { BrowserPanel } from "../browser/BrowserPanel";
import type { BrowserTab } from "../browser/BrowserPanel";
import { TerminalPanel } from "../terminal/TerminalPanel";
import type { ArtifactTab } from "@/app/hooks/useArtifactPanel";
import { WorkspaceHomePanel } from "./WorkspaceHomePanel";
import { WorkspacePlaceholderPanel } from "./WorkspacePlaceholderPanel";
import { SideChatPanel } from "./SideChatPanel";
import type { ProjectContextLike, RightWorkspaceView } from "./types";

interface RightWorkspacePanelProps {
  open: boolean;
  homeOpen: boolean;
  openViews: RightWorkspaceView[];
  activeView: RightWorkspaceView;
  onClose: () => void;
  onCloseView: (view: RightWorkspaceView) => void;
  onOpenView: (view: RightWorkspaceView) => void;
  projectContext?: ProjectContextLike | null;
  onTerminalWidthChange: (width: number) => void;
  browserTabs: BrowserTab[];
  activeBrowserTabId: string;
  onBrowserTabChange: (id: string) => void;
  onBrowserTabClose: (id: string) => void;
  onBrowserNewTab: () => void;
  onBrowserNavigate: (id: string, url: string) => void;
  onBrowserHistory: (id: string, delta: number) => void;
  onBrowserReload: (id: string) => void;
  onBrowserZoom: (id: string, zoom: number) => void;
  onBrowserToggleDeviceToolbar: (id: string) => void;
  onBrowserClearData: () => void;
  onBrowserWidthChange: (width: number) => void;
  artifactTabs: ArtifactTab[];
  activeArtifactTabId: string;
  onArtifactTabChange: (id: string) => void;
  onArtifactTabClose: (id: string) => void;
  onArtifactWidthChange: (width: number) => void;
}

export function RightWorkspacePanel({
  open,
  homeOpen,
  openViews,
  activeView,
  onClose,
  onCloseView,
  onOpenView,
  projectContext,
  onTerminalWidthChange,
  browserTabs,
  activeBrowserTabId,
  onBrowserTabChange,
  onBrowserTabClose,
  onBrowserNewTab,
  onBrowserNavigate,
  onBrowserHistory,
  onBrowserReload,
  onBrowserZoom,
  onBrowserToggleDeviceToolbar,
  onBrowserClearData,
  onBrowserWidthChange,
  artifactTabs,
  activeArtifactTabId,
  onArtifactTabChange,
  onArtifactTabClose,
  onArtifactWidthChange,
}: RightWorkspacePanelProps) {
  const [workspaceWidth, setWorkspaceWidth] = useState(400);

  // Publish the panel's footprint so the top-center dock can recenter over the
  // chat area and collapse when crowded. 0 while closed.
  useEffect(() => {
    setRightPanelWidth(open ? workspaceWidth : 0);
  }, [open, workspaceWidth]);
  useEffect(() => () => setRightPanelWidth(0), []);

  const setTerminalWorkspaceWidth = (width: number) => {
    setWorkspaceWidth(width);
    onTerminalWidthChange(width);
  };

  const setBrowserWorkspaceWidth = (width: number) => {
    setWorkspaceWidth(width);
    onBrowserWidthChange(width);
  };

  const setArtifactWorkspaceWidth = (width: number) => {
    setWorkspaceWidth(width);
    onArtifactWidthChange(width);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="right-workspace"
          initial={{ opacity: 0, x: 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 48 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="h-full flex-shrink-0 overflow-hidden"
        >
          {homeOpen && (
            <WorkspaceHomePanel
              width={workspaceWidth}
              onWidthChange={setWorkspaceWidth}
              onClose={onClose}
              onOpenView={onOpenView}
            />
          )}

          {!homeOpen && openViews.includes("terminal") && (
            <div className={activeView === "terminal" ? "block h-full" : "hidden h-full"}>
              <TerminalPanel
                width={workspaceWidth}
                onWidthChange={setTerminalWorkspaceWidth}
                onClose={() => onCloseView("terminal")}
                projectCwd={projectContext?.path ?? null}
              />
            </div>
          )}

          {!homeOpen && openViews.includes("browser") && (
            <div className={activeView === "browser" ? "block h-full" : "hidden h-full"}>
              <BrowserPanel
                tabs={browserTabs}
                activeTabId={activeBrowserTabId}
                onTabChange={onBrowserTabChange}
                onTabClose={onBrowserTabClose}
                onNewTab={onBrowserNewTab}
                onNavigate={onBrowserNavigate}
                onHistory={onBrowserHistory}
                onReload={onBrowserReload}
                onZoom={onBrowserZoom}
                onToggleDeviceToolbar={onBrowserToggleDeviceToolbar}
                onClearBrowsingData={onBrowserClearData}
                onOpenWorkspaceView={onOpenView}
                visible={activeView === "browser"}
                width={workspaceWidth}
                onWidthChange={setBrowserWorkspaceWidth}
                onClose={() => onCloseView("browser")}
              />
            </div>
          )}

          {!homeOpen && openViews.includes("artifacts") && (
            <div className={activeView === "artifacts" ? "block h-full" : "hidden h-full"}>
              <ArtifactPanel
                tabs={artifactTabs}
                activeTabId={activeArtifactTabId}
                width={workspaceWidth}
                onTabChange={onArtifactTabChange}
                onTabClose={onArtifactTabClose}
                onWidthChange={setArtifactWorkspaceWidth}
                onClose={() => onCloseView("artifacts")}
              />
            </div>
          )}

          {!homeOpen && openViews.includes("side-chat") && (
            <div className={activeView === "side-chat" ? "block h-full" : "hidden h-full"}>
              <SideChatPanel
                width={workspaceWidth}
                onWidthChange={setWorkspaceWidth}
                onClose={() => onCloseView("side-chat")}
              />
            </div>
          )}

          {!homeOpen && openViews.includes("files") && (
            <div className={activeView === "files" ? "block h-full" : "hidden h-full"}>
              <WorkspacePlaceholderPanel
                view="files"
                width={workspaceWidth}
                onWidthChange={setWorkspaceWidth}
                onClose={() => onCloseView("files")}
              />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
