import { runPS } from "../ps-helper.js";
import { TOOL_TIMEOUTS } from "../../tool-contract.js";

export async function pingHost(args: Record<string, unknown>): Promise<unknown> {
  const host  = (args.host  as string || "").replace(/['"]/g, "");
  const count = (args.count as number) || 4;
  if (!host) return { error: "host is required" };

  return runPS(`
try {
  $pings = Test-Connection -ComputerName "${host}" -Count ${count} -EA Stop |
    Select-Object Address, @{N='rtt_ms';E={$_.ResponseTime}}, @{N='status';E={if($_.StatusCode -eq 0){'success'}else{'failed'}}}
  $ok  = @($pings | Where-Object {$_.status -eq 'success'})
  [PSCustomObject]@{
    host="${host}"; sent=${count}; received=$ok.Count
    lost=${count} - $ok.Count; loss_pct=[math]::Round((${count} - $ok.Count)/${count}*100,0)
    avg_ms  = if($ok.Count){[math]::Round(($ok | Measure-Object rtt_ms -Average).Average,1)}else{$null}
    min_ms  = if($ok.Count){($ok | Measure-Object rtt_ms -Min).Min}else{$null}
    max_ms  = if($ok.Count){($ok | Measure-Object rtt_ms -Max).Max}else{$null}
    replies = @($pings)
  } | ConvertTo-Json -Depth 3
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, TOOL_TIMEOUTS.LOCAL_PROCESS);
}

export async function checkPort(args: Record<string, unknown>): Promise<unknown> {
  const host       = (args.host as string || "").replace(/['"]/g, "");
  const port       = args.port as number;
  const timeoutMs  = (args.timeout_ms as number) || 3000;
  if (!host || port == null) return { error: "host and port are required" };

  return runPS(`
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $ar  = $tcp.BeginConnect("${host}", ${port}, $null, $null)
  $ok  = $ar.AsyncWaitHandle.WaitOne(${timeoutMs}, $false)
  if ($ok -and $tcp.Connected) { $tcp.EndConnect($ar) } else { $ok = $false }
  $tcp.Close()
  [PSCustomObject]@{ host="${host}"; port=${port}; open=$ok; timeout_ms=${timeoutMs} } | ConvertTo-Json
} catch { [PSCustomObject]@{ host="${host}"; port=${port}; open=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, TOOL_TIMEOUTS.FAST_QUERY);
}

export async function dnsLookup(args: Record<string, unknown>): Promise<unknown> {
  const host = (args.host as string || "").replace(/['"]/g, "");
  const type = ((args.type as string) || "A").replace(/[^A-Za-z]/g, "");
  if (!host) return { error: "host is required" };

  return runPS(`
try {
  $records = Resolve-DnsName -Name "${host}" -Type ${type} -EA Stop |
    Select-Object Name, Type, TTL,
      @{N='data';E={
        if     ($_.IPAddress)  { $_.IPAddress }
        elseif ($_.NameHost)   { $_.NameHost  }
        elseif ($_.Strings)    { $_.Strings -join ' ' }
        else                   { '' }
      }}
  @($records) | ConvertTo-Json -AsArray
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`, TOOL_TIMEOUTS.FAST_QUERY);
}

export async function traceroute(args: Record<string, unknown>): Promise<unknown> {
  const host    = (args.host     as string || "").replace(/['"]/g, "");
  const maxHops = (args.max_hops as number) || 30;
  if (!host) return { error: "host is required" };

  return runPS(`
try {
  $r = Test-NetConnection -ComputerName "${host}" -TraceRoute -Hops ${maxHops} -WarningAction SilentlyContinue -EA Stop
  $hops = @($r.TraceRoute | ForEach-Object { $_.ToString() })
  [PSCustomObject]@{
    host="${host}"; reachable=$r.PingSucceeded
    remote_address=$r.RemoteAddress.ToString(); hops=@($hops)
  } | ConvertTo-Json -Depth 3
} catch {
  $raw = & tracert -h ${maxHops} -d "${host}" 2>&1 | Select-Object -Skip 3
  [PSCustomObject]@{ host="${host}"; raw=($raw -join "\`n") } | ConvertTo-Json
}
// 90 s = 30 hops × 3 s max each — intentionally longer than TOOL_TIMEOUTS.NETWORK
`, 90_000);
}
