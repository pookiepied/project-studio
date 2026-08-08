import { runPS } from "../ps-helper.js";

const UIA = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes`;

function findWindow(title: string): string {
  const safe = title.replace(/['"]/g, "");
  return `
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${safe}')
$win  = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $win) {
  $procMatch = Get-Process | Where-Object {$_.MainWindowTitle -like '*${safe}*' -and $_.MainWindowHandle -ne 0} | Select-Object -First 1
  if ($procMatch) {
    $hCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$procMatch.Id)
    $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $hCond)
  }
}
if (-not $win) { throw "Window '${safe}' not found" }`;
}

export async function getUiTree(args: Record<string, unknown>): Promise<unknown> {
  const title = (args.title as string || "").replace(/['"]/g, "");
  const depth = (args.depth as number) || 3;
  if (!title) return { error: "title is required" };

  return runPS(`
${UIA}
${findWindow(title)}
function Get-UiChildren($el, $d) {
  if ($d -le 0) { return @() }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $children = @()
  $child = $walker.GetFirstChild($el)
  while ($child) {
    $cur = $child.Current
    $children += [PSCustomObject]@{
      name=$cur.Name; type=$cur.ControlType.ProgrammaticName.Replace('ControlType.','')
      automation_id=$cur.AutomationId; class=$cur.ClassName
      value=try{$child.GetCurrentPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty)}catch{$null}
      enabled=$cur.IsEnabled; x=$cur.BoundingRectangle.X; y=$cur.BoundingRectangle.Y
      children=@(Get-UiChildren $child ($d-1))
    }
    $child = $walker.GetNextSibling($child)
  }
  return $children
}
$tree = [PSCustomObject]@{
  title=$win.Current.Name; type='Window'
  children=@(Get-UiChildren $win ${depth})
}
$tree | ConvertTo-Json -Depth 8
`, 30_000);
}

export async function clickUiElement(args: Record<string, unknown>): Promise<unknown> {
  const windowTitle   = (args.window_title    as string || "").replace(/['"]/g, "");
  const elementName   = args.element_name     as string | undefined;
  const automationId  = args.automation_id    as string | undefined;
  const controlType   = args.control_type     as string | undefined;

  if (!windowTitle) return { error: "window_title is required" };
  if (!elementName && !automationId) return { error: "element_name or automation_id is required" };

  const safeName  = (elementName  || "").replace(/['"]/g, "");
  const safeAid   = (automationId || "").replace(/['"]/g, "");
  const safeType  = (controlType  || "").replace(/['"]/g, "");

  const condParts = [];
  if (safeName)  condParts.push(`New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'${safeName}')`);
  if (safeAid)   condParts.push(`New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'${safeAid}')`);

  const condExpr = condParts.length > 1
    ? `New-Object System.Windows.Automation.AndCondition(${condParts.join(",")})`
    : condParts[0];

  return runPS(`
${UIA}
${findWindow(windowTitle)}
try {
  $cond = ${condExpr}
  $el = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if (-not $el) { throw "Element not found" }
  $invokePattern = $null
  try {
    $invokePattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  } catch {}
  if ($invokePattern) {
    $invokePattern.Invoke()
    [PSCustomObject]@{ success=$true; method='InvokePattern'; element=$el.Current.Name } | ConvertTo-Json
  } else {
    # Fall back to simulating a mouse click at the element's center
    $r = $el.Current.BoundingRectangle
    $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)
    Add-Type @"
using System.Runtime.InteropServices;
public class UiClick {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);
}
"@
    [UiClick]::SetCursorPos($cx,$cy) | Out-Null
    Start-Sleep -Milliseconds 50
    [UiClick]::mouse_event(0x0002,0,0,0,0); [UiClick]::mouse_event(0x0004,0,0,0,0)
    [PSCustomObject]@{ success=$true; method='MouseClick'; cx=$cx; cy=$cy; element=$el.Current.Name } | ConvertTo-Json
  }
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, 20_000);
}

export async function getUiElementValue(args: Record<string, unknown>): Promise<unknown> {
  const windowTitle  = (args.window_title   as string || "").replace(/['"]/g, "");
  const elementName  = args.element_name    as string | undefined;
  const automationId = args.automation_id   as string | undefined;
  if (!windowTitle || (!elementName && !automationId)) return { error: "window_title and element_name or automation_id are required" };

  const safeName = (elementName  || "").replace(/['"]/g, "");
  const safeAid  = (automationId || "").replace(/['"]/g, "");
  const condExpr = safeAid
    ? `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'${safeAid}')`
    : `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'${safeName}')`;

  return runPS(`
${UIA}
${findWindow(windowTitle)}
try {
  $el = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, ${condExpr})
  if (-not $el) { throw "Element not found" }
  $val  = try{$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$el.GetCurrentPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty)}catch{$null}
  $text = try{$el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty)}catch{$null}
  $sel  = try{($el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern));$el.GetCurrentPropertyValue([System.Windows.Automation.SelectionItemPattern]::IsSelectedProperty)}catch{$null}
  [PSCustomObject]@{ element=$el.Current.Name; value=$val; name_property=$text; selected=$sel; type=$el.Current.ControlType.ProgrammaticName } | ConvertTo-Json
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function setUiElementValue(args: Record<string, unknown>): Promise<unknown> {
  const windowTitle  = (args.window_title   as string || "").replace(/['"]/g, "");
  const automationId = args.automation_id   as string | undefined;
  const elementName  = args.element_name    as string | undefined;
  const value        = (args.value as string || "").replace(/'/g, "''");
  if (!windowTitle || (!elementName && !automationId)) return { error: "window_title and element_name or automation_id are required" };

  const safeAid = (automationId || "").replace(/['"]/g, "");
  const safeName= (elementName  || "").replace(/['"]/g, "");
  const condExpr= safeAid
    ? `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'${safeAid}')`
    : `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'${safeName}')`;

  return runPS(`
${UIA}
${findWindow(windowTitle)}
try {
  $el = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, ${condExpr})
  if (-not $el) { throw "Element not found" }
  $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $vp.SetValue('${value}')
  [PSCustomObject]@{ success=$true; element=$el.Current.Name; value='${value}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
