import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/core/logging/logger";
import type {
  LocalCapabilitiesSnapshot,
  LocalCapabilityStatus,
} from "./types";

const CACHE_TTL_MS = 60_000;

let cachedSnapshot: LocalCapabilitiesSnapshot | null = null;
let inFlightCheck: Promise<LocalCapabilitiesSnapshot> | null = null;

async function execute(command: string, args: string[]): Promise<string | null> {
  try {
    return await invoke<string>("execute_shell_command", { command, args });
  } catch {
    return null;
  }
}

async function getPlatformOs(): Promise<string> {
  try {
    return await invoke<string>("get_platform_os");
  } catch {
    return "web";
  }
}

function firstNonEmptyLine(value: string | null | undefined): string | undefined {
  return value?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

async function commandExists(command: string): Promise<boolean> {
  // Prefer a real invocation first. On some Windows setups `claude --version`
  // works fine while `where claude` returns nothing, which incorrectly hides
  // the Claude engine from the UI.
  const directVersion = await execute(command, ["--version"]);
  if (firstNonEmptyLine(directVersion)) return true;

  const os = await getPlatformOs();
  const result = os === "windows"
    ? await execute("powershell", [
        "-NoProfile",
        "-Command",
        `Get-Command ${command} | Select-Object -ExpandProperty Source`,
      ])
    : await execute("which", [command]);

  return Boolean(firstNonEmptyLine(result));
}

async function detectClaudeCli(): Promise<LocalCapabilityStatus> {
  const checkedAt = Date.now();
  const installed = await commandExists("claude");

  if (!installed) {
    return {
      id: "claude-cli",
      label: "Claude Code CLI",
      available: false,
      detail: "Claude CLI was not found on PATH.",
      checkedAt,
    };
  }

  const version = firstNonEmptyLine(await execute("claude", ["--version"]));
  return {
    id: "claude-cli",
    label: "Claude Code CLI",
    available: true,
    version,
    checkedAt,
  };
}

export async function checkLocalCapabilities(): Promise<LocalCapabilitiesSnapshot> {
  if (cachedSnapshot && Date.now() - cachedSnapshot.checkedAt < CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  if (inFlightCheck) return inFlightCheck;

  inFlightCheck = checkLocalCapabilitiesUncached().finally(() => {
    inFlightCheck = null;
  });

  cachedSnapshot = await inFlightCheck;
  return cachedSnapshot;
}

async function checkLocalCapabilitiesUncached(): Promise<LocalCapabilitiesSnapshot> {
  const checkedAt = Date.now();

  try {
    const claudeCli = await detectClaudeCli();
    return {
      checkedAt,
      capabilities: {
        "claude-cli": claudeCli,
      },
    };
  } catch (error) {
    logger.warn("LocalCapabilities", "Local capability detection failed", error);
    return {
      checkedAt,
      capabilities: {
        "claude-cli": {
          id: "claude-cli",
          label: "Claude Code CLI",
          available: false,
          detail: "Capability check failed.",
          checkedAt,
        },
      },
    };
  }
}
