import { runPS } from "../ps-helper.js";

export async function killProcess(args: Record<string, unknown>): Promise<unknown> {
  const name = args.name as string | undefined;
  const pid  = args.pid  as number | undefined;
  if (!name && pid == null) return { error: "Provide either name or pid" };

  const safe   = name ? name.replace(/['"]/g, "") : "";
  const target = pid != null ? `-Id ${pid}` : `-Name "${safe}"`;

  return runPS(`
try {
  $procs = Get-Process ${target} -EA Stop
  $killed = @($procs | ForEach-Object {
    $n = $_.Name; $i = $_.Id
    Stop-Process -Id $_.Id -Force -EA Stop
    [PSCustomObject]@{ name=$n; pid=$i }
  })
  [PSCustomObject]@{ success=$true; killed=@($killed) } | ConvertTo-Json -Depth 3
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json
}
`);
}

export async function setProcessPriority(args: Record<string, unknown>): Promise<unknown> {
  const name     = args.name     as string | undefined;
  const pid      = args.pid      as number | undefined;
  const priority = (args.priority as string) || "normal";

  const priorityMap: Record<string, string> = {
    realtime: "RealTime", high: "High", above_normal: "AboveNormal",
    normal: "Normal", below_normal: "BelowNormal", idle: "Idle",
  };
  const pc = priorityMap[priority.toLowerCase()];
  if (!pc) return { error: `Invalid priority. Use: ${Object.keys(priorityMap).join(", ")}` };
  if (!name && pid == null) return { error: "Provide either name or pid" };

  const safe   = name ? name.replace(/['"]/g, "") : "";
  const target = pid != null ? `-Id ${pid}` : `-Name "${safe}"`;

  return runPS(`
try {
  $procs = Get-Process ${target} -EA Stop
  $procs | ForEach-Object { $_.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::${pc} }
  [PSCustomObject]@{ success=$true; priority='${pc}'; affected=@($procs.Id) } | ConvertTo-Json -Depth 2
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json
}
`);
}

export async function startProcess(args: Record<string, unknown>): Promise<unknown> {
  const executable  = (args.executable   as string || "").replace(/"/g, "'");
  const processArgs = (args.args         as string | undefined)?.replace(/"/g, "'") ?? "";
  const cwd         = (args.cwd          as string | undefined)?.replace(/"/g, "'") ?? "";
  const wait        = (args.wait         as boolean) !== false;
  const windowStyle = (args.window_style as string) || "Normal"; // Normal | Minimized | Maximized | Hidden
  const captureOutput = args.capture_output as boolean;

  if (!executable) return { error: "executable is required" };

  const windowMap: Record<string, string> = {
    Normal: "Normal", Minimized: "Minimized", Maximized: "Maximized", Hidden: "Hidden",
  };
  const wstyle = windowMap[windowStyle] || "Normal";

  if (captureOutput) {
    return runPS(`
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName  = '${executable}'
  $psi.Arguments = '${processArgs}'
  if ('${cwd}') { $psi.WorkingDirectory = '${cwd}' }
  $psi.UseShellExecute        = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::${wstyle}
  $p = [System.Diagnostics.Process]::Start($psi)
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  [PSCustomObject]@{ success=$true; pid=$p.Id; exit_code=$p.ExitCode; stdout=$stdout; stderr=$stderr } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, 120_000);
  }

  const waitArg = wait ? "-Wait" : "";
  return runPS(`
try {
  $p = Start-Process -FilePath '${executable}' -ArgumentList '${processArgs}' \`
    -WindowStyle ${wstyle} ${cwd ? `-WorkingDirectory '${cwd}'` : ""} ${waitArg} -PassThru -EA Stop
  [PSCustomObject]@{ success=$true; pid=if($p){$p.Id}else{$null}; executable='${executable}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, 120_000);
}

export async function getProcessDetails(args: Record<string, unknown>): Promise<unknown> {
  const name = args.name as string | undefined;
  const pid  = args.pid  as number | undefined;
  if (!name && pid == null) return { error: "Provide name or pid" };

  const safe   = name ? name.replace(/['"]/g, "") : "";
  const lookup = pid != null ? `Get-Process -Id ${pid} -EA Stop | Select-Object -First 1` : `Get-Process -Name "${safe}" -EA Stop | Select-Object -First 1`;

  return runPS(`
try {
  $p = ${lookup}
  $modules = try { @($p.Modules | Select-Object -First 30 | ForEach-Object {$_.ModuleName}) } catch { @() }
  $cmdline = try {
    (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -EA Stop).CommandLine
  } catch { '' }
  $parent = try {
    $ppid = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -EA Stop).ParentProcessId
    (Get-Process -Id $ppid -EA Stop).Name
  } catch { '' }
  [PSCustomObject]@{
    name         = $p.Name; pid=$p.Id; parent=$parent
    command_line = $cmdline
    cpu_s        = [math]::Round($p.CPU,2)
    ram_mb       = [math]::Round($p.WorkingSet/1MB,1)
    peak_mb      = [math]::Round($p.PeakWorkingSet/1MB,1)
    threads      = $p.Threads.Count; handles=$p.HandleCount
    priority     = try{$p.PriorityClass.ToString()}catch{'N/A'}
    start_time   = try{$p.StartTime.ToString('yyyy-MM-dd HH:mm:ss')}catch{''}
    path         = $p.Path
    company      = $p.Company; version=$p.FileVersion
    responding   = $p.Responding
    modules_sample = @($modules)
  } | ConvertTo-Json -Depth 3
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function setProcessAffinity(args: Record<string, unknown>): Promise<unknown> {
  const name  = args.name  as string | undefined;
  const pid   = args.pid   as number | undefined;
  const cores = args.cores as number[] | undefined;

  if (!name && pid == null) return { error: "Provide name or pid" };
  if (!cores || !cores.length) return { error: "cores array is required (e.g. [0,1,2,3])" };

  const safe   = name ? name.replace(/['"]/g, "") : "";
  const target = pid != null ? `-Id ${pid}` : `-Name "${safe}"`;
  // Build affinity mask: bit N = core N
  const mask   = cores.reduce((acc, c) => acc | (1 << c), 0);

  return runPS(`
try {
  $procs = Get-Process ${target} -EA Stop
  $procs | ForEach-Object { $_.ProcessorAffinity = ${mask} }
  [PSCustomObject]@{ success=$true; cores=@(${JSON.stringify(cores)}); affinity_mask=${mask} } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function suspendProcess(args: Record<string, unknown>): Promise<unknown> {
  const pid    = args.pid    as number | undefined;
  const name   = args.name   as string | undefined;
  const action = (args.action as string) || "suspend";

  if (action !== "suspend" && action !== "resume") return { error: "action must be suspend or resume" };
  if (pid == null && !name) return { error: "Provide pid or name" };

  const safe   = name ? name.replace(/['"]/g, "") : "";
  const lookup = pid != null ? `(Get-Process -Id ${pid} -EA Stop).Id` : `(Get-Process -Name "${safe}" -EA Stop | Select-Object -First 1).Id`;

  return runPS(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NtProc {
    [DllImport("ntdll.dll")] public static extern uint NtSuspendProcess(IntPtr h);
    [DllImport("ntdll.dll")] public static extern uint NtResumeProcess(IntPtr h);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint acc, bool inh, int pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    public const uint SR = 0x0800;
}
"@
try {
  $proc_pid = ${lookup}
  $h = [NtProc]::OpenProcess([NtProc]::SR, $false, $proc_pid)
  if ($h -eq [IntPtr]::Zero) { throw "Cannot open process $proc_pid" }
  $r = if ('${action}' -eq 'suspend') {[NtProc]::NtSuspendProcess($h)} else {[NtProc]::NtResumeProcess($h)}
  [NtProc]::CloseHandle($h)
  [PSCustomObject]@{ success=$true; action='${action}'; pid=$proc_pid; ntstatus=[string]::Format('0x{0:X8}',$r) } | ConvertTo-Json
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json
}
`);
}
