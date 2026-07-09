/**
 * Manages all MCP server state: list, running-status, install/uninstall,
 * enable/disable, start/stop, and the add-custom-server form.
 */
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mcpService, type McpServer } from "@/core/mcpRegistry/registryClient";
import { environmentService } from "@/core/platform/environmentService";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { AddFormState } from "../types";

// Server names from the old hand-built integration system (pre-Composio).
// Any matching record gets silently removed on first load.
const LEGACY_SERVER_NAMES = new Set([
  "notion", "coingecko", "coin-gecko", "coingeko",
  "youtube", "github", "google", "google-workspace",
  "google_workspace", "googleworkspace",
]);

export interface UseMcpServersReturn {
  // State
  mcpServers:           McpServer[];
  mcpLoading:           boolean;
  mcpError:             string | null;
  setMcpError:          (e: string | null) => void;
  runningServers:       Set<string>;
  addError:             string | null;
  addLoading:           boolean;
  // Derived
  context7Server:           McpServer | undefined;
  context7Running:          boolean;
  customServers:            McpServer[];
  // Handlers
  loadMcpServers:                () => Promise<void>;
  handleMcpToggle:               (name: string, enabled: boolean) => Promise<void>;
  handleMcpStart:                (server: McpServer) => Promise<void>;
  handleMcpStop:                 (name: string) => Promise<void>;
  handleMcpUninstall:            (name: string) => Promise<void>;
  handleMcpInstall:              (form: AddFormState, onSuccess: () => void) => Promise<void>;
  handleContext7Install:         () => Promise<void>;
}

export function useMcpServers(): UseMcpServersReturn {
  const { isAuthenticated } = useAuth();
  const isTauri = environmentService.isTauri();

  const [mcpServers,           setMcpServers]           = useState<McpServer[]>([]);
  const [mcpLoading,           setMcpLoading]           = useState(false);
  const [mcpError,             setMcpError]             = useState<string | null>(null);
  const [runningServers,       setRunningServers]       = useState<Set<string>>(new Set());
  const [addError,             setAddError]             = useState<string | null>(null);
  const [addLoading,           setAddLoading]           = useState(false);

  // ── Load servers (with legacy cleanup) ──────────────────────────────────────
  const loadMcpServers = useCallback(async () => {
    if (!isAuthenticated) return;
    setMcpLoading(true);
    setMcpError(null);
    const result = await mcpService.listServers();
    if (result.success) {
      const legacy = result.servers.filter(s => LEGACY_SERVER_NAMES.has(s.name));
      if (legacy.length > 0) {
        await Promise.all(legacy.map(s => mcpService.uninstallServer(s.name)));
        const fresh = await mcpService.listServers();
        setMcpServers(fresh.success ? fresh.servers : result.servers.filter(s => !LEGACY_SERVER_NAMES.has(s.name)));
      } else {
        setMcpServers(result.servers);
      }
    } else {
      setMcpError(result.error);
    }
    setMcpLoading(false);
  }, [isAuthenticated]);

  useEffect(() => { loadMcpServers(); }, [loadMcpServers]);

  // ── Running servers ────────────────────────────────────────────────────────
  const loadRunningServers = useCallback(async () => {
    if (!isTauri) return;
    try {
      const running = await invoke<string[]>("mcp_list_running");
      setRunningServers(new Set(running));
    } catch { /* non-fatal */ }
  }, [isTauri]);

  useEffect(() => { loadRunningServers(); }, [loadRunningServers]);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    listen<{ name: string; running: boolean }>("mcp-server-status", (event) => {
      const { name, running } = event.payload;
      setRunningServers(prev => {
        const next = new Set(prev);
        if (running) next.add(name); else next.delete(name);
        return next;
      });
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [isTauri]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleMcpToggle = async (name: string, enabled: boolean) => {
    setMcpServers(prev => prev.map(s => s.name === name ? { ...s, enabled } : s));
    const result = await mcpService.updateServer(name, { enabled });
    if (!result.success) {
      setMcpServers(prev => prev.map(s => s.name === name ? { ...s, enabled: !enabled } : s));
      setMcpError(result.error);
    }
  };

  const handleMcpStart = async (server: McpServer) => {
    if (!isTauri) return;
    const cfg = server.config as { command?: string; args?: string[]; env?: Record<string, string> };
    if (!cfg.command && !["studio-harness", "computer-use"].includes(server.name)) {
      setMcpError(`No command configured for '${server.name}'.`);
      return;
    }
    const envVars      = cfg.env ?? {};
    let startCommand = cfg.command ?? "";
    let startArgs    = cfg.args ?? [];

    const LOCAL_MCP_RESOLVE: Record<string, string> = {
      "studio-harness": "mcp_resolve_studio_harness_server_path",
      "computer-use":   "mcp_resolve_computer_use_server_path",
    };

    if (LOCAL_MCP_RESOLVE[server.name]) {
      try {
        const serverPath = await invoke<string>(LOCAL_MCP_RESOLVE[server.name]);
        startCommand = "node"; startArgs = [serverPath];
      } catch (e) { setMcpError(`Cannot locate ${server.name} server: ${e}`); return; }
    }
    try {
      await invoke("mcp_start_server", { name: server.name, command: startCommand, args: startArgs, envVars });
      try {
        const manifest = await invoke<{ tools?: { name: string; description: string; inputSchema?: unknown }[] }>(
          "mcp_get_tools", { server: server.name }
        );
        if (manifest?.tools?.length) await mcpService.syncManifest(server.name, manifest.tools);
      } catch { /* non-fatal */ }
    } catch (e: any) { setMcpError(e?.message ?? String(e)); }
  };

  const handleMcpStop = async (name: string) => {
    if (!isTauri) return;
    try { await invoke("mcp_stop_server", { name }); }
    catch (e: any) { setMcpError(e?.message ?? String(e)); }
  };

  const handleMcpUninstall = async (name: string) => {
    const result = await mcpService.uninstallServer(name);
    if (result.success) setMcpServers(prev => prev.filter(s => s.name !== name));
    else setMcpError(result.error);
  };

  const handleMcpInstall = async (form: AddFormState, onSuccess: () => void) => {
    if (!form.name.trim() || !form.displayName.trim()) {
      setAddError("Identifier and display name are required."); return;
    }
    if (!/^[a-z0-9-]+$/.test(form.name)) {
      setAddError("Identifier: lowercase letters, numbers, and hyphens only."); return;
    }

    if (form.type === "remote") {
      if (!form.endpointUrl.trim()) { setAddError("Endpoint URL is required for remote servers."); return; }
      setAddLoading(true); setAddError(null);
      const config: Record<string, unknown> = {};
      if (form.authToken.trim()) config.authToken = form.authToken.trim();
      const result = await mcpService.installServer({
        name: form.name.trim(), displayName: form.displayName.trim(), type: "remote",
        endpointUrl: form.endpointUrl.trim(), config,
      });
      if (!result.success) { setAddLoading(false); setAddError(result.error); return; }
      const syncResult = await mcpService.syncRemoteManifest(form.name.trim());
      setAddLoading(false);
      await loadMcpServers();
      if (syncResult.success) {
        onSuccess();
      } else {
        setAddError(`Server registered but manifest sync failed: ${syncResult.error}. You can retry sync from the server's menu.`);
      }
      return;
    }

    // Local server
    const env: Record<string, string> = {};
    for (const line of form.envVars.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const config: Record<string, unknown> = {};
    if (form.command.trim()) {
      config.command = form.command.trim();
      config.args = form.args.trim()
        ? (form.args.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map(a => a.replace(/^["']|["']$/g, ""))
        : [];
      if (Object.keys(env).length > 0) config.env = env;
    }
    setAddLoading(true); setAddError(null);
    const result = await mcpService.installServer({ name: form.name.trim(), displayName: form.displayName.trim(), type: "local", config });
    setAddLoading(false);
    if (result.success) { onSuccess(); await loadMcpServers(); }
    else setAddError(result.error);
  };

  // ── Bundled-server installers ──────────────────────────────────────────────
  const handleContext7Install = async () => {
    if (!isAuthenticated) return;
    try {
      const result = await mcpService.installServer({
        name: "context7", displayName: "Context7", type: "local",
        config: { command: "npx", args: ["-y", "@upstash/context7-mcp@latest"] },
      });
      if (result.success) await loadMcpServers(); else setMcpError(result.error);
    } catch (e: any) { setMcpError(`Failed to install Context7: ${e?.message ?? e}`); }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const context7Server          = mcpServers.find(s => s.name === "context7");
  const customServers           = mcpServers.filter(s =>
    !["studio-harness", "computer-use", "context7"].includes(s.name)
  );

  return {
    mcpServers, mcpLoading, mcpError, setMcpError,
    runningServers, addError, addLoading,
    context7Server,
    context7Running:          runningServers.has("context7"),
    customServers,
    loadMcpServers,
    handleMcpToggle, handleMcpStart, handleMcpStop, handleMcpUninstall, handleMcpInstall,
    handleContext7Install,
  };
}
