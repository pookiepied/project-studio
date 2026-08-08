/**
 * Detects curated external project apps once per Studio session.
 *
 * The launcher uses a persistent last-known snapshot for instant paint, then
 * validates it with a fresh batch scan while the desktop app is running.
 */

import { PROJECT_APPS, PROJECT_APPS_REGISTRY_VERSION } from "./projectApps";
import { psArray, psString, runPowerShell } from "./projectAppsShell";

const STORAGE_KEY = "studio.projectApps.available.v2";

interface CachedProjectApps {
  version: number;
  ids: string[];
}

let detection: Promise<Set<string>> | null = null;

function knownAppIds(): Set<string> {
  return new Set(PROJECT_APPS.map((app) => app.id));
}

function normalizeIds(ids: unknown): Set<string> | null {
  if (typeof ids === "string") ids = [ids];
  if (!Array.isArray(ids)) return null;
  const known = knownAppIds();
  return new Set(ids.filter((id): id is string => typeof id === "string" && known.has(id)));
}

function buildDetectionScript(): string {
  const appEntries = PROJECT_APPS.map((app) => {
    const alwaysAvailable = app.id === "explorer" ? "$true" : "$false";
    return `
  [pscustomobject]@{
    Id = ${psString(app.id)}
    AlwaysAvailable = ${alwaysAvailable}
    Commands = ${psArray(app.commands)}
    Paths = ${psArray(app.windowsPaths)}
  }`;
  }).join(",");

  return `
$apps = @(${appEntries}
)
$available = New-Object System.Collections.Generic.List[string]
foreach ($app in $apps) {
  if ($app.AlwaysAvailable) {
    $available.Add($app.Id)
    continue
  }

  $found = $false
  foreach ($path in $app.Paths) {
    $expandedPath = $ExecutionContext.InvokeCommand.ExpandString($path)
    if (Resolve-Path -Path $expandedPath -ErrorAction SilentlyContinue | Select-Object -First 1) {
      $found = $true
      break
    }
  }

  if (-not $found) {
    foreach ($command in $app.Commands) {
      if (Get-Command $command -ErrorAction SilentlyContinue) {
        $found = $true
        break
      }
    }
  }

  if ($found) { $available.Add($app.Id) }
}
$available | ConvertTo-Json -Compress
`;
}

export function getCachedProjectAppsSync(): Set<string> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedProjectApps;
    if (parsed.version !== PROJECT_APPS_REGISTRY_VERSION) return null;
    return normalizeIds(parsed.ids);
  } catch {
    return null;
  }
}

async function detect(isTauri: boolean): Promise<Set<string>> {
  if (!isTauri) return new Set();

  try {
    const output = await runPowerShell(buildDetectionScript());
    const ids = normalizeIds(JSON.parse(output));
    const available = ids ?? new Set<string>();

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: PROJECT_APPS_REGISTRY_VERSION, ids: [...available] }),
      );
    } catch {
      /* ignore storage failures */
    }

    return available;
  } catch {
    return getCachedProjectAppsSync() ?? new Set(["explorer"]);
  }
}

export function getAvailableProjectApps(isTauri: boolean): Promise<Set<string>> {
  if (!detection) detection = detect(isTauri);
  return detection;
}
