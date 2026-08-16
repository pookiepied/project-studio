import { invoke } from "@tauri-apps/api/core";
import { HarnessError } from "./errors";

export interface HarnessEndpoint {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly token: string;
  readonly clientId: string;
  readonly sessionId: string;
  readonly pid: number;
}

let cached: HarnessEndpoint | null = null;
let inflight: Promise<HarnessEndpoint> | null = null;

/**
 * Returns the current Harness endpoint. In Tauri, this asks the Rust Host
 * supervisor via `get_harness_endpoint` (which spawns if needed). Outside Tauri
 * (vite preview, tests) it falls back to localhost:3000 with an optional
 * VITE_HARNESS_TOKEN.
 *
 * The result is cached for the process lifetime; call `invalidateEndpoint()`
 * after a restart to force a fresh lookup.
 */
export async function getHarnessEndpoint(): Promise<HarnessEndpoint> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    // Try Tauri Host first
    try {
      const raw = await invoke<RawTauriEndpoint>("get_harness_endpoint");
      const ep = normalizeTauriEndpoint(raw);
      cached = ep;
      return ep;
    } catch (tauriError) {
      // Not in Tauri or Host not ready — try dev fallback
      const fallback = devFallback();
      if (fallback) {
        cached = fallback;
        return fallback;
      }
      throw new HarnessError("not_connected", "Harness is not available.", { cause: tauriError });
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function invalidateEndpoint(): void {
  cached = null;
  inflight = null;
}

interface RawTauriEndpoint {
  host: string;
  port: number;
  url: string;
  token: string;
  clientId: string;
  sessionId: string;
  pid: number;
}

function normalizeTauriEndpoint(raw: RawTauriEndpoint): HarnessEndpoint {
  if (!raw.url || !raw.token) throw new HarnessError("internal", "Harness endpoint missing token.");
  if (raw.host !== "127.0.0.1") throw new HarnessError("internal", "Harness must be loopback.");
  return {
    host: raw.host,
    port: raw.port,
    url: raw.url,
    token: raw.token,
    clientId: raw.clientId,
    sessionId: raw.sessionId,
    pid: raw.pid,
  };
}

function devFallback(): HarnessEndpoint | null {
  // Vite dev without Tauri — allow direct Harness at 127.0.0.1:3000
  const url = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_HARNESS_URL ?? "http://127.0.0.1:3000";
  const token = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_HARNESS_TOKEN;
  // Only use fallback if explicitly configured, otherwise the Tauri error is the real signal
  if (!token) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port) || 3000,
      url: url.replace(/\/$/, ""),
      token,
      clientId: "dev",
      sessionId: "dev",
      pid: 0,
    };
  } catch {
    return null;
  }
}
