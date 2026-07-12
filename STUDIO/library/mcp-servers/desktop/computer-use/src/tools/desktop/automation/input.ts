import { runPS } from "../ps-helper.js";

const INPUT_CS = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class InputCtrl {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    public const int LDN=0x02; public const int LUP=0x04; public const int RDN=0x08; public const int RUP=0x10;
    public const int MDN=0x20; public const int MUP=0x40; public const int WHEEL=0x800; public const int MOVE=0x01;
}
"@`;

export async function moveMouse(args: Record<string, unknown>): Promise<unknown> {
  const x = args.x as number;
  const y = args.y as number;
  if (x == null || y == null) return { error: "x and y are required" };

  return runPS(`
${INPUT_CS}
[InputCtrl]::SetCursorPos(${x}, ${y}) | Out-Null
[PSCustomObject]@{ success=$true; x=${x}; y=${y} } | ConvertTo-Json
`);
}

export async function clickAt(args: Record<string, unknown>): Promise<unknown> {
  const x      = args.x as number;
  const y      = args.y as number;
  const button = (args.button as string) || "left"; // left | right | middle
  if (x == null || y == null) return { error: "x and y are required" };

  const [dn, up] = button === "right"  ? ["RDN", "RUP"]
                 : button === "middle" ? ["MDN", "MUP"]
                 : ["LDN", "LUP"];

  return runPS(`
${INPUT_CS}
[InputCtrl]::SetCursorPos(${x}, ${y}) | Out-Null
Start-Sleep -Milliseconds 30
[InputCtrl]::mouse_event([InputCtrl]::${dn}, 0, 0, 0, 0)
[InputCtrl]::mouse_event([InputCtrl]::${up}, 0, 0, 0, 0)
[PSCustomObject]@{ success=$true; button='${button}'; x=${x}; y=${y} } | ConvertTo-Json
`);
}

export async function mouseDown(args: Record<string, unknown>): Promise<unknown> {
  const x      = args.x as number;
  const y      = args.y as number;
  const button = (args.button as string) || "left";
  if (x == null || y == null) return { error: "x and y are required" };

  const dn = button === "right" ? "RDN"
           : button === "middle" ? "MDN"
           : "LDN";

  return runPS(`
${INPUT_CS}
[InputCtrl]::SetCursorPos(${x}, ${y}) | Out-Null
Start-Sleep -Milliseconds 30
[InputCtrl]::mouse_event([InputCtrl]::${dn}, 0, 0, 0, 0)
[PSCustomObject]@{ success=$true; button='${button}'; x=${x}; y=${y}; state='down' } | ConvertTo-Json
`);
}

export async function mouseUp(args: Record<string, unknown>): Promise<unknown> {
  const x      = args.x as number | undefined;
  const y      = args.y as number | undefined;
  const button = (args.button as string) || "left";

  const up = button === "right" ? "RUP"
           : button === "middle" ? "MUP"
           : "LUP";
  const maybeMove = x != null && y != null
    ? `[InputCtrl]::SetCursorPos(${x}, ${y}) | Out-Null`
    : "";

  return runPS(`
${INPUT_CS}
${maybeMove}
Start-Sleep -Milliseconds 30
[InputCtrl]::mouse_event([InputCtrl]::${up}, 0, 0, 0, 0)
$p = New-Object InputCtrl+POINT
[InputCtrl]::GetCursorPos([ref]$p) | Out-Null
[PSCustomObject]@{ success=$true; button='${button}'; x=$p.X; y=$p.Y; state='up' } | ConvertTo-Json
`);
}

export async function doubleClickAt(args: Record<string, unknown>): Promise<unknown> {
  const x = args.x as number;
  const y = args.y as number;
  if (x == null || y == null) return { error: "x and y are required" };

  return runPS(`
${INPUT_CS}
[InputCtrl]::SetCursorPos(${x}, ${y}) | Out-Null; Start-Sleep -Milliseconds 30
[InputCtrl]::mouse_event([InputCtrl]::LDN,0,0,0,0); [InputCtrl]::mouse_event([InputCtrl]::LUP,0,0,0,0)
Start-Sleep -Milliseconds 50
[InputCtrl]::mouse_event([InputCtrl]::LDN,0,0,0,0); [InputCtrl]::mouse_event([InputCtrl]::LUP,0,0,0,0)
[PSCustomObject]@{ success=$true; x=${x}; y=${y} } | ConvertTo-Json
`);
}

export async function scrollAt(args: Record<string, unknown>): Promise<unknown> {
  const x       = args.x as number;
  const y       = args.y as number;
  const delta   = (args.delta as number) || 3; // positive = up, negative = down
  const wheelDelta = delta * 120; // Windows WHEEL_DELTA unit

  if (x == null || y == null) return { error: "x and y are required" };

  return runPS(`
${INPUT_CS}
[InputCtrl]::SetCursorPos(${x}, ${y}) | Out-Null; Start-Sleep -Milliseconds 30
[InputCtrl]::mouse_event([InputCtrl]::WHEEL, 0, 0, ${wheelDelta}, 0)
[PSCustomObject]@{ success=$true; x=${x}; y=${y}; delta=${delta} } | ConvertTo-Json
`);
}

export async function typeText(args: Record<string, unknown>): Promise<unknown> {
  const text  = args.text as string;
  const delay = (args.delay_ms as number) || 0;
  if (text == null) return { error: "text is required" };

  // Escape special SendKeys characters: +^%~(){}  ([and] are NOT special in SendKeys)
  const escaped = text
    .replace(/[+^%~(){}]/g, (c) => `{${c}}`);
  const safe = escaped.replace(/'/g, "''");

  return runPS(`
Add-Type -AssemblyName System.Windows.Forms
if (${delay} -gt 0) { Start-Sleep -Milliseconds ${delay} }
[System.Windows.Forms.SendKeys]::SendWait('${safe}')
[PSCustomObject]@{ success=$true; length=${text.length} } | ConvertTo-Json
`);
}

export async function pressHotkey(args: Record<string, unknown>): Promise<unknown> {
  const keys = args.keys as string;
  if (!keys) return { error: "keys is required — use SendKeys syntax, e.g. '^c' for Ctrl+C, '%{F4}' for Alt+F4, '^+s' for Ctrl+Shift+S" };

  const safe = (keys as string).replace(/'/g, "''");

  return runPS(`
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 50
[System.Windows.Forms.SendKeys]::SendWait('${safe}')
[PSCustomObject]@{ success=$true; keys='${safe}' } | ConvertTo-Json
`);
}

export async function dragAndDrop(args: Record<string, unknown>): Promise<unknown> {
  const fromX   = args.from_x as number;
  const fromY   = args.from_y as number;
  const toX     = args.to_x   as number;
  const toY     = args.to_y   as number;
  const button  = (args.button as string) || "left";
  const steps   = (args.steps  as number) || 20;

  if (fromX == null || fromY == null || toX == null || toY == null)
    return { error: "from_x, from_y, to_x, to_y are required" };

  const [dn, up] = button === "right" ? ["RDN","RUP"] : button === "middle" ? ["MDN","MUP"] : ["LDN","LUP"];

  return runPS(`
${INPUT_CS}
[InputCtrl]::SetCursorPos(${fromX}, ${fromY}) | Out-Null
Start-Sleep -Milliseconds 80
[InputCtrl]::mouse_event([InputCtrl]::${dn}, 0, 0, 0, 0)
Start-Sleep -Milliseconds 80
for ($i = 1; $i -le ${steps}; $i++) {
  $cx = [int](${fromX} + (${toX} - ${fromX}) * $i / ${steps})
  $cy = [int](${fromY} + (${toY} - ${fromY}) * $i / ${steps})
  [InputCtrl]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds 15
}
[InputCtrl]::SetCursorPos(${toX}, ${toY}) | Out-Null
Start-Sleep -Milliseconds 80
[InputCtrl]::mouse_event([InputCtrl]::${up}, 0, 0, 0, 0)
[PSCustomObject]@{ success=$true; from_x=${fromX}; from_y=${fromY}; to_x=${toX}; to_y=${toY}; button='${button}' } | ConvertTo-Json
`);
}

export async function keyDown(args: Record<string, unknown>): Promise<unknown> {
  const key = (args.key as string || "").replace(/'/g, "''");
  if (!key) return { error: "key is required — use SendKeys notation e.g. '{SHIFT}', '{CTRL}', '{ALT}', 'a'" };

  return runPS(`
Add-Type -AssemblyName System.Windows.Forms
# Use keybd_event for true key-down without auto-release
Add-Type @"
using System.Runtime.InteropServices;
public class KeyCtrl {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, int extra);
  public const uint KEYDOWN=0; public const uint KEYUP=2;
}
"@
# Map common key names to VK codes
$vkMap = @{
  'SHIFT'=0x10; 'CTRL'=0x11; 'ALT'=0x12; 'WIN'=0x5B
  'F1'=0x70; 'F2'=0x71; 'F3'=0x72; 'F4'=0x73; 'F5'=0x74
  'F6'=0x75; 'F7'=0x76; 'F8'=0x77; 'F9'=0x78; 'F10'=0x79
  'F11'=0x7A; 'F12'=0x7B
}
$k = '${key}'.ToUpper().Trim('{','}')
$vk = if ($vkMap.ContainsKey($k)) { $vkMap[$k] } else { [int][System.Windows.Forms.Keys]::$k -band 0xFF }
if ($vk -eq 0) { throw "Unknown key '${key}'" }
[KeyCtrl]::keybd_event($vk, 0, [KeyCtrl]::KEYDOWN, 0)
[PSCustomObject]@{ success=$true; key='${key}'; vk=$vk; state='down' } | ConvertTo-Json
`);
}

export async function keyUp(args: Record<string, unknown>): Promise<unknown> {
  const key = (args.key as string || "").replace(/'/g, "''");
  if (!key) return { error: "key is required" };

  return runPS(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System.Runtime.InteropServices;
public class KeyCtrl2 {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, int extra);
  public const uint KEYDOWN=0; public const uint KEYUP=2;
}
"@
$vkMap = @{
  'SHIFT'=0x10; 'CTRL'=0x11; 'ALT'=0x12; 'WIN'=0x5B
  'F1'=0x70; 'F2'=0x71; 'F3'=0x72; 'F4'=0x73; 'F5'=0x74
  'F6'=0x75; 'F7'=0x76; 'F8'=0x77; 'F9'=0x78; 'F10'=0x79
  'F11'=0x7A; 'F12'=0x7B
}
$k = '${key}'.ToUpper().Trim('{','}')
$vk = if ($vkMap.ContainsKey($k)) { $vkMap[$k] } else { [int][System.Windows.Forms.Keys]::$k -band 0xFF }
if ($vk -eq 0) { throw "Unknown key '${key}'" }
[KeyCtrl2]::keybd_event($vk, 0, [KeyCtrl2]::KEYUP, 0)
[PSCustomObject]@{ success=$true; key='${key}'; vk=$vk; state='up' } | ConvertTo-Json
`);
}

export async function getMousePosition(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
${INPUT_CS}
$p = New-Object InputCtrl+POINT
[InputCtrl]::GetCursorPos([ref]$p) | Out-Null
[PSCustomObject]@{ x=$p.X; y=$p.Y } | ConvertTo-Json
`);
}
