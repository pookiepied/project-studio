import { runPS } from "../ps-helper.js";

const HOSTS = `"$env:SystemRoot\\System32\\drivers\\etc\\hosts"`;

export async function manageHostsFile(args: Record<string, unknown>): Promise<unknown> {
  const action   = (args.action   as string || "").toLowerCase();
  const ip       = (args.ip       as string | undefined)?.replace(/['"]/g, "");
  const hostname = (args.hostname as string | undefined)?.replace(/['"]/g, "");

  if (!action) return { error: "action is required: read | add | remove" };

  if (action === "read" || action === "list") {
    return runPS(`
try {
  $lines = Get-Content ${HOSTS} -EA Stop
  $entries = @($lines | Where-Object {$_ -notmatch '^\\s*#' -and $_.Trim() -ne ''} | ForEach-Object {
    $p = $_.Trim() -split '\\s+'
    if ($p.Count -ge 2) { [PSCustomObject]@{ ip=$p[0]; hostname=$p[1]; raw=$_ } }
  })
  [PSCustomObject]@{ entries=@($entries); raw=($lines -join "\`n") } | ConvertTo-Json -Depth 3
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
  }

  if (action === "add") {
    if (!ip || !hostname) return { error: "ip and hostname are required for add" };
    return runPS(`
try {
  $path = ${HOSTS}
  $existing = Get-Content $path
  $pattern  = [regex]::Escape("${hostname}")
  if ($existing -match $pattern) {
    [PSCustomObject]@{ success=$false; note="Entry for '${hostname}' already exists" } | ConvertTo-Json
  } else {
    $entry = "${ip}\t${hostname}"
    Add-Content -Path $path -Value $entry -EA Stop
    [PSCustomObject]@{ success=$true; added=$entry } | ConvertTo-Json
  }
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
  }

  if (action === "remove") {
    if (!hostname) return { error: "hostname is required for remove" };
    return runPS(`
try {
  $path    = ${HOSTS}
  $lines   = Get-Content $path
  $pattern = [regex]::Escape("${hostname}")
  $removed = @($lines | Where-Object { $_ -match $pattern })
  $newLines= @($lines | Where-Object { $_ -notmatch $pattern })
  $newLines | Set-Content $path -EA Stop
  [PSCustomObject]@{ success=$true; removed=@($removed) } | ConvertTo-Json -Depth 2
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
  }

  return { error: `Unknown action '${action}'. Use: read, add, remove` };
}
