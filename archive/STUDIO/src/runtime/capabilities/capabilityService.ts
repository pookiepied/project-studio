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

interface CliProbe {
  id: LocalCapabilityStatus["id"];
  command: string;
  label: string;
}

const CLI_PROBES: readonly CliProbe[] = [
  { id: "claude-cli",   command: "claude",   label: "Claude Code CLI" },
  { id: "codex-cli",    command: "codex",    label: "OpenAI Codex CLI" },
  { id: "opencode-cli", command: "opencode", label: "opencode CLI" },
];

async function detectCli(probe: CliProbe): Promise<LocalCapabilityStatus> {
  const checkedAt = Date.now();
  const installed = await commandExists(probe.command);

  if (!installed) {
    return {
      id: probe.id,
      label: probe.label,
      available: false,
      detail: `${probe.command} was not found on PATH.`,
      checkedAt,
    };
  }

  const version = firstNonEmptyLine(await execute(probe.command, ["--version"]));
  return {
    id: probe.id,
    label: probe.label,
    available: true,
    version,
    checkedAt,
  };
}

function unavailable(probe: CliProbe, detail: string): LocalCapabilityStatus {
  return {
    id: probe.id,
    label: probe.label,
    available: false,
    detail,
    checkedAt: Date.now(),
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
    const results = await Promise.all(CLI_PROBES.map(detectCli));
    return {
      checkedAt,
      capabilities: {
        "claude-cli":   results[0],
        "codex-cli":    results[1],
        "opencode-cli": results[2],
      },
    };
  } catch (error) {
    logger.warn("LocalCapabilities", "Local capability detection failed", error);
    return {
      checkedAt,
      capabilities: {
        "claude-cli":   unavailable(CLI_PROBES[0], "Capability check failed."),
        "codex-cli":    unavailable(CLI_PROBES[1], "Capability check failed."),
        "opencode-cli": unavailable(CLI_PROBES[2], "Capability check failed."),
      },
    };
  }
}
