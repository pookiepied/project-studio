import { useState, useRef, useEffect } from "react";

export const SUMMARY_PANEL_WIDTH = 280;

interface UseSummaryPanelResult {
  summaryPanelOpen: boolean;
  summaryPanelWidth: number;
  setSummaryPanelOpen: (open: boolean) => void;
}

export function useSummaryPanel(sessionTaskCount: number): UseSummaryPanelResult {
  const [summaryPanelOpen, setSummaryPanelOpen] = useState(false);
  const hasAutoOpenedPanel = useRef(false);

  useEffect(() => {
    if (sessionTaskCount > 0 && !hasAutoOpenedPanel.current) {
      hasAutoOpenedPanel.current = true;
      setSummaryPanelOpen(true);
    }
  }, [sessionTaskCount]);

  useEffect(() => {
    const handler = () => setSummaryPanelOpen(true);
    window.addEventListener("open-summary-panel", handler);
    return () => window.removeEventListener("open-summary-panel", handler);
  }, []);

  return { summaryPanelOpen, summaryPanelWidth: SUMMARY_PANEL_WIDTH, setSummaryPanelOpen };
}
