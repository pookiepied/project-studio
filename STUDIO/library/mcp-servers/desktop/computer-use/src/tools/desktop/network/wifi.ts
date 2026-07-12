import { runPS } from "../ps-helper.js";

export async function listWifiNetworks(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
try {
  $raw = & netsh wlan show networks mode=Bssid 2>&1
  $networks = [System.Collections.Generic.List[object]]::new()
  $cur = $null
  foreach ($line in $raw) {
    if ($line -match '^SSID\s+\d+\s*:\s*(.+)$') {
      if ($cur) { $networks.Add($cur) | Out-Null }
      $cur = [PSCustomObject]@{ ssid=$Matches[1].Trim(); auth=''; encryption=''; signal=0; bssids=@() }
    } elseif ($cur) {
      if      ($line -match 'Authentication\s*:\s*(.+)')   { $cur.auth=$Matches[1].Trim() }
      elseif  ($line -match 'Encryption\s*:\s*(.+)')       { $cur.encryption=$Matches[1].Trim() }
      elseif  ($line -match 'Signal\s*:\s*(\d+)%')         { $cur.signal=[int]$Matches[1] }
      elseif  ($line -match 'BSSID\s+\d+\s*:\s*(.+)')      { $cur.bssids += $Matches[1].Trim() }
    }
  }
  if ($cur) { $networks.Add($cur) | Out-Null }

  $iface   = (& netsh wlan show interfaces 2>&1) -join "\`n"
  $connSSID= if ($iface -match '(?m)^\s+SSID\s*:\s*(.+)$') { $Matches[1].Trim() } else { '' }
  $result  = @($networks | ForEach-Object {
    $_ | Add-Member -NotePropertyName connected -NotePropertyValue ($_.ssid -eq $connSSID) -PassThru
  })
  @($result) | ConvertTo-Json -AsArray
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`, 20_000);
}

export async function getWifiStatus(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
try {
  $raw    = (& netsh wlan show interfaces 2>&1) -join "\`n"
  $state  = if ($raw -match '(?m)^\s+State\s*:\s*(.+)$')              { $Matches[1].Trim() } else { 'unknown' }
  $ssid   = if ($raw -match '(?m)^\s+SSID\s*:\s*(.+)$')              { $Matches[1].Trim() } else { '' }
  $bssid  = if ($raw -match '(?m)^\s+BSSID\s*:\s*(.+)$')             { $Matches[1].Trim() } else { '' }
  $signal = if ($raw -match '(?m)^\s+Signal\s*:\s*(\d+)%')            { [int]$Matches[1] }   else { 0 }
  $chan   = if ($raw -match '(?m)^\s+Channel\s*:\s*(\d+)')            { [int]$Matches[1] }   else { 0 }
  $recv   = if ($raw -match '(?m)^\s+Receive rate.*?:\s*([\d.]+)')    { $Matches[1] }        else { '' }
  $send   = if ($raw -match '(?m)^\s+Transmit rate.*?:\s*([\d.]+)')   { $Matches[1] }        else { '' }
  [PSCustomObject]@{
    state=$state; ssid=$ssid; bssid=$bssid
    signal_pct=$signal; channel=$chan
    recv_mbps=$recv; send_mbps=$send
  } | ConvertTo-Json
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function connectWifi(args: Record<string, unknown>): Promise<unknown> {
  const ssid     = (args.ssid     as string || "").replace(/['"<>&]/g, "");
  const password = args.password  as string | undefined;
  if (!ssid) return { error: "ssid is required" };

  const profileXml = password
    ? `$profileXml = @"
<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${ssid}</name><SSIDConfig><SSID><name>${ssid}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType><connectionMode>auto</connectionMode>
  <MSM><security>
    <authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
    <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${(password as string).replace(/[<>&'"]/g, "")}</keyMaterial></sharedKey>
  </security></MSM>
</WLANProfile>
"@
$tmp = "$env:TEMP\\wifi-$([datetime]::Now.Ticks).xml"
$profileXml | Out-File $tmp -Encoding UTF8 -NoNewline
& netsh wlan add profile filename="$tmp" | Out-Null
Remove-Item $tmp -EA SilentlyContinue`
    : "";

  return runPS(`
try {
  ${profileXml}
  $out = & netsh wlan connect name="${ssid}" 2>&1
  Start-Sleep -Seconds 3
  $iface   = (& netsh wlan show interfaces 2>&1) -join "\`n"
  $curSsid = if ($iface -match '(?m)^\s+SSID\s*:\s*(.+)$') { $Matches[1].Trim() } else { '' }
  $state   = if ($iface -match '(?m)^\s+State\s*:\s*(.+)$') { $Matches[1].Trim() } else { '' }
  [PSCustomObject]@{ success=($state -eq 'connected'); ssid="${ssid}"; state=$state; connected_to=$curSsid } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, 30_000);
}

export async function disconnectWifi(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
try {
  $out = & netsh wlan disconnect 2>&1
  [PSCustomObject]@{ success=$true; output=($out -join ' ') } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
