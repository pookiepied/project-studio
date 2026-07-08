import { runPS } from "../ps-helper.js";

const LEVEL_MAP: Record<string, number> = { Critical: 1, Error: 2, Warning: 3, Information: 4 };

export async function readEventLog(args: Record<string, unknown>): Promise<unknown> {
  const logName   = ((args.log_name   as string) || "System").replace(/['"]/g, "");
  const maxEvents = (args.max_events  as number)  || 20;
  const level     = args.level        as string | undefined;
  const source    = args.source       as string | undefined;
  const startTime = args.start_time   as string | undefined;

  let filter = `@{ LogName='${logName}'`;
  if (level && LEVEL_MAP[level]) filter += `; Level=${LEVEL_MAP[level]}`;
  if (startTime) filter += `; StartTime='${startTime.replace(/'/g, "")}'`;
  filter += " }";

  const whereSource = source
    ? `| Where-Object ProviderName -like '*${source.replace(/['"]/g, "")}*'`
    : "";

  return runPS(`
try {
  Get-WinEvent -FilterHashtable ${filter} -MaxEvents ${maxEvents} -EA Stop ${whereSource} |
    Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, MachineName,
      @{N='message';E={
        $m = $_.Message -replace '\r?\n',' '
        if ($m.Length -gt 500) { $m.Substring(0,500)+'...' } else { $m }
      }} |
    ConvertTo-Json -AsArray
} catch {
  [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json
}
`, 25_000);
}
