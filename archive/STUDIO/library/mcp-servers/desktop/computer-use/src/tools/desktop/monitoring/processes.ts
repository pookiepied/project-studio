import { runPS } from "../ps-helper.js";

export async function listProcesses(args: Record<string, unknown>): Promise<unknown> {
  const limit     = (args.limit      as number) || 60;
  const sortBy    = (args.sort_by    as string) || "ram";
  const nameFilter = args.name_filter as string | undefined;
  const sortProp  = sortBy === "cpu" ? "cpu_s" : "ram_mb";
  const where     = nameFilter
    ? `| Where-Object Name -like '*${nameFilter.replace(/'/g, "")}*'`
    : "";

  return runPS(`
Get-Process -ErrorAction SilentlyContinue ${where} |
  Select-Object Name, Id,
    @{N='cpu_s';    E={[math]::Round($_.CPU,2)}},
    @{N='ram_mb';   E={[math]::Round($_.WorkingSet/1MB,1)}},
    @{N='peak_mb';  E={[math]::Round($_.PeakWorkingSet/1MB,1)}},
    @{N='threads';  E={$_.Threads.Count}},
    @{N='handles';  E={$_.HandleCount}},
    @{N='priority'; E={try{$_.PriorityClass.ToString()}catch{'N/A'}}},
    Description,
    @{N='start_time';E={try{$_.StartTime.ToString('yyyy-MM-dd HH:mm:ss')}catch{''}}} |
  Sort-Object ${sortProp} -Descending |
  Select-Object -First ${limit} |
  ConvertTo-Json -AsArray
`);
}
