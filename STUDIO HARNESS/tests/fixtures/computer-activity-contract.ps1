param([string]$Source, [string]$Preview)
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
$checks.overlayAbsent = -not $activity.IsOverlay(100)
$activity.Dispose()
# Exercise the shipped drawing without a form, hooks or desktop input.
$bitmap = New-Object System.Drawing.Bitmap(92, 56)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.Clear([System.Drawing.Color]::White)
  [Studio.Activity]::PaintCursor($graphics, (New-Object System.Drawing.Point(2, 2)), $bitmap.Size)
  $checks.arrowPainted = $bitmap.GetPixel(8, 10).R -lt 100
  $checks.badgePainted = $bitmap.GetPixel(25, 38).R -lt 100
  $checks.badgeRounded = $bitmap.GetPixel(14, 28).R -eq 255
  if ($Preview) { $bitmap.Save($Preview, [System.Drawing.Imaging.ImageFormat]::Png) }
  $graphics.Clear([System.Drawing.Color]::White)
  [Studio.Activity]::PaintCursor($graphics, (New-Object System.Drawing.Point(91, 55)), $bitmap.Size)
  $checks.edgeBadgeVisible = $bitmap.GetPixel(42, 40).R -lt 100
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
ConvertTo-Json $checks -Compress -Depth 5
