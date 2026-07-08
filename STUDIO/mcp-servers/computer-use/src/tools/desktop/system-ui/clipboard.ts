import { runPS } from "../ps-helper.js";

export async function getClipboard(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$text = Get-Clipboard -Raw
if ($null -eq $text) { $text = '' }
[PSCustomObject]@{ content=$text; length=$text.Length } | ConvertTo-Json
`);
}

export async function setClipboard(args: Record<string, unknown>): Promise<unknown> {
  const text = args.text as string;
  if (text === undefined) return { error: "text is required" };
  const safe = (text as string).replace(/'/g, "''");
  return runPS(`
Set-Clipboard -Value '${safe}'
[PSCustomObject]@{ success=$true; length=${text.length} } | ConvertTo-Json
`);
}
