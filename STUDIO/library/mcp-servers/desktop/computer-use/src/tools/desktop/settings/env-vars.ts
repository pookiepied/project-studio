import { runPS } from "../ps-helper.js";

export async function listEnvVars(args: Record<string, unknown>): Promise<unknown> {
  const scope  = (args.scope as string) || "all"; // User | Machine | Process | all
  const filter = args.filter as string | undefined;

  const scopes = scope === "all" ? ["Machine", "User", "Process"] : [scope];

  // Build one line per scope — all collected inside @() so output is captured, not printed as text
  const scopeParts = scopes.map(s =>
    `  [System.Environment]::GetEnvironmentVariables('${s}').GetEnumerator() | ForEach-Object { [PSCustomObject]@{ scope='${s}'; name=$_.Key; value=$_.Value } }`
  ).join("\n");

  const whereFilter = filter
    ? `| Where-Object { $_.name -like '*${filter.replace(/['"]/g, "")}*' -or $_.value -like '*${filter.replace(/['"]/g, "")}*' }`
    : "";

  return runPS(`
$all = @(
${scopeParts}
) | Where-Object {$_} ${whereFilter} | Sort-Object scope,name
@($all) | ConvertTo-Json -AsArray
`);
}

export async function setEnvVar(args: Record<string, unknown>): Promise<unknown> {
  const name  = (args.name  as string || "").replace(/['"]/g, "");
  const value = (args.value as string || "").replace(/'/g, "''");
  const scope = (args.scope as string) || "User"; // User | Machine

  if (!name) return { error: "name is required" };
  if (!["User", "Machine"].includes(scope)) return { error: "scope must be User or Machine" };

  return runPS(`
try {
  [System.Environment]::SetEnvironmentVariable('${name}', '${value}', '${scope}')
  [PSCustomObject]@{ success=$true; name='${name}'; scope='${scope}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function removeEnvVar(args: Record<string, unknown>): Promise<unknown> {
  const name  = (args.name  as string || "").replace(/['"]/g, "");
  const scope = (args.scope as string) || "User";

  if (!name) return { error: "name is required" };

  return runPS(`
try {
  [System.Environment]::SetEnvironmentVariable('${name}', $null, '${scope}')
  [PSCustomObject]@{ success=$true; removed='${name}'; scope='${scope}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
