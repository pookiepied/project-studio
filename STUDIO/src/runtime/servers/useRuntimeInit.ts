import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { environmentService } from "@/services/platform/environmentService";
import { logger } from "@/services/logging/logger";
import { connectionManager } from "@/services/connection";
import { getLocalMcpServer, readLocalMcpPermission, setLocalMcpPermission } from "./catalog";
import {
  grantedServers,
  registerAndStartLocalServers,
  restartServer,
  HEALTH_CHECK_INTERVAL_MS,
  type LocalPermissionGrants,
} from "./lifecycle";

// Back-compat re-exports (canonical home is ./lifecycle.ts).
export { HARNESS_PERMISSION_KEY, COMPUTER_USE_PERMISSION_KEY } from "./lifecycle";
export type { LocalPermissionGrants } from "./lifecycle";

export interface HarnessInitState {
  /** Whether the one-time permission modal should be shown */
  showModal: boolean;
  /** User confirmed grants for whichever MCPs they want enabled */
  handleAllow: (grants: LocalPermissionGrants) => void;
  /** User clicked Not now */
  handleDeny: () => void;
}

/**
 * useRuntimeInit — React wrapper over the Local Runtime lifecycle.
 *
 * Manages local-MCP auto-initialization (Studio Harness + Computer Use):
 * - On first run: shows a permission modal listing both MCPs independently
 * - After permission granted: starts the granted servers on every launch
 * - After permission denied: does nothing (user can enable in Settings)
 *
 * The pure start/stop/health/restart primitives live in ./lifecycle.ts; this
 * hook composes them with mount-once effects + the first-run modal state.
 *
 * Renamed from useHarnessInit. App.tsx imports it via the @/runtime barrel.
 */
export function useRuntimeInit(): HarnessInitState {
  const [showModal, setShowModal] = useState(false);
  const resolveRef = useRef<((grants: LocalPermissionGrants) => void) | null>(null);
  const didInit = useRef(false);
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    if (!environmentService.isTauri()) return;

    const harnessServer = getLocalMcpServer("studio-harness")!;
    const computerUseServer = getLocalMcpServer("computer-use")!;
    const harnessPerm = readLocalMcpPermission(harnessServer);
    const computerUsePerm = readLocalMcpPermission(computerUseServer);

    // If Studio Harness is explicitly denied, do not auto-start or prompt —
    // the user can re-enable individual MCPs in Settings.
    if (harnessPerm === false) return;

    const startWithRecovery = (grants: LocalPermissionGrants) => {
      const servers = grantedServers(grants);
      if (servers.length === 0) return;

      registerAndStartLocalServers(servers).catch((e) =>
        logger.warn("HarnessInit", "Failed to start local MCP servers", e)
      );

      // Health check: every 30s, call mcp_list_running (which prunes dead
      // entries and emits mcp-server-status events) then restart any missing
      // granted servers.
      healthCheckRef.current = setInterval(async () => {
        try {
          const running: string[] = await invoke("mcp_list_running");
          const runningSet = new Set(running);
          for (const srv of servers) {
            if (!runningSet.has(srv.name)) {
              logger.warn("HarnessInit", `${srv.name} not running — attempting auto-restart`);
              connectionManager.emit({ type: "mcp:crashed", timestamp: Date.now(), serverName: srv.name });
              await restartServer(srv);
            }
          }
        } catch (e) {
          logger.warn("HarnessInit", "Health check invoke failed", e);
        }
      }, HEALTH_CHECK_INTERVAL_MS);

      // Also react immediately to crash events emitted by Rust's list_running.
      listen<{ name: string; running: boolean; error?: string }>(
        "mcp-server-status",
        (event) => {
          const { name, running } = event.payload;
          if (!running) {
            connectionManager.emit({ type: "mcp:crashed", timestamp: Date.now(), serverName: name });
            const srv = servers.find((s) => s.name === name);
            if (srv) {
              logger.warn("HarnessInit", `Received crash event for ${name} — restarting`);
              restartServer(srv);
            }
          }
        }
      ).then((unlisten) => {
        unlistenRef.current = unlisten;
      }).catch(() => {});
    };

    if (harnessPerm === true) {
      // Returning user — start the servers they have granted.
      startWithRecovery({
        studioHarness: true,
        computerUse: computerUsePerm === true,
      });
    } else {
      // First time — show the modal and wait for the user's per-MCP choice.
      const waitForDecision = new Promise<LocalPermissionGrants>((resolve) => {
        resolveRef.current = resolve;
      });

      setShowModal(true);

      waitForDecision.then((grants) => {
        setLocalMcpPermission(harnessServer, grants.studioHarness);
        setLocalMcpPermission(computerUseServer, grants.computerUse);
        if (grants.studioHarness || grants.computerUse) {
          startWithRecovery(grants);
        }
      });
    }

    return () => {
      if (healthCheckRef.current) {
        clearInterval(healthCheckRef.current);
        healthCheckRef.current = null;
      }
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const handleAllow = (grants: LocalPermissionGrants) => {
    resolveRef.current?.(grants);
    resolveRef.current = null;
    setShowModal(false);
  };

  const handleDeny = () => {
    resolveRef.current?.({ studioHarness: false, computerUse: false });
    resolveRef.current = null;
    setShowModal(false);
  };

  return { showModal, handleAllow, handleDeny };
}
