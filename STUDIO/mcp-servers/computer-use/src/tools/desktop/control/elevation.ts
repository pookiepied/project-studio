import { runPS } from "../ps-helper.js";

export async function runElevated(args: Record<string, unknown>): Promise<unknown> {
  const command = args.command as string;
  if (!command) return { error: "command is required" };

  // Escape embedded double-quotes so the command survives the -ArgumentList wrapping
  const safe = command.replace(/"/g, '`"');

  return runPS(`
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo('powershell.exe')
  $psi.Arguments = '-NonInteractive -NoProfile -Command "${safe}"'
  $psi.Verb = 'runas'
  $psi.UseShellExecute = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  [PSCustomObject]@{
    success=$true; exit_code=$p.ExitCode
    note='Output cannot be captured from an elevated process. Check the result via file output or registry if needed.'
  } | ConvertTo-Json
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json
}
`, 60_000);
}
