import { runPS } from "../ps-helper.js";

// Shared P/Invoke type definition
const WIN_API = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWinProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr wp, IntPtr lp2);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
    public delegate bool EnumWinProc(IntPtr h, IntPtr lp);
    public const int SW_MINIMIZE=6; public const int SW_MAXIMIZE=3; public const int SW_RESTORE=9;
    public const uint WM_CLOSE=0x0010; public const uint SWP_NOSIZE=1; public const uint SWP_NOMOVE=2;
}
"@`;

export async function listWindows(args: Record<string, unknown>): Promise<unknown> {
  const filter  = args.filter as string | undefined;
  const limit   = (args.limit as number) || 50;
  const where   = filter ? `| Where-Object {$_.title -like '*${filter.replace(/['"]/g, "")}*'}` : "";

  return runPS(`
${WIN_API}
$wins = [System.Collections.Generic.List[object]]::new()
[WinAPI]::EnumWindows({
  param($h,$lp)
  if ([WinAPI]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder(256)
    $len = [WinAPI]::GetWindowText($h, $sb, 256)
    if ($len -gt 0) {
      $wpid = [uint32]0
      [WinAPI]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
      $rect = New-Object WinAPI+RECT
      [WinAPI]::GetWindowRect($h, [ref]$rect) | Out-Null
      $procName = try {(Get-Process -Id $wpid -EA Stop).Name} catch {'?'}
      $wins.Add([PSCustomObject]@{
        handle = [int64]$h; title=$sb.ToString(); process=$procName; pid=[int]$wpid
        x=$rect.L; y=$rect.T; width=($rect.R-$rect.L); height=($rect.B-$rect.T)
        minimized=[WinAPI]::IsIconic($h); maximized=[WinAPI]::IsZoomed($h)
      }) | Out-Null
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
@($wins ${where} | Select-Object -First ${limit}) | ConvertTo-Json -AsArray
`);
}

function windowTarget(title: string, handle?: number): string {
  if (handle) return `$wins | Where-Object {$_.handle -eq ${handle}} | Select-Object -First 1`;
  return `$wins | Where-Object {$_.title -like '*${title.replace(/['"]/g, "")}*'} | Select-Object -First 1`;
}

export async function focusWindow(args: Record<string, unknown>): Promise<unknown> {
  const title  = (args.title  as string || "").replace(/['"]/g, "");
  const handle = args.handle as number | undefined;
  if (!title && !handle) return { error: "Provide title or handle" };

  const hExpr = handle ? `[IntPtr]${handle}` : `(Get-Process | Where-Object {$_.MainWindowTitle -like '*${title}*' -and $_.MainWindowHandle -ne 0} | Select-Object -First 1).MainWindowHandle`;

  return runPS(`
${WIN_API}
try {
  $h = ${hExpr}
  if (-not $h -or $h -eq [IntPtr]::Zero) { throw "Window not found" }
  [WinAPI]::ShowWindow($h, [WinAPI]::SW_RESTORE) | Out-Null
  Start-Sleep -Milliseconds 100
  [WinAPI]::SetForegroundWindow($h) | Out-Null
  [PSCustomObject]@{ success=$true; handle=[int64]$h } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function closeWindow(args: Record<string, unknown>): Promise<unknown> {
  const title  = (args.title  as string || "").replace(/['"]/g, "");
  const handle = args.handle as number | undefined;
  if (!title && !handle) return { error: "Provide title or handle" };

  const hExpr = handle ? `[IntPtr]${handle}` : `(Get-Process | Where-Object {$_.MainWindowTitle -like '*${title}*' -and $_.MainWindowHandle -ne 0} | Select-Object -First 1).MainWindowHandle`;

  return runPS(`
${WIN_API}
try {
  $h = ${hExpr}
  if (-not $h -or $h -eq [IntPtr]::Zero) { throw "Window not found" }
  [WinAPI]::PostMessage($h, [WinAPI]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  [PSCustomObject]@{ success=$true; action='close_sent' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function showWindow(args: Record<string, unknown>): Promise<unknown> {
  const title  = (args.title  as string || "").replace(/['"]/g, "");
  const handle = args.handle as number | undefined;
  const action = (args.action as string) || "restore"; // minimize | maximize | restore

  if (!title && !handle) return { error: "Provide title or handle" };

  const cmdMap: Record<string, string> = { minimize: "SW_MINIMIZE", maximize: "SW_MAXIMIZE", restore: "SW_RESTORE" };
  const swCmd = cmdMap[action];
  if (!swCmd) return { error: "action must be minimize, maximize, or restore" };

  const hExpr = handle ? `[IntPtr]${handle}` : `(Get-Process | Where-Object {$_.MainWindowTitle -like '*${title}*' -and $_.MainWindowHandle -ne 0} | Select-Object -First 1).MainWindowHandle`;

  return runPS(`
${WIN_API}
try {
  $h = ${hExpr}
  if (-not $h -or $h -eq [IntPtr]::Zero) { throw "Window not found" }
  [WinAPI]::ShowWindow($h, [WinAPI]::${swCmd}) | Out-Null
  [PSCustomObject]@{ success=$true; action='${action}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function moveResizeWindow(args: Record<string, unknown>): Promise<unknown> {
  const title  = (args.title  as string || "").replace(/['"]/g, "");
  const handle = args.handle as number | undefined;
  const x      = args.x as number | undefined;
  const y      = args.y as number | undefined;
  const width  = args.width  as number | undefined;
  const height = args.height as number | undefined;

  if (!title && !handle) return { error: "Provide title or handle" };

  const hExpr  = handle ? `[IntPtr]${handle}` : `(Get-Process | Where-Object {$_.MainWindowTitle -like '*${title}*' -and $_.MainWindowHandle -ne 0} | Select-Object -First 1).MainWindowHandle`;
  const xv     = x      ?? 0;
  const yv     = y      ?? 0;
  const wv     = width  ?? 0;
  const hv     = height ?? 0;
  // Flags: if x/y omitted use SWP_NOMOVE; if w/h omitted use SWP_NOSIZE
  const flags  = ((x == null && y == null) ? 2 : 0) | ((width == null && height == null) ? 1 : 0);

  return runPS(`
${WIN_API}
try {
  $h = ${hExpr}
  if (-not $h -or $h -eq [IntPtr]::Zero) { throw "Window not found" }
  [WinAPI]::SetWindowPos($h, [IntPtr]::Zero, ${xv}, ${yv}, ${wv}, ${hv}, ${flags}) | Out-Null
  [PSCustomObject]@{ success=$true } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function getActiveWindow(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class FgWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@
try {
  $h   = [FgWin]::GetForegroundWindow()
  $tsb = New-Object System.Text.StringBuilder(256)
  [FgWin]::GetWindowText($h, $tsb, 256) | Out-Null
  $csb = New-Object System.Text.StringBuilder(256)
  [FgWin]::GetClassName($h, $csb, 256) | Out-Null
  $wpid = [uint32]0
  [FgWin]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
  $rect = New-Object FgWin+RECT
  [FgWin]::GetWindowRect($h, [ref]$rect) | Out-Null
  $proc = try{(Get-Process -Id $wpid -EA Stop).Name}catch{'?'}
  [PSCustomObject]@{
    handle=[int64]$h; title=$tsb.ToString(); class=$csb.ToString()
    pid=[int]$wpid; process=$proc
    x=$rect.L; y=$rect.T; width=($rect.R-$rect.L); height=($rect.B-$rect.T)
    minimized=[FgWin]::IsIconic($h); maximized=[FgWin]::IsZoomed($h)
  } | ConvertTo-Json
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function waitForWindow(args: Record<string, unknown>): Promise<unknown> {
  const title      = (args.title       as string || "").replace(/['"]/g, "");
  const timeoutSec = (args.timeout_sec as number) || 30;
  const intervalMs = (args.interval_ms as number) || 500;
  if (!title) return { error: "title is required" };

  return runPS(`
$deadline = [datetime]::Now.AddSeconds(${timeoutSec})
while ([datetime]::Now -lt $deadline) {
  $found = Get-Process | Where-Object {$_.MainWindowTitle -like '*${title}*' -and $_.MainWindowHandle -ne 0} | Select-Object -First 1
  if ($found) {
    [PSCustomObject]@{ found=$true; title=$found.MainWindowTitle; pid=$found.Id; process=$found.Name } | ConvertTo-Json
    exit
  }
  Start-Sleep -Milliseconds ${intervalMs}
}
[PSCustomObject]@{ found=$false; title="${title}"; timeout_sec=${timeoutSec} } | ConvertTo-Json
`, (timeoutSec + 5) * 1000);
}

export async function launchApp(args: Record<string, unknown>): Promise<unknown> {
  const target     = (args.target as string || "").replace(/"/g, "'");
  const launchArgs = (args.args   as string | undefined)?.replace(/"/g, "'") ?? "";
  if (!target) return { error: "target is required (path, URL, or app name)" };

  return runPS(`
try {
  Start-Process '${target}' ${launchArgs ? `'${launchArgs}'` : ""} -EA Stop
  [PSCustomObject]@{ success=$true; target='${target}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function getWindowInfo(args: Record<string, unknown>): Promise<unknown> {
  const title  = (args.title  as string || "").replace(/['"]/g, "");
  const handle = args.handle as number | undefined;
  if (!title && !handle) return { error: "Provide title or handle" };

  const procFilter = handle
    ? `| Where-Object {[int]$_.MainWindowHandle -eq ${handle}}`
    : `| Where-Object {$_.MainWindowTitle -like '*${title}*'}`;

  return runPS(`
${WIN_API}
try {
  $proc = Get-Process ${procFilter} | Select-Object -First 1
  if (-not $proc) { throw "Window not found" }
  $h = $proc.MainWindowHandle
  $rect = New-Object WinAPI+RECT
  [WinAPI]::GetWindowRect($h, [ref]$rect) | Out-Null
  $cls = New-Object System.Text.StringBuilder(256)
  [WinAPI]::GetClassName($h, $cls, 256) | Out-Null
  [PSCustomObject]@{
    title=$proc.MainWindowTitle; handle=[int64]$h; class=$cls.ToString()
    pid=$proc.Id; process=$proc.Name
    x=$rect.L; y=$rect.T; width=($rect.R-$rect.L); height=($rect.B-$rect.T)
    minimized=[WinAPI]::IsIconic($h); maximized=[WinAPI]::IsZoomed($h)
  } | ConvertTo-Json
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}
