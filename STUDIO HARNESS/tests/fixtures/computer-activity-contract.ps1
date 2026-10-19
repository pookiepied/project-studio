param([string]$Source)
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
ConvertTo-Json $checks -Compress -Depth 5
