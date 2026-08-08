import { runPS } from "../ps-helper.js";

export async function manageService(args: Record<string, unknown>): Promise<unknown> {
  const action = (args.action as string) || "status";
  const name   = args.name as string | undefined;

  if (action === "list") {
    return runPS(`
Get-Service |
  Select-Object Name, DisplayName, Status, StartType,
    @{N='can_stop';E={$_.CanStop}},
    @{N='can_pause';E={$_.CanPauseAndContinue}} |
  Sort-Object DisplayName |
  ConvertTo-Json -AsArray
`);
  }

  if (!name) return { error: "Provide a service name, or action: list" };
  const safe = name.replace(/['"]/g, "");

  const cmds: Record<string, string> = {
    status:  `Get-Service -Name "${safe}" | Select-Object Name,DisplayName,Status,StartType,CanStop,CanPauseAndContinue | ConvertTo-Json`,
    start:   `Start-Service   -Name "${safe}" -EA Stop; Get-Service "${safe}" | Select-Object Name,Status | ConvertTo-Json`,
    stop:    `Stop-Service    -Name "${safe}" -Force -EA Stop; Get-Service "${safe}" | Select-Object Name,Status | ConvertTo-Json`,
    restart: `Restart-Service -Name "${safe}" -Force -EA Stop; Get-Service "${safe}" | Select-Object Name,Status | ConvertTo-Json`,
    pause:   `Suspend-Service -Name "${safe}" -EA Stop; Get-Service "${safe}" | Select-Object Name,Status | ConvertTo-Json`,
    resume:  `Resume-Service  -Name "${safe}" -EA Stop; Get-Service "${safe}" | Select-Object Name,Status | ConvertTo-Json`,
  };

  const inner = cmds[action];
  if (!inner) return { error: `Unknown action '${action}'. Use: list, status, start, stop, restart, pause, resume` };

  return runPS(`try { ${inner} } catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }`);
}

export async function setServiceStartup(args: Record<string, unknown>): Promise<unknown> {
  const name    = args.name    as string;
  const startup = args.startup as string;

  if (!name || !startup) return { error: "name and startup are required" };

  const validTypes = ["Automatic", "AutomaticDelayedStart", "Manual", "Disabled", "Boot", "System"];
  const safe       = name.replace(/['"]/g, "");
  const safeType   = startup.replace(/['"]/g, "");

  if (!validTypes.map(v => v.toLowerCase()).includes(safeType.toLowerCase())) {
    return { error: `Invalid startup type. Use: ${validTypes.join(", ")}` };
  }

  return runPS(`
try {
  Set-Service -Name "${safe}" -StartupType ${safeType} -EA Stop
  Get-Service -Name "${safe}" | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json
} catch {
  [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json
}
`);
}
