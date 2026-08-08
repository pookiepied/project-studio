import { runPS } from "../ps-helper.js";

export async function captureScreenshot(args: Record<string, unknown>): Promise<unknown> {
  const monitor  = (args.monitor  as number) || 0; // 0 = primary, -1 = all monitors combined
  const savePath = args.save_path as string | undefined;

  return runPS(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  if (${monitor} -eq -1) {
    $bounds = [System.Drawing.Rectangle]::Empty
    foreach ($s in $screens) { $bounds = [System.Drawing.Rectangle]::Union($bounds, $s.Bounds) }
  } elseif (${monitor} -lt $screens.Count) {
    $bounds = $screens[${monitor}].Bounds
  } else {
    $bounds = $screens[0].Bounds
  }
  $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
  $ts   = Get-Date -Format 'yyyyMMdd-HHmmss'
  $path = if ('${(savePath ?? "").replace(/"/g, "'")}') { '${(savePath ?? "").replace(/"/g, "'")}' } else { "$env:TEMP\\studio-screenshot-$ts.png" }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  [PSCustomObject]@{ success=$true; path=$path; width=$bounds.Width; height=$bounds.Height } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function captureWindowScreenshot(args: Record<string, unknown>): Promise<unknown> {
  const title    = (args.title as string || "").replace(/['"]/g, "");
  const savePath = args.save_path as string | undefined;
  if (!title) return { error: "title is required" };

  return runPS(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
public class WinShot {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@
Add-Type -AssemblyName System.Drawing
try {
  $proc = Get-Process | Where-Object {$_.MainWindowTitle -like '*${title}*' -and $_.MainWindowHandle -ne 0} | Select-Object -First 1
  if (-not $proc) { throw "No window matching '${title}'" }
  $h = $proc.MainWindowHandle
  [WinShot]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 200
  $rect = New-Object WinShot+RECT
  [WinShot]::GetWindowRect($h, [ref]$rect) | Out-Null
  $w = $rect.R - $rect.L; $hh = $rect.B - $rect.T
  $bmp = New-Object System.Drawing.Bitmap($w, $hh)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rect.L, $rect.T, 0, 0, (New-Object System.Drawing.Size($w,$hh)))
  $ts   = Get-Date -Format 'yyyyMMdd-HHmmss'
  $path = if ('${(savePath ?? "").replace(/"/g, "'")}') { '${(savePath ?? "").replace(/"/g, "'")}' } else { "$env:TEMP\\studio-win-$ts.png" }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  [PSCustomObject]@{ success=$true; path=$path; width=$w; height=$hh; window=$proc.MainWindowTitle } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
