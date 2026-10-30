param([string]$Source, [string]$Preview, [string]$Frames)
$ErrorActionPreference = "Stop"
# Compile the shipped helper, but never start its thread, hooks or marker.
Add-Type -Path $Source -ReferencedAssemblies System.Drawing, System.Windows.Forms
$activity = New-Object Studio.Activity
$checks = [ordered]@{
  key = [Studio.Activity]::Classify($true, 0x100, 0)
  keyUp = [Studio.Activity]::Classify($true, 0x101, 0)
  injectedKey = [Studio.Activity]::Classify($true, 0x100, 0x10)
  lowerKey = [Studio.Activity]::Classify($true, 0x100, 2)
  move = [Studio.Activity]::Classify($false, 0x200, 0)
  button = [Studio.Activity]::Classify($false, 0x201, 0)
  buttonUp = [Studio.Activity]::Classify($false, 0x202, 0)
  wheel = [Studio.Activity]::Classify($false, 0x20E, 0)
  injectedMouse = [Studio.Activity]::Classify($false, 0x200, 1)
  lowerMouse = [Studio.Activity]::Classify($false, 0x200, 2)
}
$activity.Record($checks.key); $activity.Record($checks.move)
$activity.Record($checks.button); $activity.Record($checks.wheel)
$activity.Record($checks.injectedKey); $activity.Record($checks.injectedMouse)
$checks.summary = $activity.Read()
$checks.drained = $activity.Read()
$checks.fields = @([Studio.InputSummary].GetFields() | ForEach-Object { $_.Name })
# The deliberate-stop policy with a 1000-tick clock: Escape held since 1000.
$checks.stop = [ordered]@{
  heldWhileActing = [Studio.Activity]::IsDeliberateStop(1900, 1000, 1000, 5000, 1000)
  tapped = [Studio.Activity]::IsDeliberateStop(1500, 1000, 1000, 5000, 1000)
  injectedHold = [Studio.Activity]::IsDeliberateStop(1900, 1000, 0, 5000, 1000)
  oldKeyOnly = [Studio.Activity]::IsDeliberateStop(1900, 1000, 500, 5000, 1000)
  notActing = [Studio.Activity]::IsDeliberateStop(1900, 1000, 1000, 900, 1000)
  notHeld = [Studio.Activity]::IsDeliberateStop(1900, 0, 1000, 5000, 1000)
}
$checks.stopIdle = $activity.StopRequested
$checks.overlayAbsent = -not $activity.IsOverlay(100)
$activity.Dispose()
# Exercise the shipped drawing without a form, hooks or desktop input.
$bitmap = New-Object System.Drawing.Bitmap(92, 56)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.Clear([System.Drawing.Color]::White)
  [Studio.Activity]::PaintCursor($graphics, (New-Object System.Drawing.Point(2, 2)), $bitmap.Size)
  $checks.arrowPainted = $bitmap.GetPixel(8, 10).ToArgb() -eq [System.Drawing.Color]::White.ToArgb() -and $bitmap.GetPixel(4, 10).R -lt 150
  $checks.badgePainted = $bitmap.GetPixel(18, 41).R -lt 100
  $checks.badgeRounded = $bitmap.GetPixel(14, 28).R -eq 255
  if ($Preview) { $bitmap.Save($Preview, [System.Drawing.Imaging.ImageFormat]::Png) }
  $graphics.Clear([System.Drawing.Color]::White)
  [Studio.Activity]::PaintCursor($graphics, (New-Object System.Drawing.Point(91, 55)), $bitmap.Size)
  $checks.edgeBadgeVisible = $bitmap.GetPixel(50, 47).R -lt 100
  $graphics.Clear([System.Drawing.Color]::Transparent)
  [Studio.Activity]::PaintCursor($graphics, (New-Object System.Drawing.Point(2, 2)), $bitmap.Size)
  $checks.transparentBackground = $bitmap.GetPixel(0, 55).A -eq 0
  $checks.neutralEdges = $true
  for ($x = 0; $x -lt $bitmap.Width; $x++) {
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
      $pixel = $bitmap.GetPixel($x, $y)
      if ($pixel.A -gt 0 -and ($pixel.R -ne $pixel.G -or $pixel.G -ne $pixel.B)) { $checks.neutralEdges = $false }
    }
  }
} finally { $graphics.Dispose(); $bitmap.Dispose() }
$feedback = New-Object System.Drawing.Bitmap(112, 80)
$feedbackGraphics = [System.Drawing.Graphics]::FromImage($feedback)
try {
  $hotspot = New-Object System.Drawing.Point(20, 20)
  $feedbackGraphics.Clear([System.Drawing.Color]::Transparent)
  [Studio.Activity]::PaintCursor($feedbackGraphics, $hotspot, $feedback.Size, $true, [single]-1)
  $checks.pressRing = $feedback.GetPixel(13, 20).A -gt 0
  $feedbackGraphics.Clear([System.Drawing.Color]::Transparent)
  [Studio.Activity]::PaintCursor($feedbackGraphics, $hotspot, $feedback.Size, $false, [single]0.5)
  $checks.releaseRing = $feedback.GetPixel(8, 20).A -gt 0 -and $feedback.GetPixel(13, 20).A -eq 0
  $feedbackGraphics.Clear([System.Drawing.Color]::Transparent)
  [Studio.Activity]::PaintCursor($feedbackGraphics, $hotspot, $feedback.Size, $false, [single]1)
  $checks.releaseFades = $feedback.GetPixel(3, 20).A -eq 0
  if ($Frames) {
    for ($frame = 0; $frame -lt 32; $frame++) {
      $feedbackGraphics.Clear([System.Drawing.Color]::White)
      $down = $frame -ge 8 -and $frame -lt 12
      $progress = if ($frame -ge 12 -and $frame -le 17) { [single](($frame - 12) / 5.0) } else { [single]-1 }
      [Studio.Activity]::PaintCursor($feedbackGraphics, $hotspot, $feedback.Size, $down, $progress)
      $feedback.Save((Join-Path $Frames ("frame-{0:d2}.png" -f $frame)), [System.Drawing.Imaging.ImageFormat]::Png)
    }
  }
} finally { $feedbackGraphics.Dispose(); $feedback.Dispose() }
ConvertTo-Json $checks -Compress -Depth 5
