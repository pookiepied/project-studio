import { runPS } from "../ps-helper.js";

export async function getNetworkStats(args: Record<string, unknown>): Promise<unknown> {
  const filter = (args.filter as string) || "all";
  const stateFilter =
    filter === "listening"    ? "| Where-Object State -eq 'Listen'"
    : filter === "established" ? "| Where-Object State -eq 'Established'"
    : "";

  // Build a PID→name map ONCE instead of calling Get-Process per connection.
  // Previous code called Get-Process for each TCP entry — on a busy machine with
  // 100+ connections that was 100+ separate process queries, causing the 25s timeout.
  return runPS(`
$procMap = @{}
Get-Process -EA SilentlyContinue | ForEach-Object { $procMap[[int]$_.Id] = $_.Name }
$conns = Get-NetTCPConnection ${stateFilter} -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State,
    @{N='process';E={if($procMap.ContainsKey([int]$_.OwningProcess)){$procMap[[int]$_.OwningProcess]}else{'unknown'}}} |
  Sort-Object State, LocalPort

$adapters = Get-NetAdapter -ErrorAction SilentlyContinue |
  Where-Object Status -eq 'Up' |
  Select-Object Name, InterfaceDescription, LinkSpeed,
    @{N='ip';E={(Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -EA SilentlyContinue).IPAddress}}

[PSCustomObject]@{ connections=@($conns); adapters=@($adapters) } | ConvertTo-Json -Depth 4
`, 25_000);
}

export async function getNetworkBandwidth(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
try {
  $samples = (Get-Counter '\\Network Interface(*)\\Bytes Received/sec','\\Network Interface(*)\\Bytes Sent/sec' -SampleInterval 1 -MaxSamples 1 -EA Stop).CounterSamples |
    Group-Object InstanceName |
    ForEach-Object {
      $recv = ($_.Group | Where-Object Path -like '*Received*').CookedValue
      $sent = ($_.Group | Where-Object Path -like '*Sent*').CookedValue
      [PSCustomObject]@{ adapter=$_.Name; recv_kb_s=[math]::Round($recv/1KB,1); sent_kb_s=[math]::Round($sent/1KB,1) }
    }
  @($samples) | ConvertTo-Json -AsArray
} catch {
  [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json
}
`, 20_000);
}
