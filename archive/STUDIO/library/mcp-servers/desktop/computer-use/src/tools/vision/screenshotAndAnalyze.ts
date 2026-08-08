/**
 * screenshot_and_analyze — capture a screenshot and immediately return it as
 * MCP image content for direct LLM vision analysis.
 *
 * This is the primary "see what's on screen" tool. It collapses what was
 * previously a two-step workflow (capture_screenshot → analyze_image) into
 * a single call with zero leftover temp files.
 *
 * Capture modes (evaluated in priority order):
 *   1. window_title set         → capture that specific window only
 *   2. x + y + width + height   → capture a screen region
 *   3. (default)                → capture full primary monitor (or monitor N)
 *
 * The tool always cleans up the temp PNG file in a finally block —
 * no disk residue regardless of success or failure.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { runPS } from "../desktop/ps-helper.js";
import { loadImageFromFile } from "./imageLoader.js";
import type { McpContent } from "./types.js";

// ---------------------------------------------------------------------------
// PowerShell capture scripts
// ---------------------------------------------------------------------------

function windowScript(safeTitle: string, psPath: string): string {
  return `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Drawing;
public class SAW {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@
Add-Type -AssemblyName System.Drawing
try {
  $proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safeTitle}*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { throw "No window matching '${safeTitle}' — use list_windows to find the exact title" }
  $h = $proc.MainWindowHandle
  [SAW]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 250
  $r = New-Object SAW+RECT
  [SAW]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  if ($w -le 0 -or $hh -le 0) { throw "Window has zero size — it may be minimized or off-screen" }
  $bmp = New-Object System.Drawing.Bitmap($w, $hh)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
  $bmp.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  [PSCustomObject]@{ success=$true; width=$w; height=$hh; source='window'; window=$proc.MainWindowTitle } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }`;
}

function regionScript(x: number, y: number, w: number, h: number, psPath: string): string {
  return `
Add-Type -AssemblyName System.Drawing
try {
  $bmp = New-Object System.Drawing.Bitmap(${w}, ${h})
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen(${x}, ${y}, 0, 0, (New-Object System.Drawing.Size(${w}, ${h})))
  $bmp.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  [PSCustomObject]@{ success=$true; width=${w}; height=${h}; source='region'; x=${x}; y=${y} } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }`;
}

function fullScreenScript(monitor: number, psPath: string): string {
  return `
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
  $bmp.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  [PSCustomObject]@{ success=$true; width=$bounds.Width; height=$bounds.Height; source='screen'; monitor=${monitor} } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }`;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export async function screenshotAndAnalyze(
  args: Record<string, unknown>
): Promise<McpContent[]> {
  const monitor     = (args.monitor     as number  | undefined) ?? 0;
  const windowTitle = (args.window_title as string | undefined)?.trim();
  const x           = args.x     as number | undefined;
  const y           = args.y     as number | undefined;
  const width       = args.width as number | undefined;
  const height      = args.height as number | undefined;

  // Unique temp path — always deleted in finally
  const tmpPath = `${os.tmpdir()}\\studio-see-${Date.now()}.png`;
  const psPath  = tmpPath.replace(/'/g, "''");

  let script: string;

  if (windowTitle) {
    const safeTitle = windowTitle.replace(/['"\\]/g, "");
    script = windowScript(safeTitle, psPath);
  } else if (x != null && y != null && width != null && height != null) {
    if (width <= 0 || height <= 0) {
      return [{ type: "text", text: JSON.stringify({ error: "width and height must be positive integers" }) }];
    }
    script = regionScript(x, y, width, height, psPath);
  } else {
    script = fullScreenScript(monitor, psPath);
  }

  try {
    const captureResult = await runPS(script, 20_000) as Record<string, unknown>;

    if (!captureResult || captureResult.success === false) {
      const errMsg = (captureResult?.error as string) ?? "Screenshot capture failed";
      return [{ type: "text", text: JSON.stringify({ error: errMsg, success: false }) }];
    }

    // Load the saved file as base64 for MCP image content
    const loaded = loadImageFromFile(tmpPath);
    if (!loaded.ok || !loaded.content) {
      return [{
        type: "text",
        text: JSON.stringify({
          error: `Captured screenshot but failed to load for analysis: ${loaded.error}`,
        }),
      }];
    }

    const meta: Record<string, unknown> = {
      success:  true,
      bytes:    loaded.bytes,
      mimeType: "image/png",
      width:    captureResult.width,
      height:   captureResult.height,
      source:   captureResult.source,
      note:     "Screenshot ready — analyze the visual content shown above.",
    };
    if (captureResult.window) meta.window  = captureResult.window;
    if (monitor !== 0)        meta.monitor = monitor;

    return [
      loaded.content,
      { type: "text", text: JSON.stringify(meta) },
    ];
  } finally {
    // Best-effort cleanup — never block on temp file deletion
    try { fs.unlinkSync(tmpPath); } catch { /* ignored */ }
  }
}
