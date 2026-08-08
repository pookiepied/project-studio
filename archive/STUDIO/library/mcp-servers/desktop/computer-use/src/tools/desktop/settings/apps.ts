import { runPS } from "../ps-helper.js";

export async function listInstalledApps(args: Record<string, unknown>): Promise<unknown> {
  const filter = args.filter as string | undefined;
  const limit  = (args.limit  as number) || 200;
  const where  = filter
    ? `| Where-Object {$_.DisplayName -like '*${filter.replace(/['"]/g, "")}*'}`
    : "";

  return runPS(`
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$apps = Get-ItemProperty $paths -EA SilentlyContinue |
  Where-Object {$_.DisplayName -and $_.DisplayName -ne ''} ${where} |
  Select-Object DisplayName, DisplayVersion, Publisher, InstallDate, EstimatedSize,
    @{N='uninstall_cmd';E={if($_.UninstallString){$_.UninstallString.Substring(0,[Math]::Min($_.UninstallString.Length,120))}else{''}}} |
  Sort-Object DisplayName -Unique |
  Select-Object -First ${limit}
@($apps) | ConvertTo-Json -AsArray
`);
}

export async function getFileAssociation(args: Record<string, unknown>): Promise<unknown> {
  const ext = (args.extension as string || "").replace(/['"]/g, "").replace(/^\.?/, ".");
  if (ext === ".") return { error: "extension is required (e.g. .pdf or pdf)" };

  return runPS(`
try {
  $prog = (Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice" -EA SilentlyContinue).ProgId
  if (-not $prog) {
    $prog = (Get-ItemProperty -Path "HKCR:\\${ext}" -Name '(default)' -EA SilentlyContinue).'(default)'
  }
  $app  = if ($prog) { (Get-ItemProperty -Path "HKCR:\\$prog\\shell\\open\\command" -Name '(default)' -EA SilentlyContinue).'(default)' } else { $null }
  [PSCustomObject]@{ extension="${ext}"; prog_id=$prog; command=$app } | ConvertTo-Json
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function setFileAssociation(args: Record<string, unknown>): Promise<unknown> {
  const ext     = (args.extension as string || "").replace(/['"]/g, "").replace(/^\.?/, ".");
  const program = (args.program   as string || "").replace(/"/g, "'");
  if (ext === "." || !program) return { error: "extension and program path are required" };

  return runPS(`
try {
  # Use cmd /c assoc and ftype for system-wide association (requires elevation for HKCR)
  # For user-level, write to HKCU UserChoice
  $progId  = "ComputerUse.${ext.slice(1)}.1"
  $cmdPath = '"${program}" "%1"'
  if (-not (Test-Path "HKCU:\\Software\\Classes\\$progId")) {
    New-Item -Path "HKCU:\\Software\\Classes\\$progId" -Force | Out-Null
  }
  New-Item         -Path "HKCU:\\Software\\Classes\\$progId\\shell\\open\\command" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\\Software\\Classes\\$progId\\shell\\open\\command" -Name '(default)' -Value $cmdPath
  New-Item         -Path "HKCU:\\Software\\Classes\\${ext}" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\\Software\\Classes\\${ext}" -Name '(default)' -Value $progId
  [PSCustomObject]@{ success=$true; extension="${ext}"; program="${program}"; prog_id=$progId } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function manageStartupApp(args: Record<string, unknown>): Promise<unknown> {
  const action = (args.action as string || "").toLowerCase(); // enable | disable | remove
  const name   = (args.name   as string || "").replace(/['"]/g, "");
  const scope  = (args.scope  as string) || "user"; // user | system
  if (!action || !name) return { error: "action (enable|disable|remove) and name are required" };

  const regPath = scope === "system"
    ? "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"
    : "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
  const approvedPath = scope === "system"
    ? "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run"
    : "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

  if (action === "remove") {
    return runPS(`
try {
  Remove-ItemProperty -Path "${regPath}" -Name "${name}" -EA Stop
  [PSCustomObject]@{ success=$true; action="remove"; name="${name}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
  }

  // Enable/disable via StartupApproved (the modern way that respects Task Manager disable)
  const enabledBytes  = "020000000000000000000000"; // 12-byte: 02 00 00 ... = enabled
  const disabledBytes = "030000000000000000000000"; // 03 = disabled

  const bytes = action === "enable" ? enabledBytes : disabledBytes;
  return runPS(`
try {
  if (-not (Test-Path "${approvedPath}")) { New-Item -Path "${approvedPath}" -Force | Out-Null }
  $data = [byte[]](${bytes.match(/../g)!.map(h => `0x${h}`).join(",")})
  Set-ItemProperty -Path "${approvedPath}" -Name "${name}" -Value $data -Type Binary -EA Stop
  [PSCustomObject]@{ success=$true; action="${action}"; name="${name}"; scope="${scope}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function listStartupApps(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$regPaths = @(
  @{scope='HKCU (User)';    path='HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'},
  @{scope='HKCU (Disabled)';path='HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'},
  @{scope='HKLM (System)';  path='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'},
  @{scope='HKLM (32-bit)';  path='HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'}
)
$entries = $regPaths | ForEach-Object {
  $scope = $_.scope
  try {
    $key = Get-Item -Path $_.path -EA Stop
    $key.GetValueNames() | ForEach-Object {
      [PSCustomObject]@{ scope=$scope; name=$_; command=$key.GetValue($_) }
    }
  } catch {}
}
$tasks = Get-CimInstance Win32_StartupCommand -EA SilentlyContinue |
  Select-Object @{N='scope';E={'Task ('+$_.Location+')'}}, Name, Command, User
@($entries; $tasks) | Where-Object {$_} | ConvertTo-Json -AsArray
`);
}
