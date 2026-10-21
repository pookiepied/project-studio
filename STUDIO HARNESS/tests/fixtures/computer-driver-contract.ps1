param([string]$Driver)
$ErrorActionPreference = "Stop"
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Driver, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw $parseErrors[0].Message }

# Load only the actual pure policy functions. The driver's top-level native
# initialization and input loop must never run on the user's desktop in tests.
foreach ($name in @("Window-Identity", "Same-Window", "Set-Target", "Assert-Target", "Reset-UiRefs", "Begin-UiRead", "Ui-Ref", "Control-Point", "Select-UniqueWindow", "Wait-NewWindow", "Wait-ForWindow", "Observe-Action", "Needs-ActionObservation", "Collect-UserInput", "Take-InputUpdate", "Release-HeldInput", "Answer", "Encoded-Bytes", "Encode-Picture")) {
  $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if ($null -eq $function) { throw "Missing production function $name" }
  . ([scriptblock]::Create($function.Extent.Text))
}
# A managed test double, with no P/Invoke or input capability. If the target
# identity guard is broken, foreground equality must succeed rather than throw.
[void](Add-Type -Namespace Studio -Name Native -MemberDefinition 'public static System.IntPtr GetForegroundWindow() { return new System.IntPtr(10); }')
function Window-Row($handle) { return $script:Rows[[string]$handle] }
function Get-Displays { return @(@{ index = 0; x = 0; y = 0 }, @{ index = 1; x = 1920; y = 0 }, @{ index = 2; x = -1280; y = -400 }) }
function Display-Of($x, $y) { if ($x -lt 0) { return 2 }; if ($x -ge 1920) { return 1 }; return 0 }
function Start-Sleep { param($Milliseconds) }
# The settle loop's clock and screen: sleeps are counted, not slept, and the
# screen is whatever the scenario says it shows.
$script:SettleMinMs = 300; $script:SettleMaxMs = 800; $script:SettleSampleMs = 100
$script:Screen = "still"
function Screen-Signature { return $script:Screen }
function Given($value) { return $null -ne $value -and $value -ne "" }
function Rejected($action) { try { & $action | Out-Null; return $false } catch { return $true } }
$first = "11111111-1111-4111-8111-111111111111"
$second = "22222222-2222-4222-8222-222222222222"
$old = @{ handle = 10; pid = 100; processStarted = "1"; app = "chrome"; title = "Profile chooser" }
$main = @{ handle = 20; pid = 200; processStarted = "2"; app = "chrome"; title = "Browser" }
$other = @{ handle = 30; pid = 300; processStarted = "3"; app = "notes"; title = "Unrelated" }
$script:Rows = @{ "10" = $old }
$checks = [ordered]@{}
Begin-UiRead 10 $first
$script:Refs[1] = [pscustomobject]@{ Current = [pscustomobject]@{ Name = "Old" } }
$checks.current = (Ui-Ref "ui_$($first)_1").Current.Name
Begin-UiRead 10 $second
$script:Refs[1] = [pscustomobject]@{ Current = [pscustomobject]@{ Name = "New" } }
$checks.oldReadRejected = Rejected { Ui-Ref "ui_$($first)_1" }
$checks.newRead = (Ui-Ref "ui_$($second)_1").Current.Name
$checks.legacyRejected = Rejected { Ui-Ref "ui_1" }
$script:Rows["10"] = @{ handle = 10; pid = 999; processStarted = "9" }
$checks.reusedHandleRejected = Rejected { Ui-Ref "ui_$($second)_1" }
$script:Target = 10; $script:TargetIdentity = Window-Identity $old
$checks.keyboardReuseRejected = Rejected { Assert-Target "type" }
$script:Rows["10"] = $old
Reset-UiRefs
$checks.afterInputRejected = Rejected { Ui-Ref "ui_$($second)_1" }
Begin-UiRead 10 $first
$script:Refs[1] = [pscustomobject]@{ Current = [pscustomobject]@{ Name = "Restart" } }
$checks.restartRejected = Rejected { Ui-Ref "ui_$($second)_1" }
$checks.positivePoint = Control-Point @{ X = 2000; Y = 100; Width = 40; Height = 20 }
$checks.negativePoint = Control-Point @{ X = -1200; Y = -300; Width = 40; Height = 20 }
$checks.ambiguousRejected = Rejected { Select-UniqueWindow @($old, $main) }
$checks.unique = (Select-UniqueWindow @($main)).handle

$script:sample = 0
function Get-Status {
  $script:sample++
  if ($script:sample -lt 2) { return @{ target = $old; front = $old; targetInFront = $true } }
  $script:Rows = @{ "20" = $main; "30" = $other }
  return @{ target = $null; front = $other; targetInFront = $false }
}
function Get-TopWindows($app) { return @($main, $other) }
$checks.delayed = Observe-Action @{ target = $old } @($old) $second
$checks.samples = $script:sample
# A screen that never stops changing gets the whole wait, and no more.
$script:sample = 0; $script:frames = 0
function Screen-Signature { $script:frames++; return "frame$($script:frames)" }
function Get-Status { $script:sample++; return @{ target = $main; front = $main; targetInFront = $true } }
$checks.busyWaited = (Observe-Action @{ target = $main } @($main) $second).waitedMs
$checks.busySamples = $script:sample
function Screen-Signature { return $script:Screen }
$checks.namedLaunch = (Wait-NewWindow @() "chrome").handle
$checks.waitedWindow = (Wait-ForWindow "chrome" 0).handle

# Studio's own input keeps the latest read's references while their window
# keeps its identity; each is still checked when it is used.
$script:Rows["10"] = $old
function Get-Status { return @{ target = $old; front = $old; targetInFront = $true } }
$script:ActionBefore = @{ target = $old }
$script:ActionWindows = @($old)
$script:ObservationId = $second
Answer "action" @{ said = "Invoked." }
$checks.answerKeeps = (Ui-Ref "ui_$($first)_1").Current.Name
$checks.refCount = $script:Refs.Count

# Execute the production click dispatch with input and window discovery replaced
# by test doubles. A new foreground window must never become its input target.
function Point-Window($display, $x, $y) { return 10 }
function Outside-Target($display, $x, $y) { return $false }
function Click-At { $script:clicks++ }
function Get-Cursor { return @{ x = 1; y = 2; display = 0 } }
$script:clicks = 0
$a = [pscustomobject]@{ x = 1; y = 2; display = 0; button = "left"; count = 1; modifiers = "" }
$id = "click"
$dispatch = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.SwitchStatementAst] -and $node.Condition.Extent.Text -eq '$req.op' }, $true)
$case = @($dispatch.Clauses | Where-Object { $_.Item1.Extent.Text -eq '"click"' })[0].Item2.Extent.Text
. ([scriptblock]::Create($case.Substring(1, $case.Length - 2)))
$checks.clicks = $script:clicks
$checks.clickedTarget = $script:Target
$checks.releaseNeedsObservation = Needs-ActionObservation "button" @{ action = "up" }
$checks.pressNeedsObservation = Needs-ActionObservation "button" @{ action = "down" }
function Get-Status { throw "snapshot unavailable" }
Answer "missing" @{ said = "Input sent." }
function Press-Button($button, $direction) { $script:released = ($button -eq "left" -and $direction -eq "up") }
$script:ActionBefore = $null
$a = [pscustomobject]@{ action = "up"; button = "left" }
$id = "cleanup"
$case = @($dispatch.Clauses | Where-Object { $_.Item1.Extent.Text -eq '"button"' })[0].Item2.Extent.Text
. ([scriptblock]::Create($case.Substring(1, $case.Length - 2)))
$checks.releasedWithoutObservation = $script:released

$script:Rows["10"] = $old
Begin-UiRead 10 $first
$script:Refs[1] = [pscustomobject]@{ Current = [pscustomobject]@{ Name = "Fresh" } }
$script:activityReads = 0
$script:Activity = [pscustomobject]@{}
$script:Activity | Add-Member -MemberType ScriptMethod -Name Read -Value {
  $script:activityReads++
  return @{ Available = $true; Moves = $(if ($script:activityReads -eq 1) { 3 } else { 0 }); Buttons = 0; Wheels = 0; Keys = 0; Truncated = $false; AgeMs = 5 }
}
$checks.userInputExpiresRefs = Rejected { Ui-Ref "ui_$($first)_1" }
function Get-Status { return @{ cursor = @{ x = 42; y = 18; display = 1 }; target = $old; front = $other } }
$checks.userInput = Take-InputUpdate
$checks.inputDrained = $null -eq (Take-InputUpdate)
$script:InputPending = @{ available = $false; moves = 0; buttons = 0; wheels = 0; keys = 0 }
$checks.monitorReadyWithoutInput = $null -eq (Take-InputUpdate)
$script:Activity | Add-Member -MemberType ScriptMethod -Name Read -Force -Value { throw "monitor unavailable" }
$script:InputPending = @{ available = $true; moves = 2; buttons = 0; wheels = 0; keys = 0 }
$checks.monitorFailure = Take-InputUpdate
$script:Activity = $null
$script:HeldButtons = @{ middle = $true }; $script:HeldKeys = @{ 16 = $true }
$script:releasedButtons = @(); $script:releasedKeys = @()
function Press-Button($button, $direction) { $script:releasedButtons += "$button/$direction" }
function Send-Key($key, $down) { $script:releasedKeys += "$key/$down" }
Release-HeldInput
$checks.releasedButtons = $script:releasedButtons; $checks.releasedKeys = $script:releasedKeys
# Pictures: a screen that would be a large PNG arrives within budget, and says how.
Add-Type -AssemblyName System.Drawing
$noise = New-Object System.Drawing.Bitmap 800, 600, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$lock = $noise.LockBits((New-Object System.Drawing.Rectangle 0, 0, 800, 600), [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $noise.PixelFormat)
$random = New-Object byte[] ($lock.Stride * 600); (New-Object System.Random 7).NextBytes($random)
[System.Runtime.InteropServices.Marshal]::Copy($random, 0, $lock.Scan0, $random.Length); $noise.UnlockBits($lock)
$plain = New-Object System.Drawing.Bitmap 400, 300
$fallback = Encode-Picture $noise "png" 400000
$checks.fallback = @{ mime = $fallback.mime; width = $fallback.width; underBudget = ($fallback.data.Length * 3 / 4) -le 400000; note = $fallback.note }
$small = Encode-Picture $plain "png" 400000
$checks.keptPng = @{ mime = $small.mime; width = $small.width; note = $small.note }
$noise.Dispose(); $plain.Dispose()
[Console]::Out.WriteLine((ConvertTo-Json @{ checks = $checks } -Depth 12 -Compress))
