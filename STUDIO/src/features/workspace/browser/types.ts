export interface BrowserTab {
  id: string;
  label: string;
  mode: "html" | "web";
  html?: string;
  url?: string;
  history?: string[];
  historyIndex?: number;
  reloadKey?: number;
  zoom?: number;
  deviceToolbar?: boolean;
}
