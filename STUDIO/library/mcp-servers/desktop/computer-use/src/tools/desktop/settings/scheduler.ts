import { runPS } from "../ps-helper.js";

export async function listScheduledTasks(args: Record<string, unknown>): Promise<unknown> {
  const folder = ((args.folder as string) || "\\").replace(/"/g, "");
  const limit  = (args.max_results as number) || 100;
  const filter = args.filter as string | undefined;
  const where  = filter ? `| Where-Object {$_.TaskName -like '*${filter.replace(/['"]/g, "")}*'}` : "";

  // Call Get-ScheduledTaskInfo ONCE per task (not 3×) to avoid an N×3 query storm.
  // Previous pattern used computed columns that each called Get-ScheduledTaskInfo
  // independently, causing 300 WMI calls for a 100-task result — hence the 25s ceiling.
  return runPS(`
Get-ScheduledTask -TaskPath "${folder}*" -EA SilentlyContinue ${where} |
  Select-Object -First ${limit} |
  ForEach-Object {
    $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -EA SilentlyContinue
    [PSCustomObject]@{
      TaskName    = $_.TaskName
      TaskPath    = $_.TaskPath
      State       = $_.State.ToString()
      Description = $_.Description
      next_run    = if($info.NextRunTime -and $info.NextRunTime -ne [datetime]::MinValue){ $info.NextRunTime.ToString('yyyy-MM-dd HH:mm') } else { $null }
      last_run    = if($info.LastRunTime -and $info.LastRunTime -ne [datetime]::MinValue){ $info.LastRunTime.ToString('yyyy-MM-dd HH:mm') } else { $null }
      last_result = $info.LastTaskResult
    }
  } | ConvertTo-Json -AsArray
`, 25_000);
}

export async function manageScheduledTask(args: Record<string, unknown>): Promise<unknown> {
  const taskName = (args.task_name as string || "").replace(/"/g, "");
  const action   = args.action as string;
  if (!taskName || !action) return { error: "task_name and action are required" };

  const cmds: Record<string, string> = {
    run:     `Start-ScheduledTask  -TaskName "${taskName}" -EA Stop`,
    enable:  `Enable-ScheduledTask  -TaskName "${taskName}" -EA Stop`,
    disable: `Disable-ScheduledTask -TaskName "${taskName}" -EA Stop`,
    delete:  `Unregister-ScheduledTask -TaskName "${taskName}" -Confirm:$false -EA Stop`,
    status:  `Get-ScheduledTaskInfo -TaskName "${taskName}" -EA Stop | Select-Object LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns | ConvertTo-Json`,
  };

  const inner = cmds[action];
  if (!inner) return { error: `Unknown action '${action}'. Use: run, enable, disable, delete, status` };

  return runPS(`
try {
  ${inner}
  if ('${action}' -ne 'status') {
    [PSCustomObject]@{ success=$true; task="${taskName}"; action="${action}" } | ConvertTo-Json
  }
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function createScheduledTask(args: Record<string, unknown>): Promise<unknown> {
  const taskName  = (args.task_name  as string || "").replace(/"/g, "");
  const command   = (args.command    as string || "");
  const arguments_ = (args.arguments as string || "").replace(/"/g, "'");
  const triggerType = (args.trigger  as string) || "daily";
  const time      = (args.time       as string) || "08:00";
  const runAsUser = (args.run_as     as string) || "SYSTEM";

  if (!taskName || !command) return { error: "task_name and command are required" };

  const safeCmd  = command.replace(/"/g, "'");
  const triggerMap: Record<string, string> = {
    daily:   `New-ScheduledTaskTrigger -Daily   -At '${time}'`,
    hourly:  `New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At (Get-Date)`,
    startup: `New-ScheduledTaskTrigger -AtStartup`,
    logon:   `New-ScheduledTaskTrigger -AtLogOn`,
  };

  const triggerCmd = triggerMap[triggerType];
  if (!triggerCmd) return { error: `Unknown trigger '${triggerType}'. Use: daily, hourly, startup, logon` };

  const safeUser = runAsUser.replace(/['"]/g, "");

  return runPS(`
try {
  $action  = New-ScheduledTaskAction -Execute '${safeCmd}' -Argument '${arguments_}'
  $trigger = ${triggerCmd}
  $settings= New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName "${taskName}" -Action $action -Trigger $trigger -Settings $settings \`
    -RunLevel Highest -User '${safeUser}' -Force -EA Stop | Out-Null
  [PSCustomObject]@{ success=$true; task="${taskName}"; trigger='${triggerType}'; run_as='${safeUser}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
