import { runPS } from "../ps-helper.js";

export async function listAdapters(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$adapters = Get-NetAdapter -EA SilentlyContinue | ForEach-Object {
  $idx  = $_.ifIndex
  $ip   = Get-NetIPAddress   -InterfaceIndex $idx -AddressFamily IPv4 -EA SilentlyContinue | Select-Object -First 1
  $gw   = Get-NetRoute       -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -EA SilentlyContinue | Select-Object -First 1
  $dns  = (Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4 -EA SilentlyContinue).ServerAddresses
  $dhcp = (Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -EA SilentlyContinue).Dhcp
  [PSCustomObject]@{
    name=$_.Name; description=$_.InterfaceDescription; status=$_.Status
    mac=$_.MacAddress; speed=$_.LinkSpeed; type=$_.MediaType
    ip=$ip.IPAddress; prefix_length=$ip.PrefixLength
    gateway=$gw.NextHop; dns=@($dns); dhcp=$dhcp
  }
}
@($adapters) | ConvertTo-Json -Depth 3 -AsArray
`);
}

export async function enableAdapter(args: Record<string, unknown>): Promise<unknown> {
  const name = (args.name as string || "").replace(/['"]/g, "");
  if (!name) return { error: "name is required" };

  return runPS(`
try {
  Enable-NetAdapter -Name "${name}" -Confirm:$false -EA Stop
  $s = (Get-NetAdapter -Name "${name}").Status
  [PSCustomObject]@{ success=$true; name="${name}"; status=$s } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function disableAdapter(args: Record<string, unknown>): Promise<unknown> {
  const name = (args.name as string || "").replace(/['"]/g, "");
  if (!name) return { error: "name is required" };

  return runPS(`
try {
  Disable-NetAdapter -Name "${name}" -Confirm:$false -EA Stop
  [PSCustomObject]@{ success=$true; name="${name}"; status='Disabled' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function setStaticIp(args: Record<string, unknown>): Promise<unknown> {
  const name    = (args.name    as string || "").replace(/['"]/g, "");
  const ip      = (args.ip      as string || "").replace(/['"]/g, "");
  const prefix  = (args.prefix  as number) || 24;
  const gateway = (args.gateway as string | undefined)?.replace(/['"]/g, "");
  const dnsRaw  = args.dns;

  if (!name || !ip) return { error: "name and ip are required" };

  const dnsArr = Array.isArray(dnsRaw)
    ? (dnsRaw as string[]).map(s => s.replace(/['"]/g, "")).join("','")
    : dnsRaw ? (dnsRaw as string).replace(/['"]/g, "") : "";

  const gwScript  = gateway ? `New-NetRoute -InterfaceAlias "${name}" -DestinationPrefix '0.0.0.0/0' -NextHop '${gateway}' -EA SilentlyContinue | Out-Null` : "";
  const dnsScript = dnsArr  ? `Set-DnsClientServerAddress -InterfaceAlias "${name}" -ServerAddresses @('${dnsArr}') -EA SilentlyContinue` : "";

  return runPS(`
try {
  Get-NetIPAddress -InterfaceAlias "${name}" -AddressFamily IPv4 -EA SilentlyContinue | Remove-NetIPAddress -Confirm:$false -EA SilentlyContinue
  Get-NetRoute     -InterfaceAlias "${name}" -DestinationPrefix '0.0.0.0/0'           -EA SilentlyContinue | Remove-NetRoute     -Confirm:$false -EA SilentlyContinue
  New-NetIPAddress -InterfaceAlias "${name}" -IPAddress "${ip}" -PrefixLength ${prefix} -EA Stop | Out-Null
  ${gwScript}
  ${dnsScript}
  [PSCustomObject]@{ success=$true; name="${name}"; ip="${ip}"; prefix=${prefix} } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function setDhcp(args: Record<string, unknown>): Promise<unknown> {
  const name = (args.name as string || "").replace(/['"]/g, "");
  if (!name) return { error: "name is required" };

  return runPS(`
try {
  Set-NetIPInterface         -InterfaceAlias "${name}" -Dhcp Enabled -EA Stop
  Set-DnsClientServerAddress -InterfaceAlias "${name}" -ResetServerAddresses -EA SilentlyContinue
  [PSCustomObject]@{ success=$true; name="${name}"; dhcp=$true } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
