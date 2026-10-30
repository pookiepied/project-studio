param([string]$Source, [string]$Driver)
$ErrorActionPreference = "Stop"
Add-Type -Path $Source -ReferencedAssemblies System.Drawing, System.Windows.Forms
# No native calls: execute production dispatch functions against managed doubles.
Add-Type -Namespace Studio -Name Native -MemberDefinition @'
public struct MOUSEINPUT { public uint dwFlags, mouseData; }
public struct INPUTUNION { public MOUSEINPUT mi; }
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
public static bool Refuse;
public static uint SendInput(uint count, INPUT[] inputs, int size) { return Refuse ? 0 : count; }
public static bool SetCursorPos(int x, int y) { return true; }
'@
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Driver, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw $parseErrors[0].Message }
foreach ($name in @("Send-Inputs", "Send-Mouse", "New-Input", "Move-Pointer")) {
    $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($null -eq $function) { throw "Missing production function $name" }
    . ([scriptblock]::Create($function.Extent.Text))
}
function To-Absolute($display, $x, $y) { return @{ x = $x; y = $y } }
function Send-MouseTo($x, $y, $flags) { $script:Activity.Record("mouse_move") }
function Start-Sleep { param($Milliseconds) }
$script:Activity = New-Object Studio.Activity
$until = [Studio.Activity].GetField("showUntil", [System.Reflection.BindingFlags]"NonPublic,Instance")
$buttons = [Studio.Activity].GetField("mouseButtons", [System.Reflection.BindingFlags]"NonPublic,Instance")
$released = [Studio.Activity].GetField("releasedAt", [System.Reflection.BindingFlags]"NonPublic,Instance")
function Marker-Visible { return [long]$until.GetValue($script:Activity) -gt [System.Diagnostics.Stopwatch]::GetTimestamp() }
try {
    $checks = [ordered]@{}
    Move-Pointer 0 10 10
    $checks.moveVisible = Marker-Visible
    $script:Activity.Dismiss()
    $markerInput = New-Object Studio.Native+INPUT
    Send-Inputs ([Studio.Native+INPUT[]]@($markerInput)) "test input"
    $checks.inputVisible = Marker-Visible
    $checks.visibleForFiveSeconds = ([long]$until.GetValue($script:Activity) - [System.Diagnostics.Stopwatch]::GetTimestamp()) -gt [System.Diagnostics.Stopwatch]::Frequency * 4
    $script:Activity.Record("mouse_move")
    $checks.manualMoveHides = -not (Marker-Visible)
    Send-Mouse 2 0
    Move-Pointer 0 14 14
    $checks.pressSurvivesMove = $buttons.GetValue($script:Activity) -eq 1 -and (Marker-Visible)
    Send-Mouse 8 0
    $checks.multiButtonPress = $buttons.GetValue($script:Activity) -eq 3
    Send-Mouse 4 0
    $checks.partialReleaseStaysPressed = $buttons.GetValue($script:Activity) -eq 2 -and $released.GetValue($script:Activity) -eq 0
    Send-Mouse 16 0
    $checks.finalReleaseAnimates = $buttons.GetValue($script:Activity) -eq 0 -and $released.GetValue($script:Activity) -gt 0
    $beforeWheel = $released.GetValue($script:Activity)
    Send-Mouse 0x0800 -120
    $checks.wheelNotClick = $buttons.GetValue($script:Activity) -eq 0 -and $released.GetValue($script:Activity) -eq $beforeWheel
    Send-Mouse 2 0
    $script:Activity.Record("mouse_button")
    $checks.manualButtonClearsPress = $buttons.GetValue($script:Activity) -eq 0 -and -not (Marker-Visible)
    $script:Activity.Pulse()
    $script:Activity.Dismiss()
    $checks.releaseHides = -not (Marker-Visible)
    [Studio.Native]::Refuse = $true
    try { Send-Mouse 2 0; $checks.refused = $false }
    catch { $checks.refused = $true }
    $checks.refusedInputHidden = -not (Marker-Visible)
    $checks.refusedInputNotPressed = $buttons.GetValue($script:Activity) -eq 0 -and $released.GetValue($script:Activity) -eq 0
    $checks.monitorNotStarted = -not $script:Activity.Read().Available
    ConvertTo-Json $checks -Compress
} finally { $script:Activity.Dispose() }
