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
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
[DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
'@

[void][Studio.Native]::SetProcessDPIAware()

$script:Activity = $null
$script:MonitorUnavailable = $false
$script:InputPending = $null
try {
  Add-Type -Path (Join-Path $PSScriptRoot "activity.cs") -ReferencedAssemblies System.Drawing, System.Windows.Forms
  $script:Activity = New-Object Studio.Activity
} catch { $script:MonitorUnavailable = $true }

# Whether an argument was given. The Node side sends "" for "not given", and
# a number is compared against "" by converting "" to a number: in
# PowerShell `0 -eq ""` is TRUE, so display 0, x 0 and count 0 all read as
# absent when tested that way. Measured on 2026-09-15 as a move to display 0
# landing on display 1 - the default - every time. Only a string can be the
# empty string; a number that is given is given.
function Given($v) {
  if ($null -eq $v) { return $false }
  if ($v -is [string]) { return $v -ne "" }
  return $true
}

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
  return $list
}

# The display a point is on, by index; the primary one when it is on none.
function Display-Of([int]$x, [int]$y) {
  $all = [System.Windows.Forms.Screen]::AllScreens
  for ($i = 0; $i -lt $all.Length; $i++) {
    $b = $all[$i].Bounds
    if ($x -ge $b.X -and $x -lt $b.X + $b.Width -and $y -ge $b.Y -and $y -lt $b.Y + $b.Height) { return $i }
  }
  for ($i = 0; $i -lt $all.Length; $i++) { if ($all[$i].Primary) { return $i } }
  return 0
}

# The display of the window being worked in, by its centre. Null when there
# is no target or it has gone.
function Target-Display {
  if ($script:Target -eq 0) { return $null }
  $h = [IntPtr]$script:Target
  if (-not [Studio.Native]::IsWindow($h) -or [Studio.Native]::IsIconic($h)) { return $null }
  if ((Window-Identity (Window-Row $script:Target)) -ne $script:TargetIdentity) { return $null }
  $r = New-Object Studio.Native+RECT
  if (-not [Studio.Native]::GetWindowRect($h, [ref]$r)) { return $null }
  return Display-Of ([int](($r.Left + $r.Right) / 2)) ([int](($r.Top + $r.Bottom) / 2))
}

# With no index given, the display follows the work: the one the window
# being worked in is on, else the one the pointer is on, else the primary.
# Before this the default was always the primary, and a model working in a
# window on the second display got, with every click, a picture of the wrong
# screen - and concluded its click had done nothing.
function Resolve-Display($index) {
  $all = [System.Windows.Forms.Screen]::AllScreens
  if (-not (Given $index)) {
    $t = Target-Display
    if ($null -ne $t) { return @{ index = $t; screen = $all[$t] } }
    $p = New-Object Studio.Native+POINT
    if ([Studio.Native]::GetCursorPos([ref]$p)) { $c = Display-Of $p.X $p.Y; return @{ index = $c; screen = $all[$c] } }
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
function Take-Screenshot($display, $region, $max, $format, $quality, $window, $budget) {
  # A window handle picks the display and the region both: the rectangle the
  # window covers, clipped to the display its centre is on. The answer still
  # names that display's frame, so a point in the picture is a point to click.
  if ((Given $window) -and [int64]$window -ne 0) {
    $wh = [IntPtr][int64]$window
    if (-not [Studio.Native]::IsWindow($wh)) { throw "Window $window is no longer on screen. List windows again." }
    if ([Studio.Native]::IsIconic($wh)) { throw "Window $window is minimized, so there is nothing of it to picture. Focus it first." }
    $wr = New-Object Studio.Native+RECT
    [void][Studio.Native]::GetWindowRect($wh, [ref]$wr)
    $display = Display-Of ([int](($wr.Left + $wr.Right) / 2)) ([int](($wr.Top + $wr.Bottom) / 2))
    $db = ([System.Windows.Forms.Screen]::AllScreens[$display]).Bounds
    $region = @(($wr.Left - $db.X), ($wr.Top - $db.Y), ($wr.Right - $db.X), ($wr.Bottom - $db.Y))
  }
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
  # Sampled straight after the pixels and before encoding, so "what am I
  # pointing at" pairs this picture with this pointer, never an older one.
  $pointer = Get-Cursor
  $frontRow = $null
  try { $frontRow = Window-Row (Root-Of ([int64][Studio.Native]::GetForegroundWindow())) } catch {}
  $limit = if (-not (Given $max)) { 1568 } else { [int]$max }
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
  try { $picture = Encode-Picture $out $format $budget }
  finally {
    if ($out -ne $bmp) { $out.Dispose() }
    $bmp.Dispose()
  }
  $answer = [ordered]@{
    display = $d.index; frameWidth = $b.Width; frameHeight = $b.Height
    x = $x - $b.X; y = $y - $b.Y; width = $w; height = $h
    imageWidth = $picture.width; imageHeight = $picture.height
    mimeType = $picture.mime; data = $picture.data
    pointer = $pointer; front = $frontRow
  }
  if ($null -ne $picture.note) { $answer.note = $picture.note }
  return $answer
}

function Encoded-Bytes($bitmap, $format) {
  $ms = New-Object System.IO.MemoryStream
  try {
    if ($format -eq "jpeg") { $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg) }
    else { $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png) }
    return ,$ms.ToArray()
  } finally { $ms.Dispose() }
}

# One picture's bytes, within `budget`. PNG for a picture the model will read
# closely; JPEG for the frame that rides along with an action, where "did the
# click land" is answered as well by a smaller file.
#
# The budget is the reason a picture arrives at all. A PNG of a photo-like
# screen at 1568 pixels is two to three megabytes, and an answer larger than
# the MCP channel carries was dropped whole - the model waited out the
# request deadline for a picture that had been taken in a tenth of a second
# (2026-10-21). Over budget, a PNG becomes a JPEG of the same pixels, and a
# JPEG still over it is made smaller; the note says which, so a model wanting
# exact pixels knows to zoom into a region rather than ask again.
#
# The JPEG is saved at the library's default quality on purpose: setting one
# through EncoderParameters is a pattern Windows Defender's script scanner
# (AMSI) matches as spyware, and it blocked this whole script for it on
# 2026-09-15. `$quality` is accepted and ignored so the request shape need not
# change if that ever lifts.
function Encode-Picture($bitmap, $format, $budget) {
  $limit = if (Given $budget) { [int]$budget } else { 1000000 }
  $kind = if ($format -eq "jpeg") { "jpeg" } else { "png" }
  $bytes = Encoded-Bytes $bitmap $kind
  $note = $null
  if ($kind -eq "png" -and $bytes.Length -gt $limit) {
    $note = "Sent as JPEG: as a PNG this picture was $([Math]::Round($bytes.Length / 1MB, 1)) MB, more than one picture may be. Zoom into a region for exact pixels."
    $kind = "jpeg"
    $bytes = Encoded-Bytes $bitmap $kind
  }
  $current = $bitmap
  try {
    while ($bytes.Length -gt $limit -and [Math]::Max($current.Width, $current.Height) -gt 320) {
      $shrink = [Math]::Sqrt($limit / $bytes.Length) * 0.9
      $sw = [Math]::Max(1, [int][Math]::Round($current.Width * $shrink)); $sh = [Math]::Max(1, [int][Math]::Round($current.Height * $shrink))
      $smaller = New-Object System.Drawing.Bitmap $sw, $sh
      $g = [System.Drawing.Graphics]::FromImage($smaller)
      try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($current, 0, 0, $sw, $sh)
      } finally { $g.Dispose() }
      if ($current -ne $bitmap) { $current.Dispose() }
      $current = $smaller
      $bytes = Encoded-Bytes $current $kind
      $note = "Sent smaller, as a $($current.Width)x$($current.Height) JPEG, to stay within what one picture may be. Zoom into a region for detail."
    }
    return @{ data = [Convert]::ToBase64String($bytes); mime = "image/$kind"; width = $current.Width; height = $current.Height; note = $note }
  } finally {
    if ($current -ne $bitmap) { $current.Dispose() }
  }
}

# ---- Pointer ----------------------------------------------------------------

function To-Absolute($display, $x, $y) {
  $d = Resolve-Display $display
  return @{ x = $d.screen.Bounds.X + [int]$x; y = $d.screen.Bounds.Y + [int]$y }
}

function Control-Point($rect) {
  $cx = [int]($rect.X + $rect.Width / 2); $cy = [int]($rect.Y + $rect.Height / 2)
  $display = Display-Of $cx $cy
  $bounds = @(Get-Displays) | Where-Object { $_.index -eq $display } | Select-Object -First 1
  return @{ display = $display; x = ($cx - $bounds.x); y = ($cy - $bounds.y) }
}

# The point chooses the input target before the action, never an unrelated
# window which happens to take focus afterwards.
function Point-Window($display, $x, $y) {
  $absolute = To-Absolute $display $x $y
  $point = New-Object Studio.Native+POINT
  $point.X = $absolute.x; $point.Y = $absolute.y
  return Root-Of ([Studio.Native]::WindowFromPoint($point))
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

# INPUT is built from the inside out, never written into in place. In
# PowerShell `$i.u.mi.dwFlags = $flags` reads `$i.u` - a struct, a value -
# into a copy, sets the copy, and drops it; `$i` is unchanged and what
# reaches SendInput is an event with every field zero. Windows accepts a
# zero event (SendInput answers 1) and it means nothing: no button, key code
# 0, character 0. Measured on 2026-09-15 as every click, drag, key and typed
# character since the driver was written reported sent and arriving nowhere,
# while the pointer moved (SetCursorPos) and UI Automation worked, which is
# what made it look like a focus problem. Assigning whole structs upward is
# the one form that persists.
function New-Input([uint32]$type, $union) {
  $i = New-Object Studio.Native+INPUT
  $i.type = $type
  $i.u = $union
  return $i
}

function Send-Inputs([Studio.Native+INPUT[]]$inputs, $what) {
  $sent = [Studio.Native]::SendInput($inputs.Count, $inputs, [System.Runtime.InteropServices.Marshal]::SizeOf([type][Studio.Native+INPUT]))
  if ($sent -ne $inputs.Count) { throw "Windows refused the $what. A window that runs as administrator cannot be driven from here." }
}

function Send-Mouse([uint32]$flags, [int]$data) {
  $mi = New-Object Studio.Native+MOUSEINPUT
  $mi.dwFlags = $flags
  # mouseData is a DWORD that Windows reads as a signed wheel delta, so a
  # scroll down (-120) is the same 32 bits reinterpreted. `[uint32]-120` is
  # a conversion, not a reinterpretation, and PowerShell refuses it: measured
  # on 2026-09-15 as `Cannot convert "-240" to UInt32` on every scroll down.
  $mi.mouseData = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$data), 0)
  $u = New-Object Studio.Native+INPUTUNION
  $u.mi = $mi
  Send-Inputs ([Studio.Native+INPUT[]]@((New-Input 0 $u))) "mouse input"
}

# A move is an input event, not a teleport. SetCursorPos puts the pointer
# somewhere without telling the window under it that anything moved, and a
# canvas that draws on the move stream between a press and a release sees
# down, then up, then nothing in between: measured on 2026-09-15 as Paint
# committing "0 x 0px" shapes for half of all drags, and dropping an instant
# click on the canvas while the ribbon took the same click every time. So a
# move is injected (absolute, on the virtual desktop), and SetCursorPos then
# pins the exact pixel that the 16-bit scale may have rounded.
function Send-MouseTo([int]$ax, [int]$ay, [uint32]$extraFlags) {
  $vx = [Studio.Native]::GetSystemMetrics(76); $vy = [Studio.Native]::GetSystemMetrics(77)
  $vw = [Studio.Native]::GetSystemMetrics(78); $vh = [Studio.Native]::GetSystemMetrics(79)
  $mi = New-Object Studio.Native+MOUSEINPUT
  $mi.dx = [int][Math]::Round((($ax - $vx) * 65535.0) / [Math]::Max(1, $vw - 1))
  $mi.dy = [int][Math]::Round((($ay - $vy) * 65535.0) / [Math]::Max(1, $vh - 1))
  $mi.dwFlags = [uint32](0x0001 -bor 0x8000 -bor 0x4000 -bor $extraFlags)
  $u = New-Object Studio.Native+INPUTUNION
  $u.mi = $mi
  Send-Inputs ([Studio.Native+INPUT[]]@((New-Input 0 $u))) "pointer move"
}

function Move-Pointer($display, $x, $y) {
  $a = To-Absolute $display $x $y
  Send-MouseTo $a.x $a.y 0
  [void][Studio.Native]::SetCursorPos($a.x, $a.y)
  Start-Sleep -Milliseconds 20
}

# Whether a point of a display lies inside the window being worked in. A
# drag that starts seven pixels above a canvas draws nothing and says so
# nowhere; this lets the answer say it.
function Outside-Target($display, $x, $y) {
  if ($script:Target -eq 0) { return $false }
  $h = [IntPtr]$script:Target
  if (-not [Studio.Native]::IsWindow($h)) { return $false }
  $r = New-Object Studio.Native+RECT
  [void][Studio.Native]::GetWindowRect($h, [ref]$r)
  $a = To-Absolute $display $x $y
  return ($a.x -lt $r.Left -or $a.x -ge $r.Right -or $a.y -lt $r.Top -or $a.y -ge $r.Bottom)
}

$ButtonFlags = @{
  left = @{ down = 0x0002; up = 0x0004 }
  right = @{ down = 0x0008; up = 0x0010 }
  middle = @{ down = 0x0020; up = 0x0040 }
}
$script:HeldButtons = @{}
$script:HeldKeys = @{}

function Press-Button($button, $direction) {
  $b = $ButtonFlags[$button]
  if ($null -eq $b) { throw "The button must be left, right or middle." }
  Send-Mouse $b[$direction] 0
  if ($direction -eq "down") { $script:HeldButtons[$button] = $true }
  else { $script:HeldButtons.Remove($button) }
}

function Click-At($display, $x, $y, $button, $count, $modifiers) {
  # The move, then a beat for the window to take it, so the press lands on
  # a control that knows the pointer is over it. 50 ms is what a person's
  # hand gives it; a press in the same instant as the move is what a canvas
  # drops.
  if ((Given $x)) { Move-Pointer $display $x $y; Start-Sleep -Milliseconds 50 }
  $b = if (-not (Given $button)) { "left" } else { $button }
  $n = if (-not (Given $count)) { 1 } else { [int]$count }
  $held = Press-Modifiers $modifiers $true
  try {
    for ($i = 0; $i -lt $n; $i++) {
      Press-Button $b "down"; Start-Sleep -Milliseconds 40; Press-Button $b "up"
      if ($i -lt $n - 1) { Start-Sleep -Milliseconds 60 }
    }
  } finally { Press-Modifiers $held $false | Out-Null }
}

# A drag the way a hand does it: arrive, settle, press, settle, move in
# steps with time between them, arrive at the end, settle, release. Every
# position is an injected move (see Move-Pointer), so the window sees the
# whole stream and not just its two ends.
function Drag-Pointer($display, $from, $to) {
  $fx = [int]$from[0]; $fy = [int]$from[1]; $tx = [int]$to[0]; $ty = [int]$to[1]
  Move-Pointer $display $fx $fy
  Start-Sleep -Milliseconds 60
  Press-Button "left" "down"
  Start-Sleep -Milliseconds 80
  $steps = [Math]::Max(6, [Math]::Min(24, [int]([Math]::Sqrt(($tx - $fx) * ($tx - $fx) + ($ty - $fy) * ($ty - $fy)) / 25)))
  for ($s = 1; $s -le $steps; $s++) {
    Move-Pointer $display ([int]($fx + ($tx - $fx) * $s / $steps)) ([int]($fy + ($ty - $fy) * $s / $steps))
    Start-Sleep -Milliseconds 20
  }
  Move-Pointer $display $tx $ty
  Start-Sleep -Milliseconds 60
  Press-Button "left" "up"
  Start-Sleep -Milliseconds 60
}

function Scroll-At($display, $x, $y, $direction, $amount) {
  if ((Given $x)) { Move-Pointer $display $x $y }
  $ticks = if (-not (Given $amount)) { 3 } else { [int]$amount }
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

function New-KeyInput([uint16]$vk, [uint16]$scan, [uint32]$flags) {
  $ki = New-Object Studio.Native+KEYBDINPUT
  $ki.wVk = $vk
  $ki.wScan = $scan
  $ki.dwFlags = $flags
  $u = New-Object Studio.Native+INPUTUNION
  $u.ki = $ki
  return (New-Input 1 $u)
}

function Send-Key([int]$vk, [bool]$down) {
  $flags = 0
  if ($ExtendedKeys -contains $vk) { $flags = $flags -bor 0x0001 }
  if (-not $down) { $flags = $flags -bor 0x0002 }
  $scan = [uint16][Studio.Native]::MapVirtualKeyW([uint32]$vk, 0)
  Send-Inputs ([Studio.Native+INPUT[]]@((New-KeyInput ([uint16]$vk) $scan ([uint32]$flags)))) "key"
  if ($down) { $script:HeldKeys[$vk] = $true }
  else { $script:HeldKeys.Remove($vk) }
}

function Release-HeldInput {
  foreach ($button in @($script:HeldButtons.Keys)) { try { Press-Button $button "up" } catch {} }
  foreach ($key in @($script:HeldKeys.Keys)) { try { Send-Key $key $false } catch {} }
}

# Modifiers named in "ctrl+shift" form; returns the codes held so they can be
# released in reverse in a finally, even when the middle throws.
function Press-Modifiers($spec, [bool]$down) {
  if (-not (Given $spec) -or $spec.Count -eq 0) { return @() }
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
  $n = if (-not (Given $repeat)) { 1 } else { [int]$repeat }
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
    $down = New-KeyInput 0 ([uint16]$ch) 0x0004
    $up = New-KeyInput 0 ([uint16]$ch) (0x0004 -bor 0x0002)
    Send-Inputs ([Studio.Native+INPUT[]]@($down, $up)) "character"
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

# Lists come back plain and are wrapped with @() where they are consumed.
# `return ,$list` - the usual trick for keeping an array whole - hands a caller
# ONE item when the list is empty (the empty array itself), so `@(...)` at the
# caller counts 1 and `[0].title` is null. Measured on 2026-09-15 as "open"
# reporting a window called "null" that could not be focused, on a machine
# with no such window at all.
function Get-TopWindows($app) {
  $script:Windows = @()
  [void][Studio.Native]::EnumWindows($script:Enum, [IntPtr]::Zero)
  $script:Windows = @($script:Windows | Where-Object { $null -eq $script:Activity -or -not $script:Activity.IsOverlay($_.handle) })
  $fg = [int64][Studio.Native]::GetForegroundWindow()
  $procs = @{}
  $starts = @{}
  foreach ($w in $script:Windows) {
    if (-not $procs.ContainsKey($w.pid)) {
      $p = Get-Process -Id $w.pid -ErrorAction SilentlyContinue
      $procs[$w.pid] = if ($null -ne $p) { $p.ProcessName } else { "" }
      $starts[$w.pid] = try { [string]$p.StartTime.ToUniversalTime().Ticks } catch { "" }
    }
    $w.app = $procs[$w.pid]
    $w.processStarted = $starts[$w.pid]
    $w.foreground = ($w.handle -eq $fg)
    $w.target = ($w.handle -eq $script:Target)
    $w.display = Display-Of ([int]($w.x + $w.width / 2)) ([int]($w.y + $w.height / 2))
  }
  $list = $script:Windows
  if ((Given $app)) {
    $needle = $app.ToLowerInvariant()
    $list = @($list | Where-Object { $_.app.ToLowerInvariant() -like "*$needle*" -or $_.title.ToLowerInvariant() -like "*$needle*" })
  }
  return $list
}

function Get-Apps {
  $byName = @{}
  foreach ($w in (Get-TopWindows $null)) {
    if (-not $byName.ContainsKey($w.app)) { $byName[$w.app] = [ordered]@{ app = $w.app; pid = $w.pid; windows = 0; foreground = $false } }
    $byName[$w.app].windows += 1
    if ($w.foreground) { $byName[$w.app].foreground = $true }
  }
  return @($byName.Values | Sort-Object { $_.app })
}

# ---- The target -------------------------------------------------------------
#
# Keys and text go to whatever window Windows has in front, and that window is
# not necessarily the one the model was working in: the person may have
# clicked somewhere, an app may have raised a dialog, a launch may have landed
# on another monitor. On 2026-09-15 a read of "the window in front" answered
# with the person's own Notepad, and the value set through the reference it
# returned replaced their notes. So the driver keeps a target: the window the
# model last opened, focused, read, clicked in or acted on. Reading with no
# handle reads the target, never the foreground; keys and text are refused
# when the target is not the window in front, or when there is no target yet.
# A click by coordinate chooses a window the way a person's click does, and
# becomes the target for the same reason.

$script:Target = [int64]0
$script:TargetIdentity = ""
# The window an adopted dialog came from, to work in again once it closes.
$script:Owner = [int64]0
$script:OwnerIdentity = ""
$script:ResumedTo = [int64]0

function Set-Target($handle) {
  if ($null -ne $handle -and [int64]$handle -ne 0) {
    # A click inside an adopted dialog keeps its owner to return to.
    if ([int64]$handle -ne $script:Target) { $script:Owner = [int64]0; $script:OwnerIdentity = "" }
    $script:Target = [int64]$handle
    $script:TargetIdentity = Window-Identity (Window-Row $handle)
  }
}

# A dialog the target raised - Save as, a "save changes?" prompt - is part of
# the work, not a stranger in front. Measured on 2026-10-21: Notepad's Save as
# found by wait_for_window refused every key until it was focused by a handle
# the model could not know in advance, so "open the dialog, then type into
# it" took a second batch. Adopted only when it is in front, owned (directly
# or through its owner chain) by the target, and of the target's own process
# run; a window that merely shares the app is never adopted, because the
# person's own Notepad does.
function Owned-ByTarget($window) {
  if ($script:Target -eq 0 -or $null -eq $window -or -not $window.foreground) { return $false }
  if ([int64]$window.handle -eq $script:Target) { return $false }
  $target = Window-Row $script:Target
  if ((Window-Identity $target) -ne $script:TargetIdentity) { return $false }
  if ($window.pid -ne $target.pid -or $window.processStarted -ne $target.processStarted) { return $false }
  $h = [IntPtr][int64]$window.handle
  for ($i = 0; $i -lt 8; $i++) {
    $h = [Studio.Native]::GetWindow($h, 4)
    if ($h -eq [IntPtr]::Zero) { return $false }
    if ((Root-Of ([int64]$h)) -eq $script:Target) { return $true }
  }
  return $false
}

function Adopt-Dialog($handle) {
  $owner = $script:Target; $ownerIdentity = $script:TargetIdentity
  Set-Target $handle
  $script:Owner = $owner; $script:OwnerIdentity = $ownerIdentity
}

# Once an adopted dialog has closed, its owner is the target again - the
# window the work was in before the dialog, unchanged in identity. Nothing
# else is chosen in its place.
function Resume-Owner {
  if ($script:Owner -eq 0) { return }
  if ($script:Target -ne 0 -and (Window-Identity (Window-Row $script:Target)) -eq $script:TargetIdentity) { return }
  $owner = $script:Owner; $identity = $script:OwnerIdentity
  $script:Owner = [int64]0; $script:OwnerIdentity = ""
  if ((Window-Identity (Window-Row $owner)) -ne $identity) { return }
  $script:Target = $owner; $script:TargetIdentity = $identity
  $script:ResumedTo = $owner
}

# The top-level window a handle belongs to: what `windows` would list.
function Root-Of($handle) {
  $h = [IntPtr][int64]$handle
  if ($h -eq [IntPtr]::Zero) { return [int64]0 }
  $root = [Studio.Native]::GetAncestor($h, 2)
  if ($root -eq [IntPtr]::Zero) { return [int64]$h }
  return [int64]$root
}

function Describe-Window($handle) {
  $t = Get-WindowTitle ([IntPtr][int64]$handle)
  if ($t -eq "") { return "window $handle" }
  return "`"$t`" (window $handle)"
}

# Whether the window in front is the target, counting the target's own
# children as itself. A Store app (Calculator, Notepad, Settings) keeps its
# keyboard focus in a CoreWindow parented to the frame window that `windows`
# lists, so the foreground handle differs from the frame's while the person
# would say it is the same window. Measured on 2026-09-15 as every key to a
# freshly opened Calculator being refused as "not the one being worked in".
function Same-Window($front, $target) {
  if ($front -eq $target) { return $true }
  if ($front -eq 0 -or $target -eq 0) { return $false }
  $f = [IntPtr]$front; $t = [IntPtr]$target
  if ([Studio.Native]::IsChild($t, $f)) { return $true }
  return ([int64][Studio.Native]::GetAncestor($f, 2) -eq $target)
}

# Called before anything that goes to the keyboard focus.
function Assert-Target($what) {
  Resume-Owner
  if ($script:Target -eq 0) {
    throw "Nothing has been chosen to $what into yet. Open or focus a window, read it and focus a control, or click where the input should go, and then $what."
  }
  if ((Window-Identity (Window-Row $script:Target)) -ne $script:TargetIdentity) {
    throw "The target window closed or changed identity. Nothing was sent. List windows and choose the intended window again."
  }
  $fg = [int64][Studio.Native]::GetForegroundWindow()
  if (-not (Same-Window $fg $script:Target)) {
    $mine = Describe-Window $script:Target
    $front = if ($fg -eq 0) { "no window" } else { Describe-Window $fg }
    throw "The window in front is $front, not $mine, which is the one being worked in. Nothing was sent. Focus the window you mean (focus, or open, or a click inside it) before you $what."
  }
}

# Called after keys have gone out. The check before them is a moment earlier
# than the keys, and a window can come to the front in between - a dialog, a
# person's click, a window another program raises. Keys already sent cannot
# be taken back, and "done" would be a lie about where they went, so the
# answer carries a note naming the window now in front. A note and not a
# refusal, because a chord is often meant to change the front: Alt+F4 closes
# the target, Ctrl+N opens a second window, Return dismisses a dialog.
function Front-Note {
  Resume-Owner
  $fg = [int64][Studio.Native]::GetForegroundWindow()
  if (Same-Window $fg $script:Target) { return $null }
  $mine = Describe-Window $script:Target
  $front = if ($fg -eq 0) { "no window" } else { Describe-Window $fg }
  return "The window in front is now $front, not $mine. Keys that went out after the change landed there; check what arrived before going on."
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
    # A process is allowed to change the foreground if it sent the last input
    # event. A zero-length pointer move is an input event that moves nothing,
    # and it is what turns a refused SetForegroundWindow (measured as
    # asked=false on 2026-09-15, from a driver whose only prior act was
    # listing windows) into an accepted one.
    Send-Mouse 0x0001 0
    $ok = [Studio.Native]::SetForegroundWindow($h)
    if (-not $ok) { Start-Sleep -Milliseconds 50; $ok = [Studio.Native]::SetForegroundWindow($h) }
    # Still refused: the foreground lock. A tap of Alt on its own is the
    # long-standing way to release it - Windows treats it as the person
    # reaching for a menu - and it changes nothing in the window that has it.
    if (-not $ok) {
      Send-Key 0x12 $true; Send-Key 0x12 $false
      Start-Sleep -Milliseconds 30
      $ok = [Studio.Native]::SetForegroundWindow($h)
    }
  } finally { if ($attached) { [void][Studio.Native]::AttachThreadInput($me, $fgThread, $false) } }
  Start-Sleep -Milliseconds 150
  # In front is not the same as taking keys. A Store app (Calculator, Notepad,
  # Settings) is a frame window whose keyboard focus lives in a child
  # CoreWindow, and raising the frame leaves that child unfocused: measured
  # on 2026-09-15 as Escape, digits and Alt+F4 accepted and going nowhere.
  # What a person's click does is put the focus on a control inside; UI
  # Automation's SetFocus on the first focusable descendant does the same.
  # Left alone when the focus is already inside the window.
  try {
    $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle($h)
    $focusedNow = [System.Windows.Automation.AutomationElement]::FocusedElement
    $inside = $false
    try { $inside = ($null -ne $focusedNow) -and (Same-Window ([int64]$focusedNow.Current.NativeWindowHandle) ([int64]$handle)) } catch {}
    if (-not $inside) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty, $true)
      $first = $rootEl.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($null -ne $first) { $first.SetFocus(); Start-Sleep -Milliseconds 100 }
    }
  } catch {}
  $focused = (Same-Window ([int64][Studio.Native]::GetForegroundWindow()) ([int64]$handle))
  if ($focused) { Set-Target $handle }
  return [ordered]@{ focused = $focused; asked = [bool]$ok; handle = [int64]$handle; title = (Get-WindowTitle $h) }
}

# The window a launch produced: the first visible top-level window that was
# not there before, waited for up to five seconds. A launch that answered
# "started" and nothing else left the model to guess which window was its,
# and guessing is the one thing the target rule exists to end. Named by
# handle so the model can read it and act in it without ever asking for
# "the window in front".
function Wait-NewWindow($before, $hint) {
  $known = @{}
  foreach ($w in $before) { $known[[int64]$w.handle] = $true }
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $now = @(Get-TopWindows $null)
    $fresh = @($now | Where-Object { -not $known.ContainsKey([int64]$_.handle) -and -not $_.minimized })
    if ($fresh.Count -eq 0) { continue }
    if ((Given $hint)) {
      $needle = $hint.ToLowerInvariant()
      $named = @($fresh | Where-Object { $_.app.ToLowerInvariant() -like "*$needle*" -or $_.title.ToLowerInvariant() -like "*$needle*" })
      if ($named.Count -gt 0) { return Select-UniqueWindow $named }
      continue
    }
    return Select-UniqueWindow $fresh
  }
  return $null
}

function Select-UniqueWindow($windows) {
  $choices = @($windows)
  if ($choices.Count -ne 1) {
    $handles = ($choices | Select-Object -First 10 | ForEach-Object { [string]$_.handle }) -join ", "
    throw "More than one window matches ($handles). List windows and focus the intended handle explicitly; nothing was selected."
  }
  return $choices[0]
}

# What the screen shows of the window being worked in (else the one in
# front), as a hash: enough to tell "still changing" from "settled". Pixels are
# copied and hashed by .NET, never walked in script. Empty when there is no
# window to look at or the copy fails; an empty signature never counts as
# settled on its own.
function Screen-Signature {
  $h = if ($script:Target -ne 0) { $script:Target } else { [int64][Studio.Native]::GetForegroundWindow() }
  $r = New-Object Studio.Native+RECT
  if ($h -eq 0 -or -not [Studio.Native]::GetWindowRect([IntPtr]$h, [ref]$r)) { return "" }
  $w = [Math]::Min($r.Right - $r.Left, 4096); $ht = [Math]::Min($r.Bottom - $r.Top, 4096)
  if ($w -le 0 -or $ht -le 0) { return "" }
  $bitmap = New-Object System.Drawing.Bitmap $w, $ht, ([System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
  try {
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    try { $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $ht)) } finally { $g.Dispose() }
    $data = $bitmap.LockBits((New-Object System.Drawing.Rectangle 0, 0, $w, $ht), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $bitmap.PixelFormat)
    try {
      $bytes = New-Object byte[] ($data.Stride * $ht)
      [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    } finally { $bitmap.UnlockBits($data) }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($sha.ComputeHash($bytes)) } finally { $sha.Dispose() }
  } catch { return "" } finally { $bitmap.Dispose() }
}

# How long an action is given to show its effect: until the window state and
# its pixels are the same on three samples in a row, at least SettleMinMs and
# at most SettleMaxMs (the fixed wait this replaced). Most input settles in a
# few hundred milliseconds; a page that keeps changing still gets the full wait.
$script:SettleMinMs = 300
$script:SettleMaxMs = 800
$script:SettleSampleMs = 100

# These are observations, not proof that an application's intended operation
# completed. Recovery candidates never grant input authority to another window.
function Observe-Action($before, $beforeWindows, $observationId) {
  $after = $null
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $slept = 0
  $previous = $null
  $same = 0
  while ($true) {
    Start-Sleep -Milliseconds $script:SettleSampleMs
    $slept += $script:SettleSampleMs
    $after = Get-Status
    $signature = (ConvertTo-Json @($after.target, $after.front) -Compress -Depth 4) + "|" + (Screen-Signature)
    if ($signature -eq $previous -and -not $signature.EndsWith("|")) { $same += 1 } else { $same = 0 }
    $previous = $signature
    $elapsed = [Math]::Max($clock.ElapsedMilliseconds, $slept)
    if ($elapsed -ge $script:SettleMaxMs -or ($same -ge 2 -and $elapsed -ge $script:SettleMinMs)) { break }
  }
  $now = @(Get-TopWindows $null)
  $oldIdentities = @{}; $newIdentities = @{}
  foreach ($window in $beforeWindows) { $oldIdentities[(Window-Identity $window)] = $true }
  foreach ($window in $now) { $newIdentities[(Window-Identity $window)] = $true }
  $opened = @($now | Where-Object { -not $oldIdentities.ContainsKey((Window-Identity $_)) })
  $closed = @($beforeWindows | Where-Object { -not $newIdentities.ContainsKey((Window-Identity $_)) })
  $previous = $before.target
  $gone = $null -ne $previous -and (Window-Identity (Window-Row $previous.handle)) -ne (Window-Identity $previous)
  # An adopted dialog that closed hands the work back to its owner.
  $returned = $gone -and $null -ne $after.target -and [int64]$after.target.handle -eq $script:ResumedTo
  if ($returned) { $gone = $false }
  $candidates = @()
  if ($gone) {
    $candidates = @($now | Where-Object { $_.app -eq $previous.app -and -not $_.minimized })
  }
  return [ordered]@{
    observationId = $observationId; available = $true; waitedMs = [int][Math]::Max($clock.ElapsedMilliseconds, $slept)
    previousTarget = $previous; target = $after.target; front = $after.front
    targetGone = $gone; targetInFront = $after.targetInFront; returnedToOwner = $returned
    newWindows = @($opened | Select-Object -First 20)
    closedWindows = @($closed | Select-Object -First 20)
    candidates = @($candidates | Select-Object -First 20)
    truncated = ($opened.Count -gt 20 -or $closed.Count -gt 20 -or $candidates.Count -gt 20)
    # References outlive Studio's own input: each is checked when used, and
    # refused if its window changed identity or its control is gone. Only the
    # person's own input, a new read, or the window going clears them.
    refsInvalidated = ($script:RefsEpoch -eq "" -or $gone)
  }
}

function Open-App($app, $path) {
  $before = @(Get-TopWindows $null)
  if ((Given $path)) {
    $p = Start-Process -FilePath $path -PassThru
    $w = Wait-NewWindow $before ([System.IO.Path]::GetFileNameWithoutExtension($path))
    $focused = $false
    if ($null -ne $w) { $focused = (Focus-Window $w.handle).focused }
    return [ordered]@{ started = $true; focused = $focused; pid = $p.Id; what = $path; handle = $(if ($null -ne $w) { $w.handle } else { 0 }); window = $(if ($null -ne $w) { $w.title } else { "" }) }
  }
  if (-not (Given $app)) { throw "Say which app to open, or give a path." }
  # Already running with a window: bring it forward rather than start a second.
  $existing = @(Get-TopWindows $app)
  if ($existing.Count -gt 0) {
    $chosen = Select-UniqueWindow $existing
    $f = Focus-Window $chosen.handle
    return [ordered]@{ started = $false; focused = $f.focused; window = $chosen.title; pid = $chosen.pid; handle = $chosen.handle }
  }
  $needle = $app.ToLowerInvariant()
  $starts = @(Get-StartApps | Where-Object { $_.Name.ToLowerInvariant() -eq $needle })
  if ($starts.Count -eq 0) { $starts = @(Get-StartApps | Where-Object { $_.Name.ToLowerInvariant() -like "*$needle*" }) }
  if ($starts.Count -eq 0) { throw "No app called `"$app`" is installed. Names are as they appear in the Start menu." }
  if ($starts.Count -gt 1) { throw "More than one installed app matches. Give an exact app name or program path." }
  Start-Process -FilePath "explorer.exe" -ArgumentList ("shell:AppsFolder\" + $starts[0].AppID)
  $w = Wait-NewWindow $before $app
  $focused = $false
  if ($null -ne $w) { $focused = (Focus-Window $w.handle).focused }
  return [ordered]@{ started = $true; focused = $focused; what = $starts[0].Name; handle = $(if ($null -ne $w) { $w.handle } else { 0 }); window = $(if ($null -ne $w) { $w.title } else { "" }) }
}

# ---- Bearings ---------------------------------------------------------------
#
# Where the work is: the window being worked in, whether it is the one in
# front, which display it is on, and what is in front if not. The one call to
# make on getting lost, and cheap enough to make before anything that matters.

function Window-Row($handle) {
  $h = [IntPtr][int64]$handle
  if ($h -eq [IntPtr]::Zero -or -not [Studio.Native]::IsWindow($h)) { return $null }
  $r = New-Object Studio.Native+RECT
  [void][Studio.Native]::GetWindowRect($h, [ref]$r)
  $owner = [uint32]0
  [void][Studio.Native]::GetWindowThreadProcessId($h, [ref]$owner)
  $p = Get-Process -Id $owner -ErrorAction SilentlyContinue
  $started = try { [string]$p.StartTime.ToUniversalTime().Ticks } catch { "" }
  return [ordered]@{
    handle = [int64]$h; title = (Get-WindowTitle $h); app = $(if ($null -ne $p) { $p.ProcessName } else { "" }); pid = [int]$owner; processStarted = $started
    x = $r.Left; y = $r.Top; width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top)
    minimized = [Studio.Native]::IsIconic($h); maximized = [Studio.Native]::IsZoomed($h)
    display = (Display-Of ([int](($r.Left + $r.Right) / 2)) ([int](($r.Top + $r.Bottom) / 2)))
  }
}

function Get-Status {
  Resume-Owner
  $fg = [int64][Studio.Native]::GetForegroundWindow()
  $target = Window-Row $script:Target
  $gone = ($script:Target -ne 0 -and ($null -eq $target -or (Window-Identity $target) -ne $script:TargetIdentity))
  if ($gone) { $script:Target = [int64]0; $script:TargetIdentity = ""; $target = $null }
  return [ordered]@{
    target = $target
    targetGone = $gone
    targetInFront = $(if ($null -ne $target) { Same-Window $fg $script:Target } else { $false })
    front = (Window-Row (Root-Of $fg))
    cursor = (Get-Cursor)
    displays = @(Get-Displays)
  }
}

# ---- Arranging windows ------------------------------------------------------
#
# What a person does with the title bar and its buttons: put a window where
# it can be seen whole. A maximized window on a known display is the one
# arrangement that ends "which of these is mine" - nothing else overlaps it
# and every picture of that display is a picture of it.

function Arrange-Window($handle, $action, $display, $x, $y, $width, $height) {
  $h = [IntPtr][int64]$handle
  if ($h -eq [IntPtr]::Zero -or -not [Studio.Native]::IsWindow($h)) { throw "Window $handle is no longer on screen. List windows again." }
  $SWP_NOSIZE = 0x0001; $SWP_NOMOVE = 0x0002; $SWP_NOZORDER = 0x0004; $SWP_NOACTIVATE = 0x0010
  switch ($action) {
    "maximize" {
      # A maximize lands on the display the window is on, so a move there
      # comes first when another display was asked for.
      if ((Given $display)) {
        $b = (Resolve-Display $display).screen.Bounds
        if ([Studio.Native]::IsZoomed($h)) { [void][Studio.Native]::ShowWindow($h, 9); Start-Sleep -Milliseconds 100 }
        [void][Studio.Native]::SetWindowPos($h, [IntPtr]::Zero, $b.X + 40, $b.Y + 40, 0, 0, ($SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE))
      }
      [void][Studio.Native]::ShowWindow($h, 3)
    }
    "minimize" { [void][Studio.Native]::ShowWindow($h, 6) }
    "restore" { [void][Studio.Native]::ShowWindow($h, 9) }
    "move" {
      if (-not (Given $x) -or -not (Given $y)) { throw "Give x and y for a move, in the pixels of the display (display picks which)." }
      $a = To-Absolute $display $x $y
      if ([Studio.Native]::IsZoomed($h)) { [void][Studio.Native]::ShowWindow($h, 9); Start-Sleep -Milliseconds 100 }
      [void][Studio.Native]::SetWindowPos($h, [IntPtr]::Zero, $a.x, $a.y, 0, 0, ($SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE))
    }
    "resize" {
      if (-not (Given $width) -or -not (Given $height)) { throw "Give width and height for a resize." }
      if ([Studio.Native]::IsZoomed($h)) { [void][Studio.Native]::ShowWindow($h, 9); Start-Sleep -Milliseconds 100 }
      [void][Studio.Native]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, [int]$width, [int]$height, ($SWP_NOMOVE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE))
    }
    "close" {
      # WM_CLOSE, which is the title bar's X: the app gets to ask about
      # unsaved work rather than being killed with it.
      [void][Studio.Native]::PostMessageW($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 300
      if (-not [Studio.Native]::IsWindow($h) -and $script:Target -eq [int64]$h) { $script:Target = [int64]0 }
      return [ordered]@{ closed = (-not [Studio.Native]::IsWindow($h)); handle = [int64]$handle }
    }
    default { throw "The action must be maximize, minimize, restore, move, resize or close." }
  }
  Start-Sleep -Milliseconds 150
  return (Window-Row $handle)
}

# A window that is not there yet: a dialog a click will raise, a file that
# takes a moment to open. Waits up to `seconds` for a visible top-level
# window whose app or title contains the text, and names it by handle.
function Wait-ForWindow($text, $seconds) {
  if (-not (Given $text)) { throw "Say which window to wait for: part of its title or its app." }
  $limit = if (-not (Given $seconds)) { 10 } else { [Math]::Min([double]$seconds, 60) }
  $deadline = [DateTime]::UtcNow.AddSeconds($limit)
  $needle = $text.ToLowerInvariant()
  while ($true) {
    $found = @(Get-TopWindows $null | Where-Object { -not $_.minimized -and ($_.app.ToLowerInvariant() -like "*$needle*" -or $_.title.ToLowerInvariant() -like "*$needle*") })
    if ($found.Count -gt 0) {
      $pick = Select-UniqueWindow $found
      $adopted = Owned-ByTarget $pick
      if ($adopted) { Adopt-Dialog $pick.handle }
      return [ordered]@{ found = $true; handle = $pick.handle; title = $pick.title; app = $pick.app; display = $pick.display; foreground = $pick.foreground; adopted = $adopted }
    }
    if ([DateTime]::UtcNow -ge $deadline) { return [ordered]@{ found = $false; waited = $limit } }
    Start-Sleep -Milliseconds 250
  }
}

# ---- Accessibility ----------------------------------------------------------

$script:Refs = @{}
$script:RefsWindow = [int64]0
$script:RefsEpoch = ""
$script:RefsIdentity = ""

function Window-Identity($window) {
  if ($null -eq $window) { return "" }
  return "$($window.handle)/$($window.pid)/$($window.processStarted)"
}

function Reset-UiRefs {
  $script:Refs = @{}
  $script:RefsEpoch = ""
  $script:RefsIdentity = ""
}

function Begin-UiRead($window, $observationId) {
  Reset-UiRefs
  $script:RefsWindow = $window
  $script:RefsEpoch = [string]$observationId
  $script:RefsIdentity = Window-Identity (Window-Row $window)
}

# The handle a read walks: the one given, else the target. Never the window in
# front - see the target rule above.
function Ui-Handle($window) {
  if ((Given $window)) { return [int64]$window }
  if ($script:Target -eq 0) { throw "Say which window to read: give a handle from windows, or open or focus a window first. Reading whatever is in front is not done, because that may be the person's own window." }
  return $script:Target
}

function Ui-Root($window) {
  $h = Ui-Handle $window
  if (-not [Studio.Native]::IsWindowVisible([IntPtr]$h)) { throw "Window $h is no longer on screen. List windows again." }
  return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$h)
}

$Interactive = @("button", "check box", "radio button", "combo box", "edit", "hyperlink", "list item", "menu item", "tab item", "slider", "spinner", "split button", "tree item", "document", "menu bar", "menu", "list", "tab", "tool bar", "data item", "header item")

function Read-Ui($window, $depth, $limit, $all) {
  Begin-UiRead (Ui-Handle $window) $script:ObservationId
  $root = Ui-Root $window
  # Reading a window is choosing it: the refs it hands out belong to it, and
  # what the model does with them next happens there.
  Set-Target $script:RefsWindow
  $maxDepth = if (-not (Given $depth)) { 12 } else { [int]$depth }
  $maxLines = if (-not (Given $limit)) { 400 } else { [int]$limit }
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
      $point = Control-Point $rect
      $parts += "display $($point.display) @($($point.x),$($point.y))"
      $parts += "[ui_$($script:RefsEpoch)_$counter]"
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
  return [ordered]@{ window = $title; handle = $script:RefsWindow; observationId = $script:RefsEpoch; minimized = $minimized; outline = ($lines -join "`n") }
}

function Ui-Ref($ref) {
  if ($null -ne $script:Activity) { Collect-UserInput }
  if ($ref -notmatch '^ui_([0-9a-f-]{36})_(\d+)$') { throw "That element reference is invalid or stale. Read the window again and copy the complete reference." }
  $epoch = $Matches[1]; $n = [int]$Matches[2]
  if ($epoch -ne $script:RefsEpoch -or $script:RefsIdentity -eq "" -or
      (Window-Identity (Window-Row $script:RefsWindow)) -ne $script:RefsIdentity) {
    throw "That element reference belongs to an older observation or window. Read the window again."
  }
  $el = $script:Refs[$n]
  if ($null -eq $el) { throw "That element reference is not in the latest observation. Read the window again." }
  try { [void]$el.Current.Name; $offscreen = $el.Current.IsOffscreen } catch { throw "That element reference is no longer on screen. Read the window again." }
  if ($offscreen) { throw "That control is not on screen now (scrolled away, or its panel closed). Read the window again." }
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

function Needs-ActionObservation($operation, $arguments) {
  if ($operation -eq "button" -and $arguments.action -eq "up") { return $false }
  return $operation -in @("move", "click", "drag", "button", "scroll", "type", "key", "hold", "open", "focus", "arrange", "act", "set_value", "select_text")
}

function Collect-UserInput {
  if ($null -eq $script:Activity) { return }
  try { $inputState = $script:Activity.Read() }
  catch {
    if ($null -eq $script:InputPending) { $script:InputPending = @{ available = $false; moves = 0; buttons = 0; wheels = 0; keys = 0 } }
    else { $script:InputPending.available = $false }
    return
  }
  $changed = $inputState.Moves + $inputState.Buttons + $inputState.Wheels + $inputState.Keys -gt 0
  if ($changed) { Reset-UiRefs }
  if (-not $changed -and $inputState.Available) {
    if ($null -ne $script:InputPending) {
      if ($script:InputPending.moves + $script:InputPending.buttons + $script:InputPending.wheels + $script:InputPending.keys -eq 0) { $script:InputPending = $null }
      else { $script:InputPending.available = $true }
    }
    return
  }
  if ($null -eq $script:InputPending) {
    $script:InputPending = @{ available = $inputState.Available; moves = 0; buttons = 0; wheels = 0; keys = 0; truncated = $false; ageMs = 0 }
  }
  $script:InputPending.available = $inputState.Available
  foreach ($field in @("moves", "buttons", "wheels", "keys")) {
    $total = $script:InputPending[$field] + $inputState.$field
    if ($total -gt 1000000) { $script:InputPending.truncated = $true }
    $script:InputPending[$field] = [Math]::Min(1000000, $total)
  }
  $script:InputPending.truncated = $script:InputPending.truncated -or $inputState.Truncated
  $script:InputPending.ageMs = $inputState.AgeMs
}

function Take-InputUpdate {
  if ($null -ne $script:Activity) { Collect-UserInput }
  if ($null -eq $script:InputPending) { return $null }
  $update = $script:InputPending
  $script:InputPending = $null
  $update.stateAvailable = $false
  try {
    $status = Get-Status
    $update.cursor = $status.cursor; $update.target = $status.target; $update.front = $status.front
    $update.stateAvailable = $true
  } catch {}
  return $update
}

function Answer($id, $result) {
  if ($null -ne $script:ActionBefore) {
    $observation = try {
      Observe-Action $script:ActionBefore $script:ActionWindows $script:ObservationId
    } catch { [ordered]@{ available = $false; observationId = $script:ObservationId; refsInvalidated = $true } }
    if ($result -is [System.Collections.IDictionary]) { $result["observation"] = $observation }
  }
  $o = [ordered]@{ id = $id; ok = $true; result = $result }
  if ($null -ne $script:Activity -or $null -ne $script:InputPending) { $o.userInput = Take-InputUpdate }
  [Console]::Out.WriteLine((ConvertTo-Json $o -Compress -Depth 8))
  [Console]::Out.Flush()
}

# The screen pulse's answer (ADR 0059). Written without Take-InputUpdate so
# sampling twice a second never swallows the person's input that the next
# tool result must still report; the counts it carries are the running
# totals since that result, which the server diffs between pulses.
function Answer-Pulse($id) {
  if ($null -ne $script:Activity) { $script:Activity.Start(); Collect-UserInput }
  $fg = [int64][Studio.Native]::GetForegroundWindow()
  $front = if ($fg -eq 0) { $null } else { Window-Row (Root-Of $fg) }
  $pending = $script:InputPending
  $counts = if ($null -eq $pending) { [ordered]@{ buttons = 0; keys = 0; wheels = 0; moves = 0 } }
    else { [ordered]@{ buttons = $pending.buttons; keys = $pending.keys; wheels = $pending.wheels; moves = $pending.moves } }
  $result = [ordered]@{ pointer = (Get-Cursor); front = $front; input = $counts; monitored = ($null -ne $script:Activity) }
  [Console]::Out.WriteLine((ConvertTo-Json ([ordered]@{ id = $id; ok = $true; result = $result }) -Compress -Depth 6))
  [Console]::Out.Flush()
}

function Refuse($id, $message) {
  Reset-UiRefs
  if ($null -ne $script:ActionBefore) {
    $message += " Observe status and read the intended window again before any further input; do not replay this action automatically."
  }
  $o = [ordered]@{ id = $id; ok = $false; error = $message }
  if ($null -ne $script:Activity -or $null -ne $script:InputPending) { $o.userInput = Take-InputUpdate }
  [Console]::Out.WriteLine((ConvertTo-Json $o -Compress -Depth 4))
  [Console]::Out.Flush()
}

$script:ActionBefore = $null
Answer "ready" ([ordered]@{ displays = @(Get-Displays) })

try { while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq "") { continue }
  $id = $null
  $script:ActionBefore = $null
  try {
    $req = ConvertFrom-Json $line
    $id = $req.id
    $a = $req.args
    if ($null -ne $script:Activity) { Collect-UserInput }
    $script:ObservationId = [string]$a.observationId
    $script:ActionBefore = $null
    $script:ActionWindows = @()
    if (Needs-ActionObservation $req.op $a) {
      if ($null -ne $script:Activity) { $script:Activity.Start(); $script:Activity.Pulse() }
      elseif ($script:MonitorUnavailable) { $script:InputPending = @{ available = $false; moves = 0; buttons = 0; wheels = 0; keys = 0 } }
      # Failure to read the pre-action state must refuse before sending input.
      $script:ActionBefore = Get-Status
      $script:ResumedTo = [int64]0
      $script:ActionWindows = @(Get-TopWindows $null)
    }
    switch ($req.op) {
      "displays" { Answer $id @(Get-Displays) }
      "screenshot" { Answer $id (Take-Screenshot $a.display $a.region $a.max $a.format $a.quality $a.window $a.budget) }
      "status" { Answer $id (Get-Status) }
      "arrange" { Answer $id (Arrange-Window $a.window $a.action $a.display $a.x $a.y $a.width $a.height) }
      "wait_window" { Answer $id (Wait-ForWindow $a.text $a.seconds) }
      "cursor" { Answer $id (Get-Cursor) }
      "pulse" { Answer-Pulse $id }
      "move" { Move-Pointer $a.display $a.x $a.y; Answer $id (Get-Cursor) }
      "click" {
        $outside = (Given $a.x) -and (Outside-Target $a.display $a.x $a.y)
        $clickedWindow = Point-Window $a.display $a.x $a.y
        Click-At $a.display $a.x $a.y $a.button $a.count $a.modifiers
        Set-Target $clickedWindow
        $c = Get-Cursor; if ($outside) { $c.outside = "The point was outside the window being worked in before the click; whatever is there took it instead." }
        Answer $id $c
      }
      "drag" {
        $note = $null
        if (Outside-Target $a.display $a.from[0] $a.from[1]) { $note = "The drag started outside the window being worked in, so that window saw none of it." }
        elseif (Outside-Target $a.display $a.to[0] $a.to[1]) { $note = "The drag ended outside the window being worked in." }
        $dragWindow = Point-Window $a.display $a.from[0] $a.from[1]
        Drag-Pointer $a.display $a.from $a.to
        Set-Target $dragWindow
        $c = Get-Cursor; if ($null -ne $note) { $c.outside = $note }
        Answer $id $c
      }
      "button" {
        Reset-UiRefs
        Press-Button $(if ($a.button) { $a.button } else { "left" }) $a.action
        # Releasing held input is cleanup and must not depend on observing a
        # window first, including when Stop is recovering a failed driver.
        Answer $id ([ordered]@{ done = $true; observation = @{ available = $false; observationId = $script:ObservationId; refsInvalidated = $true } })
      }
      "scroll" { Scroll-At $a.display $a.x $a.y $a.direction $a.amount; Answer $id ([ordered]@{ done = $true }) }
      "type" { Assert-Target "type"; Type-Text ([string]$a.text); Answer $id ([ordered]@{ typed = ([string]$a.text).Length; front = (Front-Note) }) }
      "key" { Assert-Target "press keys"; Press-Chord ([string]$a.keys) $a.repeat; Answer $id ([ordered]@{ done = $true; front = (Front-Note) }) }
      "hold" { Assert-Target "hold keys"; Hold-Chord ([string]$a.keys) $a.seconds; Answer $id ([ordered]@{ done = $true; front = (Front-Note) }) }
      "apps" { Answer $id @(Get-Apps) }
      "windows" { Answer $id @(Get-TopWindows $a.app) }
      "open" { Answer $id (Open-App $a.app $a.path) }
      "focus" { Answer $id (Focus-Window $a.window) }
      "read_ui" { Answer $id (Read-Ui $a.window $a.depth $a.limit $a.all) }
      "act" { Answer $id ([ordered]@{ said = (Ui-Act $a.ref $a.action) }) }
      "set_value" { Answer $id ([ordered]@{ said = (Ui-SetValue $a.ref $a.value) }) }
      "select_text" { Answer $id ([ordered]@{ said = (Ui-SelectText $a.ref $a.start $a.end) }) }
      "clipboard" { Answer $id (Clipboard-Op $a.action $a.text) }
      "ping" { Answer $id ([ordered]@{ pong = $true }) }
      # A pause or handoff lets go of whatever Studio still holds - a button
      # pressed by mouse_button, a modifier - without closing the driver, so
      # the task keeps its place while the person or another actor works.
      "release_held" { Release-HeldInput; Answer $id ([ordered]@{ released = $true }) }
      default { Refuse $id ("Unknown operation `"" + $req.op + "`".") }
    }
  } catch {
    $m = $_.Exception.Message
    if ($null -ne $_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
    Release-HeldInput
    Refuse $id $m
  }
} } finally {
  Release-HeldInput
  if ($null -ne $script:Activity) { $script:Activity.Dispose() }
}
