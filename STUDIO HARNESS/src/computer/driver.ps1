# The computer-use driver: what Windows already has, spoken as JSON lines.
#
# One request per line on stdin, one answer per line on stdout. Nothing here
# is installed or downloaded (ADR 0055): the pointer and keyboard are user32's
# SendInput, the pictures are System.Drawing, the windows are EnumWindows, and
# the UI tree is System.Windows.Automation - all of which every Windows 10 and
# 11 machine has under Windows PowerShell 5.1, which is always present.
#
# Requests are answered one at a time, in order. A runspace is single-threaded
# and so is a person's input; a "ping" behind a slow screenshot waits, which
# the Node side allows for.

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -Namespace Studio -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
[DllImport("user32.dll")] public static extern short VkKeyScanW(char ch);
[DllImport("user32.dll")] public static extern uint MapVirtualKeyW(uint code, uint type);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
'@

[void][Studio.Native]::SetProcessDPIAware()

# ---- Pictures ---------------------------------------------------------------

function Get-Displays {
  $all = [System.Windows.Forms.Screen]::AllScreens
  $list = @()
  for ($i = 0; $i -lt $all.Length; $i++) {
    $s = $all[$i]
    $list += [ordered]@{
      index = $i; name = $s.DeviceName; primary = $s.Primary
      x = $s.Bounds.X; y = $s.Bounds.Y; width = $s.Bounds.Width; height = $s.Bounds.Height
    }
  }
  return ,$list
}

function Resolve-Display($index) {
  $all = [System.Windows.Forms.Screen]::AllScreens
  if ($null -eq $index -or $index -eq "") {
    for ($i = 0; $i -lt $all.Length; $i++) { if ($all[$i].Primary) { return @{ index = $i; screen = $all[$i] } } }
    return @{ index = 0; screen = $all[0] }
  }
  $n = [int]$index
  if ($n -lt 0 -or $n -ge $all.Length) { throw "There is no display $n. Displays are numbered 0 to $($all.Length - 1)." }
  return @{ index = $n; screen = $all[$n] }
}

# A PNG of one display, or a region of it, scaled so the longest side is at
# most `max` pixels. The answer names the full frame the picture stands for,
# because the model acts in that frame and never in the picture's pixels.
function Take-Screenshot($display, $region, $max, $format, $quality) {
  $d = Resolve-Display $display
  $b = $d.screen.Bounds
  $x = $b.X; $y = $b.Y; $w = $b.Width; $h = $b.Height
  if ($null -ne $region) {
    $rx0 = [int]$region[0]; $ry0 = [int]$region[1]; $rx1 = [int]$region[2]; $ry1 = [int]$region[3]
    $rx0 = [Math]::Max(0, [Math]::Min($rx0, $w - 1)); $ry0 = [Math]::Max(0, [Math]::Min($ry0, $h - 1))
    $rx1 = [Math]::Max($rx0 + 1, [Math]::Min($rx1, $w)); $ry1 = [Math]::Max($ry0 + 1, [Math]::Min($ry1, $h))
    $x = $b.X + $rx0; $y = $b.Y + $ry0; $w = $rx1 - $rx0; $h = $ry1 - $ry0
  }
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try { $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h)) } finally { $g.Dispose() }
  $limit = if ($null -eq $max -or $max -eq "") { 1568 } else { [int]$max }
  $scale = 1.0
  $longest = [Math]::Max($w, $h)
  if ($longest -gt $limit) { $scale = $limit / $longest }
  $out = $bmp
  if ($scale -lt 1.0) {
    $sw = [Math]::Max(1, [int][Math]::Round($w * $scale)); $sh = [Math]::Max(1, [int][Math]::Round($h * $scale))
    $out = New-Object System.Drawing.Bitmap $sw, $sh
    $g2 = [System.Drawing.Graphics]::FromImage($out)
    try {
      $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g2.DrawImage($bmp, 0, 0, $sw, $sh)
    } finally { $g2.Dispose() }
  }
  # PNG for a picture the model will read closely; JPEG for the frame that
  # rides along with an action, where "did the click land" is answered as
  # well by a smaller file. The JPEG is saved at the library's default
  # quality on purpose: setting one through EncoderParameters is a pattern
  # Windows Defender's script scanner (AMSI) matches as spyware, and it
  # blocked this whole script for it on 2026-09-15. `$quality` is accepted
  # and ignored so the request shape need not change if that ever lifts.
  $ms = New-Object System.IO.MemoryStream
  $mime = "image/png"
  try {
    if ($format -eq "jpeg") {
      $mime = "image/jpeg"
      $out.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    } else {
      $out.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $data = [Convert]::ToBase64String($ms.ToArray())
  } finally { $ms.Dispose() }
  if ($out -ne $bmp) { $out.Dispose() }
  $bmp.Dispose()
  return [ordered]@{
    display = $d.index; frameWidth = $b.Width; frameHeight = $b.Height
    x = $x - $b.X; y = $y - $b.Y; width = $w; height = $h
    imageWidth = [int][Math]::Round($w * $scale); imageHeight = [int][Math]::Round($h * $scale)
    mimeType = $mime; data = $data
  }
}

# ---- Pointer ----------------------------------------------------------------

function To-Absolute($display, $x, $y) {
  $d = Resolve-Display $display
  return @{ x = $d.screen.Bounds.X + [int]$x; y = $d.screen.Bounds.Y + [int]$y }
}

function Get-Cursor {
  $p = New-Object Studio.Native+POINT
  [void][Studio.Native]::GetCursorPos([ref]$p)
  $all = [System.Windows.Forms.Screen]::AllScreens
  for ($i = 0; $i -lt $all.Length; $i++) {
    $b = $all[$i].Bounds
    if ($p.X -ge $b.X -and $p.X -lt $b.X + $b.Width -and $p.Y -ge $b.Y -and $p.Y -lt $b.Y + $b.Height) {
      return [ordered]@{ display = $i; x = $p.X - $b.X; y = $p.Y - $b.Y }
    }
  }
  return [ordered]@{ display = 0; x = $p.X; y = $p.Y }
}

function Send-Mouse([uint32]$flags, [int]$data) {
  $i = New-Object Studio.Native+INPUT
  $i.type = 0
  $i.u.mi.dwFlags = $flags
  $i.u.mi.mouseData = [uint32]$data
  $arr = [Studio.Native+INPUT[]]@($i)
  $sent = [Studio.Native]::SendInput(1, $arr, [System.Runtime.InteropServices.Marshal]::SizeOf([type][Studio.Native+INPUT]))
  if ($sent -ne 1) { throw "Windows refused the mouse input. A window that runs as administrator cannot be driven from here." }
}

function Move-Pointer($display, $x, $y) {
  $a = To-Absolute $display $x $y
  [void][Studio.Native]::SetCursorPos($a.x, $a.y)
  Start-Sleep -Milliseconds 20
}

$ButtonFlags = @{
  left = @{ down = 0x0002; up = 0x0004 }
  right = @{ down = 0x0008; up = 0x0010 }
  middle = @{ down = 0x0020; up = 0x0040 }
}

function Press-Button($button, $direction) {
  $b = $ButtonFlags[$button]
  if ($null -eq $b) { throw "The button must be left, right or middle." }
  Send-Mouse $b[$direction] 0
}

function Click-At($display, $x, $y, $button, $count, $modifiers) {
  if ($null -ne $x -and $x -ne "") { Move-Pointer $display $x $y }
  $b = if ($null -eq $button -or $button -eq "") { "left" } else { $button }
  $n = if ($null -eq $count -or $count -eq "") { 1 } else { [int]$count }
  $held = Press-Modifiers $modifiers $true
  try {
    for ($i = 0; $i -lt $n; $i++) {
      Press-Button $b "down"; Press-Button $b "up"
      if ($i -lt $n - 1) { Start-Sleep -Milliseconds 60 }
    }
  } finally { Press-Modifiers $held $false | Out-Null }
}

function Drag-Pointer($display, $from, $to) {
  Move-Pointer $display $from[0] $from[1]
  Press-Button "left" "down"
  Start-Sleep -Milliseconds 80
  # A few intermediate positions, because a drop target that watches
  # WM_MOUSEMOVE never sees a pointer that teleports.
  $fx = [int]$from[0]; $fy = [int]$from[1]; $tx = [int]$to[0]; $ty = [int]$to[1]
  for ($s = 1; $s -le 8; $s++) {
    Move-Pointer $display ($fx + ($tx - $fx) * $s / 8) ($fy + ($ty - $fy) * $s / 8)
    Start-Sleep -Milliseconds 25
  }
  Press-Button "left" "up"
}

function Scroll-At($display, $x, $y, $direction, $amount) {
  if ($null -ne $x -and $x -ne "") { Move-Pointer $display $x $y }
  $ticks = if ($null -eq $amount -or $amount -eq "") { 3 } else { [int]$amount }
  $delta = 120 * $ticks
  switch ($direction) {
    "up" { Send-Mouse 0x0800 $delta }
    "down" { Send-Mouse 0x0800 (-$delta) }
    "left" { Send-Mouse 0x1000 (-$delta) }
    "right" { Send-Mouse 0x1000 $delta }
    default { throw "The direction must be up, down, left or right." }
  }
}

# ---- Keyboard ---------------------------------------------------------------

$KeyCodes = @{
  "return" = 0x0D; "enter" = 0x0D; "tab" = 0x09; "escape" = 0x1B; "esc" = 0x1B; "backspace" = 0x08
  "delete" = 0x2E; "del" = 0x2E; "insert" = 0x2D; "space" = 0x20; "home" = 0x24; "end" = 0x23
  "pageup" = 0x21; "pagedown" = 0x22; "up" = 0x26; "down" = 0x28; "left" = 0x25; "right" = 0x27
  "ctrl" = 0x11; "control" = 0x11; "shift" = 0x10; "alt" = 0x12; "win" = 0x5B; "windows" = 0x5B; "super" = 0x5B; "cmd" = 0x5B; "meta" = 0x5B
  "capslock" = 0x14; "printscreen" = 0x2C; "pause" = 0x13; "menu" = 0x5D; "apps" = 0x5D
  "f1" = 0x70; "f2" = 0x71; "f3" = 0x72; "f4" = 0x73; "f5" = 0x74; "f6" = 0x75; "f7" = 0x76; "f8" = 0x77
  "f9" = 0x78; "f10" = 0x79; "f11" = 0x7A; "f12" = 0x7B
  "volumeup" = 0xAF; "volumedown" = 0xAE; "volumemute" = 0xAD
}

$ExtendedKeys = @(0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27, 0x5B, 0x5D)

function Resolve-Key($name) {
  $n = $name.ToLowerInvariant().Trim()
  if ($KeyCodes.ContainsKey($n)) { return [int]$KeyCodes[$n] }
  if ($n.Length -eq 1) {
    $scan = [Studio.Native]::VkKeyScanW([char]$n)
    if ($scan -eq -1) { throw "There is no key for `"$name`" on this keyboard layout." }
    return [int]($scan -band 0xFF)
  }
  throw "Unknown key `"$name`". Use names like return, tab, escape, ctrl, shift, alt, win, f5, or a single character."
}

function Send-Key([int]$vk, [bool]$down) {
  $i = New-Object Studio.Native+INPUT
  $i.type = 1
  $i.u.ki.wVk = [uint16]$vk
  $i.u.ki.wScan = [uint16][Studio.Native]::MapVirtualKeyW([uint32]$vk, 0)
  $flags = 0
  if ($ExtendedKeys -contains $vk) { $flags = $flags -bor 0x0001 }
  if (-not $down) { $flags = $flags -bor 0x0002 }
  $i.u.ki.dwFlags = [uint32]$flags
  $arr = [Studio.Native+INPUT[]]@($i)
  $sent = [Studio.Native]::SendInput(1, $arr, [System.Runtime.InteropServices.Marshal]::SizeOf([type][Studio.Native+INPUT]))
  if ($sent -ne 1) { throw "Windows refused the key. A window that runs as administrator cannot be driven from here." }
}

# Modifiers named in "ctrl+shift" form; returns the codes held so they can be
# released in reverse in a finally, even when the middle throws.
function Press-Modifiers($spec, [bool]$down) {
  if ($null -eq $spec -or $spec -eq "" -or $spec.Count -eq 0) { return @() }
  $codes = @()
  if ($spec -is [string]) {
    foreach ($part in $spec.Split("+")) { if ($part.Trim() -ne "") { $codes += (Resolve-Key $part) } }
  } else { $codes = $spec }
  if ($down) { foreach ($c in $codes) { Send-Key $c $true } ; return $codes }
  foreach ($c in ($codes | Sort-Object -Descending { [array]::IndexOf($codes, $_) })) { Send-Key $c $false }
  return @()
}

function Press-Chord($chord, $repeat) {
  $parts = @($chord.Split("+") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
  if ($parts.Count -eq 0) { throw "Say which key to press." }
  $codes = @($parts | ForEach-Object { Resolve-Key $_ })
  $n = if ($null -eq $repeat -or $repeat -eq "") { 1 } else { [int]$repeat }
  for ($r = 0; $r -lt $n; $r++) {
    foreach ($c in $codes) { Send-Key $c $true }
    for ($k = $codes.Count - 1; $k -ge 0; $k--) { Send-Key $codes[$k] $false }
    if ($r -lt $n - 1) { Start-Sleep -Milliseconds 30 }
  }
}

function Hold-Chord($chord, $seconds) {
  $codes = @($chord.Split("+") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" } | ForEach-Object { Resolve-Key $_ })
  foreach ($c in $codes) { Send-Key $c $true }
  try { Start-Sleep -Milliseconds ([int]([double]$seconds * 1000)) }
  finally { for ($k = $codes.Count - 1; $k -ge 0; $k--) { Send-Key $codes[$k] $false } }
}

# Text goes in as Unicode key events, one per character, which reaches every
# window regardless of keyboard layout and never trips a shortcut the way
# virtual keys can. A newline is Return, because that is what a person means.
function Type-Text($text) {
  foreach ($ch in $text.ToCharArray()) {
    if ($ch -eq "`n") { Send-Key 0x0D $true; Send-Key 0x0D $false; continue }
    if ($ch -eq "`r") { continue }
    foreach ($up in @($false, $true)) {
      $i = New-Object Studio.Native+INPUT
      $i.type = 1
      $i.u.ki.wVk = 0
      $i.u.ki.wScan = [uint16]$ch
      $i.u.ki.dwFlags = [uint32](0x0004 -bor $(if ($up) { 0x0002 } else { 0 }))
      $arr = [Studio.Native+INPUT[]]@($i)
      [void][Studio.Native]::SendInput(1, $arr, [System.Runtime.InteropServices.Marshal]::SizeOf([type][Studio.Native+INPUT]))
    }
    Start-Sleep -Milliseconds 4
  }
}

# ---- Windows and apps -------------------------------------------------------

function Get-WindowTitle($h) {
  $len = [Studio.Native]::GetWindowTextLengthW($h)
  if ($len -le 0) { return "" }
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [void][Studio.Native]::GetWindowTextW($h, $sb, $len + 1)
  return $sb.ToString()
}

$script:Windows = @()
$script:Enum = [Studio.Native+EnumWindowsProc]{
  param($h, $l)
  if ([Studio.Native]::IsWindowVisible($h)) {
    $t = Get-WindowTitle $h
    if ($t -ne "") {
      $r = New-Object Studio.Native+RECT
      [void][Studio.Native]::GetWindowRect($h, [ref]$r)
      $owner = [uint32]0
      [void][Studio.Native]::GetWindowThreadProcessId($h, [ref]$owner)
      $script:Windows += [ordered]@{
        handle = [int64]$h; title = $t; pid = [int]$owner
        x = $r.Left; y = $r.Top; width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top)
        minimized = [Studio.Native]::IsIconic($h)
      }
    }
  }
  return $true
}

function Get-TopWindows($app) {
  $script:Windows = @()
  [void][Studio.Native]::EnumWindows($script:Enum, [IntPtr]::Zero)
  $fg = [int64][Studio.Native]::GetForegroundWindow()
  $procs = @{}
  foreach ($w in $script:Windows) {
    if (-not $procs.ContainsKey($w.pid)) {
      $p = Get-Process -Id $w.pid -ErrorAction SilentlyContinue
      $procs[$w.pid] = if ($null -ne $p) { $p.ProcessName } else { "" }
    }
    $w.app = $procs[$w.pid]
    $w.foreground = ($w.handle -eq $fg)
  }
  $list = $script:Windows
  if ($null -ne $app -and $app -ne "") {
    $needle = $app.ToLowerInvariant()
    $list = @($list | Where-Object { $_.app.ToLowerInvariant() -like "*$needle*" -or $_.title.ToLowerInvariant() -like "*$needle*" })
  }
  return ,@($list)
}

function Get-Apps {
  $byName = @{}
  foreach ($w in (Get-TopWindows $null)) {
    if (-not $byName.ContainsKey($w.app)) { $byName[$w.app] = [ordered]@{ app = $w.app; pid = $w.pid; windows = 0; foreground = $false } }
    $byName[$w.app].windows += 1
    if ($w.foreground) { $byName[$w.app].foreground = $true }
  }
  return ,@($byName.Values | Sort-Object { $_.app })
}

function Focus-Window($handle) {
  $h = [IntPtr][int64]$handle
  if ([Studio.Native]::IsIconic($h)) { [void][Studio.Native]::ShowWindow($h, 9) }
  # A process that is not in the foreground may not steal it, by design.
  # Attaching to the foreground thread's input queue is the sanctioned way to
  # be allowed, and it is undone whether or not the switch worked.
  $fg = [Studio.Native]::GetForegroundWindow()
  $owner = [uint32]0
  $fgThread = [Studio.Native]::GetWindowThreadProcessId($fg, [ref]$owner)
  $me = [Studio.Native]::GetCurrentThreadId()
  $attached = $false
  if ($fgThread -ne 0 -and $fgThread -ne $me) { $attached = [Studio.Native]::AttachThreadInput($me, $fgThread, $true) }
  try {
    $ok = [Studio.Native]::SetForegroundWindow($h)
  } finally { if ($attached) { [void][Studio.Native]::AttachThreadInput($me, $fgThread, $false) } }
  Start-Sleep -Milliseconds 150
  return [ordered]@{ focused = ([int64][Studio.Native]::GetForegroundWindow() -eq [int64]$handle); asked = [bool]$ok }
}

function Open-App($app, $path) {
  if ($null -ne $path -and $path -ne "") {
    $p = Start-Process -FilePath $path -PassThru
    return [ordered]@{ started = $true; pid = $p.Id; what = $path }
  }
  if ($null -eq $app -or $app -eq "") { throw "Say which app to open, or give a path." }
  # Already running with a window: bring it forward rather than start a second.
  $existing = @(Get-TopWindows $app)
  if ($existing.Count -gt 0) {
    $f = Focus-Window $existing[0].handle
    return [ordered]@{ started = $false; focused = $f.focused; window = $existing[0].title; pid = $existing[0].pid }
  }
  $needle = $app.ToLowerInvariant()
  $starts = @(Get-StartApps | Where-Object { $_.Name.ToLowerInvariant() -eq $needle })
  if ($starts.Count -eq 0) { $starts = @(Get-StartApps | Where-Object { $_.Name.ToLowerInvariant() -like "*$needle*" }) }
  if ($starts.Count -eq 0) { throw "No app called `"$app`" is installed. Names are as they appear in the Start menu." }
  Start-Process -FilePath "explorer.exe" -ArgumentList ("shell:AppsFolder\" + $starts[0].AppID)
  Start-Sleep -Milliseconds 1500
  return [ordered]@{ started = $true; what = $starts[0].Name }
}

# ---- Accessibility ----------------------------------------------------------

$script:Refs = @{}

function Ui-Root($window) {
  if ($null -ne $window -and $window -ne "") {
    return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][int64]$window)
  }
  $fg = [Studio.Native]::GetForegroundWindow()
  if ($fg -eq [IntPtr]::Zero) { throw "No window is in the foreground. Name a window from `windows`." }
  return [System.Windows.Automation.AutomationElement]::FromHandle($fg)
}

$Interactive = @("button", "check box", "radio button", "combo box", "edit", "hyperlink", "list item", "menu item", "tab item", "slider", "spinner", "split button", "tree item", "document", "menu bar", "menu", "list", "tab", "tool bar", "data item", "header item")

function Read-Ui($window, $depth, $limit, $all) {
  $script:Refs = @{}
  $root = Ui-Root $window
  $maxDepth = if ($null -eq $depth -or $depth -eq "") { 12 } else { [int]$depth }
  $maxLines = if ($null -eq $limit -or $limit -eq "") { 400 } else { [int]$limit }
  $everything = ($all -eq $true)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $lines = New-Object System.Collections.Generic.List[string]
  $counter = 0
  $stack = New-Object System.Collections.Generic.Stack[object]
  $stack.Push(@{ el = $root; d = 0 })
  while ($stack.Count -gt 0 -and $lines.Count -lt $maxLines) {
    $item = $stack.Pop()
    $el = $item.el; $d = $item.d
    try {
      $type = $el.Current.LocalizedControlType
      $name = $el.Current.Name
      $off = $el.Current.IsOffscreen
      $rect = $el.Current.BoundingRectangle
    } catch { continue }
    $wanted = $everything -or ($Interactive -contains $type) -or ($el.Current.IsKeyboardFocusable)
    if ($wanted -and -not $off -and $rect.Width -gt 0) {
      $counter += 1
      $script:Refs[$counter] = $el
      $parts = @(("  " * [Math]::Min($d, 8)) + $type)
      if ($name -ne "") { $parts += ('"' + $name.Replace("`n", " ").Substring(0, [Math]::Min(120, $name.Length)) + '"') }
      try {
        $vp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
          $v = $vp.Current.Value
          if ($v -ne "") { $parts += ('value="' + $v.Substring(0, [Math]::Min(60, $v.Length)) + '"') }
        }
        $tp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
          if ($tp.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { $parts += "checked" }
        }
      } catch {}
      if (-not $el.Current.IsEnabled) { $parts += "disabled" }
      if ($el.Current.HasKeyboardFocus) { $parts += "focused" }
      $cx = [int]($rect.X + $rect.Width / 2); $cy = [int]($rect.Y + $rect.Height / 2)
      $parts += "@($cx,$cy)"
      $parts += "[ui_$counter]"
      $lines.Add(($parts -join " "))
    }
    if ($d -lt $maxDepth) {
      $children = @()
      try {
        $c = $walker.GetFirstChild($el)
        while ($null -ne $c) { $children += $c; $c = $walker.GetNextSibling($c) }
      } catch {}
      for ($i = $children.Count - 1; $i -ge 0; $i--) { $stack.Push(@{ el = $children[$i]; d = $d + 1 }) }
    }
  }
  if ($lines.Count -ge $maxLines) { $lines.Add("... more elements than $maxLines, not listed.") }
  $title = try { $root.Current.Name } catch { "" }
  $minimized = $false
  try { $minimized = [Studio.Native]::IsIconic([IntPtr]$root.Current.NativeWindowHandle) } catch {}
  return [ordered]@{ window = $title; minimized = $minimized; outline = ($lines -join "`n") }
}

function Ui-Ref($ref) {
  if ($ref -notmatch '^ui_(\d+)$') { throw "`"$ref`" is not an element reference. A reference looks like ui_12 and comes from read_ui." }
  $n = [int]$Matches[1]
  $el = $script:Refs[$n]
  if ($null -eq $el) { throw "There is no ui_$n from the last read. References come from read_ui and are replaced by the next read; read the window again." }
  try { [void]$el.Current.Name } catch { throw "ui_$n is no longer on screen. Read the window again." }
  return $el
}

function Ui-Act($ref, $action) {
  $el = Ui-Ref $ref
  $p = $null
  switch ($action) {
    "invoke" {
      if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return "Invoked." }
      if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return "Selected." }
      if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $p.Toggle(); return "Toggled." }
      throw "That element cannot be invoked. Click its centre instead."
    }
    "toggle" { if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $p.Toggle(); return "Toggled." }; throw "That element does not toggle." }
    "expand" { if ($el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $p.Expand(); return "Expanded." }; throw "That element does not expand." }
    "collapse" { if ($el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $p.Collapse(); return "Collapsed." }; throw "That element does not collapse." }
    "select" { if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return "Selected." }; throw "That element cannot be selected." }
    "focus" { $el.SetFocus(); return "Focused." }
    "scroll_into_view" { if ($el.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$p)) { $p.ScrollIntoView(); return "Scrolled into view." }; throw "That element cannot be scrolled into view." }
    default { throw "The action must be invoke, toggle, expand, collapse, select, focus or scroll_into_view." }
  }
}

function Ui-SetValue($ref, $value) {
  $el = Ui-Ref $ref
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {
    if ($p.Current.IsReadOnly) { throw "That field is read-only." }
    $p.SetValue([string]$value); return "Set."
  }
  throw "That element does not take a value directly. Focus it and type instead."
}

function Ui-SelectText($ref, $start, $end) {
  $el = Ui-Ref $ref
  $p = $null
  if (-not $el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$p)) { throw "That element has no text to select." }
  $range = $p.DocumentRange.Clone()
  $length = $range.GetText(-1).Length
  $s = [Math]::Max(0, [Math]::Min([int]$start, $length)); $e = [Math]::Max($s, [Math]::Min([int]$end, $length))
  $range.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $range, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
  [void]$range.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, [System.Windows.Automation.Text.TextUnit]::Character, $s)
  [void]$range.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, [System.Windows.Automation.Text.TextUnit]::Character, $e)
  $range.Select()
  return "Selected " + ($e - $s) + " characters."
}

# ---- Clipboard --------------------------------------------------------------

function Clipboard-Op($action, $text) {
  switch ($action) {
    "read" { $t = Get-Clipboard -Raw -ErrorAction SilentlyContinue; return [ordered]@{ text = $(if ($null -eq $t) { "" } else { [string]$t }) } }
    "write" { Set-Clipboard -Value ([string]$text); return [ordered]@{ written = $true } }
    default { throw "The action must be read or write." }
  }
}

# ---- The loop ---------------------------------------------------------------

function Answer($id, $result) {
  $o = [ordered]@{ id = $id; ok = $true; result = $result }
  [Console]::Out.WriteLine((ConvertTo-Json $o -Compress -Depth 8))
  [Console]::Out.Flush()
}

function Refuse($id, $message) {
  $o = [ordered]@{ id = $id; ok = $false; error = $message }
  [Console]::Out.WriteLine((ConvertTo-Json $o -Compress -Depth 4))
  [Console]::Out.Flush()
}

Answer "ready" ([ordered]@{ displays = (Get-Displays) })

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq "") { continue }
  $id = $null
  try {
    $req = ConvertFrom-Json $line
    $id = $req.id
    $a = $req.args
    switch ($req.op) {
      "displays" { Answer $id (Get-Displays) }
      "screenshot" { Answer $id (Take-Screenshot $a.display $a.region $a.max $a.format $a.quality) }
      "cursor" { Answer $id (Get-Cursor) }
      "move" { Move-Pointer $a.display $a.x $a.y; Answer $id (Get-Cursor) }
      "click" { Click-At $a.display $a.x $a.y $a.button $a.count $a.modifiers; Answer $id (Get-Cursor) }
      "drag" { Drag-Pointer $a.display $a.from $a.to; Answer $id (Get-Cursor) }
      "button" { Press-Button $(if ($a.button) { $a.button } else { "left" }) $a.action; Answer $id ([ordered]@{ done = $true }) }
      "scroll" { Scroll-At $a.display $a.x $a.y $a.direction $a.amount; Answer $id ([ordered]@{ done = $true }) }
      "type" { Type-Text ([string]$a.text); Answer $id ([ordered]@{ typed = ([string]$a.text).Length }) }
      "key" { Press-Chord ([string]$a.keys) $a.repeat; Answer $id ([ordered]@{ done = $true }) }
      "hold" { Hold-Chord ([string]$a.keys) $a.seconds; Answer $id ([ordered]@{ done = $true }) }
      "apps" { Answer $id (Get-Apps) }
      "windows" { Answer $id (Get-TopWindows $a.app) }
      "open" { Answer $id (Open-App $a.app $a.path) }
      "focus" { Answer $id (Focus-Window $a.window) }
      "read_ui" { Answer $id (Read-Ui $a.window $a.depth $a.limit $a.all) }
      "act" { Answer $id ([ordered]@{ said = (Ui-Act $a.ref $a.action) }) }
      "set_value" { Answer $id ([ordered]@{ said = (Ui-SetValue $a.ref $a.value) }) }
      "select_text" { Answer $id ([ordered]@{ said = (Ui-SelectText $a.ref $a.start $a.end) }) }
      "clipboard" { Answer $id (Clipboard-Op $a.action $a.text) }
      "ping" { Answer $id ([ordered]@{ pong = $true }) }
      default { Refuse $id ("Unknown operation `"" + $req.op + "`".") }
    }
  } catch {
    $m = $_.Exception.Message
    if ($null -ne $_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
    Refuse $id $m
  }
}
