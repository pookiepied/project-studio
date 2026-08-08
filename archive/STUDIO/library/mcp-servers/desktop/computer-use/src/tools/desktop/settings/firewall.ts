import { runPS } from "../ps-helper.js";

export async function getFirewallStatus(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction | ConvertTo-Json -AsArray
`);
}

export async function listFirewallRules(args: Record<string, unknown>): Promise<unknown> {
  const direction = args.direction as string | undefined; // Inbound | Outbound
  const enabled   = args.enabled   as boolean | undefined;
  const nameFilter= args.name_filter as string | undefined;
  const limit     = (args.limit    as number) || 100;

  const dirFilter  = direction  ? `-Direction ${direction.replace(/['"]/g, "")}` : "";
  const enabFilter = enabled != null ? `-Enabled ${enabled ? "True" : "False"}` : "";
  const nameArg    = nameFilter ? `-DisplayName "*${nameFilter.replace(/['"]/g, "")}*"` : "";

  return runPS(`
Get-NetFirewallRule ${dirFilter} ${enabFilter} ${nameArg} -EA SilentlyContinue |
  Select-Object Name, DisplayName, Direction, Action, Protocol, Enabled, Profile, Description |
  Select-Object -First ${limit} |
  ConvertTo-Json -AsArray
`);
}

export async function addFirewallRule(args: Record<string, unknown>): Promise<unknown> {
  const name      = (args.name      as string || "").replace(/['"]/g, "");
  const direction = (args.direction as string) || "Inbound";
  const action    = (args.action    as string) || "Allow";
  const protocol  = (args.protocol  as string) || "TCP";
  const port      = args.port      as number | undefined;
  const program   = args.program   as string | undefined;

  if (!name) return { error: "name is required" };

  const portArg    = port    ? `-LocalPort ${port} -Protocol ${protocol}` : `-Protocol ${protocol}`;
  const programArg = program ? `-Program "${(program as string).replace(/"/g, "'")}"` : "";

  return runPS(`
try {
  New-NetFirewallRule -DisplayName "${name}" -Direction ${direction} -Action ${action} ${portArg} ${programArg} -EA Stop | Out-Null
  [PSCustomObject]@{ success=$true; name="${name}"; direction='${direction}'; action='${action}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function removeFirewallRule(args: Record<string, unknown>): Promise<unknown> {
  const name = (args.name as string || "").replace(/['"]/g, "");
  if (!name) return { error: "name is required" };

  return runPS(`
try {
  Remove-NetFirewallRule -DisplayName "${name}" -EA Stop
  [PSCustomObject]@{ success=$true; removed="${name}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
