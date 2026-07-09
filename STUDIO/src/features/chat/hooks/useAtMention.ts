import { useState, useRef } from "react";
import { mcpService } from "@/core/mcpRegistry/registryClient";
import { listConnections, listComposioApps } from "@/services/ai/composioService";
import type { AppMention } from "@/features/chat/components/ContextAutocomplete";

interface AtMentionState {
  visible:  boolean;
  pos:      { x: number; y: number };
  query:    string;
  start:    number;
}

interface UseAtMentionReturn {
  atMentionVisible:     boolean;
  atMentionPos:         { x: number; y: number };
  atMentionQuery:       string;
  availableApps:        AppMention[];
  /** Call from the textarea onChange handler. Returns the new text value
   *  with the @ portion stripped if an app was just completed, or the
   *  original value if the user is still typing a mention. */
  handleAtMentionInput: (
    value:        string,
    cursorPos:    number,
    inputRef:     React.RefObject<HTMLTextAreaElement | null>
  ) => void;
  handleSelectApp: (app: AppMention, currentValue: string, setInputMessage: (v: string) => void, inputRef: React.RefObject<HTMLTextAreaElement | null>) => void;
  closeAtMention:  () => void;
}

/**
 * Manages the @ app-mention popup that appears when the user types @
 * in the composer textarea.
 *
 * Loads the available apps list lazily (once per typing session).
 */
export function useAtMention(): UseAtMentionReturn {
  const [state, setState] = useState<AtMentionState>({
    visible: false,
    pos:     { x: 0, y: 0 },
    query:   "",
    start:   0,
  });
  const [availableApps, setAvailableApps] = useState<AppMention[]>([]);
  // Guard: only fetch once per mount (re-fetches if component remounts, e.g. page navigation)
  const loadedRef = useRef(false);

  const loadApps = async () => {
    if (loadedRef.current) return;
    loadedRef.current = true; // set eagerly so rapid @ triggers don't double-fetch
    try {
      const [serversResult, connsResult, appsResult] = await Promise.all([
        mcpService.listServers(),
        listConnections().catch(() => ({ items: [] as any[] })),
        listComposioApps().catch(() => ({ items: [] as any[] })),
      ]);
      const apps: AppMention[] = [];

      if (serversResult.success) {
        const descriptions: Record<string, string> = {
          "context7":           "Live, version-accurate library docs",
        };
        for (const srv of serversResult.servers) {
          if (srv.enabled && srv.name !== "studio-harness") {
            apps.push({
              id:          srv.name,
              name:        srv.displayName,
              type:        srv.type === "remote" ? "remote" : "local",
              description: descriptions[srv.name] ?? (srv.type === "remote" ? "Remote MCP server" : "Local MCP server"),
            });
          }
        }
      }

      const composioMap = new Map<string, { logo?: string; description?: string }>(
        ((appsResult as any).items ?? []).map((a: any) => [
          a.appId?.toLowerCase() ?? "",
          { logo: a.logo, description: a.description },
        ])
      );
      for (const conn of (connsResult as any).items ?? []) {
        if (conn.enabled && conn.status === "ACTIVE") {
          const meta = composioMap.get(conn.appName?.toLowerCase() ?? "");
          apps.push({
            id:          conn.appName,
            name:        conn.displayName || conn.appName,
            type:        "composio",
            logo:        meta?.logo,
            description: meta?.description ?? "Connected cloud app",
          });
        }
      }
      setAvailableApps(apps);
    } catch { /* non-fatal */ }
  };

  const handleAtMentionInput = (
    value:     string,
    cursorPos: number,
    inputRef:  React.RefObject<HTMLTextAreaElement | null>
  ) => {
    const before  = value.slice(0, cursorPos);
    const lastAt  = before.lastIndexOf("@");

    if (lastAt !== -1) {
      const charBefore  = before[lastAt - 1];
      const isWordStart = lastAt === 0 || /[\s\n]/.test(charBefore);
      const query       = before.slice(lastAt + 1);

      if (isWordStart && !/\s/.test(query)) {
        const rect = inputRef.current?.getBoundingClientRect();
        if (rect) {
          if (!state.visible) loadApps();
          setState({ visible: true, pos: { x: rect.left + 8, y: rect.top }, query, start: lastAt });
          return;
        }
      }
    }

    if (state.visible) setState(s => ({ ...s, visible: false }));
  };

  const handleSelectApp = (
    app:             AppMention,
    currentValue:    string,
    setInputMessage: (v: string) => void,
    inputRef:        React.RefObject<HTMLTextAreaElement | null>
  ) => {
    const before = currentValue.slice(0, state.start);
    const after  = currentValue.slice(state.start + 1 + state.query.length);
    setInputMessage(before + `@${app.name} ` + after);
    setState(s => ({ ...s, visible: false }));
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const closeAtMention = () => setState(s => ({ ...s, visible: false }));

  return {
    atMentionVisible: state.visible,
    atMentionPos:     state.pos,
    atMentionQuery:   state.query,
    availableApps,
    handleAtMentionInput,
    handleSelectApp,
    closeAtMention,
  };
}
