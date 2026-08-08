import React, { useRef } from "react";
import {
  Close,
  Code,
  Document,
  type IconSize,
} from "@/ui/icons";
import type { ArtifactTab } from "@/app/hooks/useArtifactPanel";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { CodeView }     from "./artifact/CodeView";
import { DocumentView } from "./artifact/DocumentView";
import { ResizeHandle } from "@/features/workspace/rightWorkspace/ResizeHandle";

// ---------------------------------------------------------------------------

interface ArtifactPanelProps {
  tabs:          ArtifactTab[];
  activeTabId:   string;
  width:         number;
  onTabChange:   (id: string) => void;
  onTabClose:    (id: string) => void;
  onWidthChange: (w: number) => void;
  onClose:       () => void;
}

// ---------------------------------------------------------------------------

function tabIcon(tab: ArtifactTab, size: IconSize = "xs") {
  switch (tab.type) {
    case "code":     return <Code     size={size} />;
    case "document": return <Document size={size} />;
  }
}

// ---------------------------------------------------------------------------

export function ArtifactPanel({
  tabs, activeTabId,
  width, onTabChange, onTabClose, onWidthChange, onClose,
}: ArtifactPanelProps) {
  const drag = useRef<{ sx: number; sw: number } | null>(null);

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { sx: e.clientX, sw: width };
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      // Cap at half the window so the chat side always keeps >=50%; never exceed
      // 800 or drop below 320.
      const maxW = Math.max(320, Math.min(800, Math.round(window.innerWidth * 0.5)));
      onWidthChange(Math.max(320, Math.min(maxW, drag.current.sw + (drag.current.sx - ev.clientX))));
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  };

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  return (
    <div className="flex h-full transition-colors duration-300" style={{ width, minWidth: width }}>
      {/* Resize handle */}
      <ResizeHandle onMouseDown={onResizeDown} />

      {/* Docked window */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-surface-page transition-colors duration-300">

        {/* Title bar */}
        <div className="flex items-center gap-2 px-3 h-10 flex-shrink-0 bg-surface-page border-b border-surface-border dark:border-surface-border transition-colors duration-300">

          <IconButton
            aria-label="Close panel"
            title="Close panel"
            onClick={onClose}
            className="flex !h-7 !w-7 flex-shrink-0 items-center justify-center rounded-lg !text-disabled transition-colors duration-150 hover:!bg-surface-base hover:!text-secondary dark:!text-secondary dark:hover:!bg-surface-raised dark:hover:!text-disabled"
          >
            <Close size="sm" />
          </IconButton>

          {/* Active tab icon + label */}
          <div className="flex items-center gap-1.5 min-w-0 text-disabled dark:text-secondary">
            {activeTab && tabIcon(activeTab, "xs")}
            <span className="text-xs text-muted dark:text-muted truncate">
              {activeTab?.label ?? "Artifacts"}
            </span>
          </div>

          {/* Tab switcher — only when >1 tab */}
          {tabs.length > 1 && (
            <div className="flex items-center gap-0.5 flex-1 min-w-0 justify-end">
              {tabs.map(tab => {
                const isActive = tab.id === activeTabId;
                return (
                  <Button
                    key={tab.id}
                    variant="ghost"
                    onClick={() => onTabChange(tab.id)}
                    className={`group/tab flex items-center !gap-1 !px-2 !h-6 !rounded !text-2xs flex-shrink-0 transition-colors !duration-100
                      ${isActive
                        ? "!bg-surface-page dark:!bg-surface-raised !text-secondary dark:!text-disabled shadow-sm"
                        : "!text-disabled dark:!text-secondary hover:!text-secondary dark:hover:!text-disabled"
                      }`}
                  >
                    <span className="flex-shrink-0">{tabIcon(tab, "xs")}</span>
                    <span className="truncate max-w-[80px]">{tab.label}</span>
                    <span
                      role="button"
                      onClick={ev => { ev.stopPropagation(); onTabClose(tab.id); }}
                      className="w-3 h-3 flex items-center justify-center rounded ml-0.5 opacity-0 group-hover/tab:opacity-100 transition-opacity duration-100 hover:bg-surface-raised dark:hover:bg-surface-border"
                    >
                      <Close size="xs" />
                    </span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab?.type === "code"     && <CodeView     content={activeTab.content} language={activeTab.language} />}
          {activeTab?.type === "document" && <DocumentView content={activeTab.content} />}
        </div>

      </div>
    </div>
  );
}
