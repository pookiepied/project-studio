import { useState, useRef, useCallback, useMemo } from "react";
import type { ArtifactPanelContextValue } from "../contexts/ArtifactPanelContext";

// Tab types. Activity tab removed; Summary panel owns tool activity now.

interface CodeArtifactTab {
  id:       string;
  type:     "code";
  label:    string;
  content:  string;
  language: string;
}

interface DocumentArtifactTab {
  id:      string;
  type:    "document";
  label:   string;
  content: string;
}

export type ArtifactTab = CodeArtifactTab | DocumentArtifactTab;

export function useArtifactPanel() {
  const [open,        setOpen]        = useState(false);
  const [tabs,        setTabs]        = useState<ArtifactTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [width,       setWidth]       = useState(400);
  const tabSeq = useRef(0);

  const openCode = useCallback((content: string, language: string, label: string) => {
    const id = `code-${++tabSeq.current}`;
    setTabs(prev => [...prev, { id, type: "code" as const, label, content, language }]);
    setActiveTabId(id);
    setOpen(true);
  }, []);

  const openDocument = useCallback((content: string, label: string) => {
    const id = `doc-${++tabSeq.current}`;
    setTabs(prev => [...prev, { id, type: "document" as const, label, content }]);
    setActiveTabId(id);
    setOpen(true);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const idx  = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        setOpen(false);
        setActiveTabId("");
      } else {
        setActiveTabId(cur =>
          cur === id ? (next[Math.max(0, idx - 1)]?.id ?? next[0].id) : cur
        );
      }
      return next;
    });
  }, []);

  const contextValue = useMemo<ArtifactPanelContextValue>(
    () => ({ openCode, openDocument }),
    [openCode, openDocument]
  );

  return { open, setOpen, tabs, activeTabId, setActiveTabId, width, setWidth, closeTab, contextValue };
}
