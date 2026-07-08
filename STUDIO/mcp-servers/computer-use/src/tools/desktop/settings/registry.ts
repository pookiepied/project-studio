import { runPS } from "../ps-helper.js";

export async function getRegistryValue(args: Record<string, unknown>): Promise<unknown> {
  const keyPath = (args.key_path as string || "").replace(/"/g, "");
  const name    = args.name as string | undefined;
  if (!keyPath) return { error: "key_path is required (e.g. HKCU:\\Software\\MyApp)" };

  const prop = name ? `-Name "${name.replace(/"/g, "")}"` : "";
  return runPS(`
try {
  $v = Get-ItemProperty -Path "${keyPath}" ${prop} -EA Stop
  $v | Select-Object * -ExcludeProperty PSPath,PSParentPath,PSChildName,PSDrive,PSProvider | ConvertTo-Json -Depth 3
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function setRegistryValue(args: Record<string, unknown>): Promise<unknown> {
  const keyPath = (args.key_path as string || "").replace(/"/g, "");
  const name    = (args.name     as string || "").replace(/"/g, "");
  const value   = args.value;
  const type    = (args.type as string) || "String";
  const valid   = ["String","DWord","QWord","Binary","MultiString","ExpandString"];

  if (!keyPath || !name || value === undefined || value === null) return { error: "key_path, name, and value are required" };
  if (!valid.includes(type)) return { error: `Invalid type. Use: ${valid.join(", ")}` };

  // Convert to string safely — value may be a number (e.g., DWord 0)
  const safeVal = String(value).replace(/'/g, "''");
  return runPS(`
try {
  if (-not (Test-Path "${keyPath}")) { New-Item -Path "${keyPath}" -Force | Out-Null }
  Set-ItemProperty -Path "${keyPath}" -Name "${name}" -Value '${safeVal}' -Type ${type} -EA Stop
  [PSCustomObject]@{ success=$true; key_path="${keyPath}"; name="${name}"; type="${type}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function listRegistryKeys(args: Record<string, unknown>): Promise<unknown> {
  const keyPath = (args.key_path as string || "").replace(/"/g, "");
  if (!keyPath) return { error: "key_path is required" };

  return runPS(`
try {
  $item = Get-Item -Path "${keyPath}" -EA Stop
  $subkeys = $item.GetSubKeyNames()
  $values  = $item.GetValueNames() | ForEach-Object {
    [PSCustomObject]@{ name=$_; type=$item.GetValueKind($_).ToString(); value=$item.GetValue($_) }
  }
  [PSCustomObject]@{ path="${keyPath}"; subkeys=@($subkeys); values=@($values) } | ConvertTo-Json -Depth 3
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function deleteRegistryKey(args: Record<string, unknown>): Promise<unknown> {
  const keyPath   = (args.key_path  as string || "").replace(/"/g, "");
  const recursive = (args.recursive as boolean) !== false;
  if (!keyPath) return { error: "key_path is required" };

  return runPS(`
try {
  Remove-Item -Path "${keyPath}" ${recursive ? "-Recurse" : ""} -EA Stop
  [PSCustomObject]@{ success=$true; deleted="${keyPath}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function deleteRegistryValue(args: Record<string, unknown>): Promise<unknown> {
  const keyPath = (args.key_path as string || "").replace(/"/g, "");
  const name    = (args.name     as string || "").replace(/"/g, "");
  if (!keyPath || !name) return { error: "key_path and name are required" };

  return runPS(`
try {
  Remove-ItemProperty -Path "${keyPath}" -Name "${name}" -EA Stop
  [PSCustomObject]@{ success=$true } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
