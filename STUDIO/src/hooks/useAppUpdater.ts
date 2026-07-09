/**
 * useAppUpdater — checks for STUDIO updates on startup (Tauri only).
 *
 * States:
 *   idle        — no update available or not yet checked
 *   checking    — request in flight
 *   available   — new version ready to install
 *   downloading — installer downloading (0–100%)
 *   ready       — download complete, relaunch imminent
 *   error       — something failed (silently handled)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { environmentService } from "../core/platform/environmentService";

export type UpdaterState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string; notes?: string }
  | { status: "downloading"; progress: number }
  | { status: "ready" }
  | { status: "error" };

interface DownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data?: { contentLength?: number; chunkLength?: number };
}

export function useAppUpdater() {
  const [state, setState] = useState<UpdaterState>({ status: "idle" });
  const pendingUpdate = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (!environmentService.isTauri()) return;
    setState({ status: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        pendingUpdate.current = update;
        setState({ status: "available", version: update.version, notes: update.body ?? undefined });
      } else {
        setState({ status: "idle" });
      }
    } catch {
      setState({ status: "idle" });
    }
  }, []);

  const install = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;

    try {
      let downloaded = 0;
      let contentLength = 0;
      setState({ status: "downloading", progress: 0 });

      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data?.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data?.chunkLength ?? 0;
          const pct = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 50;
          setState({ status: "downloading", progress: pct });
        } else if (event.event === "Finished") {
          setState({ status: "ready" });
        }
      });

      // On Windows, downloadAndInstall() spawns the NSIS installer as a separate
      // process and returns immediately — the installer is still running.
      // Calling relaunch() here would start a new instance of the OLD binary
      // before NSIS has replaced the files. Instead, exit(0) so the NSIS
      // installer can finish and relaunch the updated app itself.
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    } catch {
      setState({ status: "error" });
    }
  }, []);

  const dismiss = useCallback(() => {
    pendingUpdate.current = null;
    setState({ status: "idle" });
  }, []);

  useEffect(() => {
    const timer = setTimeout(checkForUpdate, 6000);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return { state, install, dismiss };
}
