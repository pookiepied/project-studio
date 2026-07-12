import { runPS } from "../ps-helper.js";

export async function showDialog(args: Record<string, unknown>): Promise<unknown> {
  // Escape for PS single-quoted strings: ' → '' so the string doesn't break
  // Strip backticks (PS escape char) and double-quotes (would break the PS string if passed through)
  const message = ((args.message as string) || "").replace(/["`]/g, "").replace(/'/g, "''");
  const title   = ((args.title   as string) || "Computer Use").replace(/["`]/g, "").replace(/'/g, "''");
  const type    = (args.type    as string) || "info";     // info | warning | error | question | input
  const buttons = (args.buttons as string) || "OK";       // OK | OKCancel | YesNo | YesNoCancel

  const iconMap: Record<string, string> = {
    info: "Information", warning: "Warning", error: "Error", question: "Question",
  };
  const btnMap: Record<string, string> = {
    OK: "OK", OKCancel: "OKCancel", YesNo: "YesNo", YesNoCancel: "YesNoCancel",
  };

  const icon   = iconMap[type]    || "Information";
  const btnSet = btnMap[buttons]  || "OK";

  if (type === "input") {
    return runPS(`
Add-Type -AssemblyName Microsoft.VisualBasic
$val = [Microsoft.VisualBasic.Interaction]::InputBox('${message}', '${title}', '')
[PSCustomObject]@{ type='input'; value=$val; cancelled=($val -eq '') } | ConvertTo-Json
`, 300_000);
  }

  return runPS(`
Add-Type -AssemblyName System.Windows.Forms
$r = [System.Windows.Forms.MessageBox]::Show(
  '${message}', '${title}',
  [System.Windows.Forms.MessageBoxButtons]::${btnSet},
  [System.Windows.Forms.MessageBoxIcon]::${icon}
)
[PSCustomObject]@{ type='dialog'; clicked=$r.ToString() } | ConvertTo-Json
`, 300_000);
}
