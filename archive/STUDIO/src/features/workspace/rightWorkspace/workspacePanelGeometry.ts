export const WORKSPACE_PANEL_DEFAULT_WIDTH = 360;
export const WORKSPACE_PANEL_MIN_WIDTH = 360;
export const WORKSPACE_PANEL_MIN_CHAT_WIDTH = 380;

export function getWorkspacePanelMaxWidth(): number {
  return Math.max(
    WORKSPACE_PANEL_MIN_WIDTH,
    window.innerWidth - WORKSPACE_PANEL_MIN_CHAT_WIDTH,
  );
}

export function clampWorkspacePanelWidth(width: number): number {
  const max = getWorkspacePanelMaxWidth();
  return Math.max(
    Math.min(WORKSPACE_PANEL_MIN_WIDTH, max),
    Math.min(max, Math.round(width)),
  );
}
