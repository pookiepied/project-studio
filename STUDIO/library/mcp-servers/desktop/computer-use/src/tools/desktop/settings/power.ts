import { runPS } from "../ps-helper.js";

export async function listPowerPlans(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$raw = & powercfg /list 2>&1
$active = (& powercfg /getactivescheme 2>&1) -join ''
$activeGuid = if ($active -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { $Matches[1] } else { '' }
$plans = $raw | Where-Object {$_ -match 'Power Scheme GUID'} | ForEach-Object {
  if ($_ -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\s+\\((.+?)\\)') {
    [PSCustomObject]@{ guid=$Matches[1]; name=$Matches[2].Trim(); active=($Matches[1] -eq $activeGuid) }
  }
}
@($plans) | ConvertTo-Json -AsArray
`);
}

export async function setPowerPlan(args: Record<string, unknown>): Promise<unknown> {
  const guid = args.guid as string | undefined;
  const name = args.name as string | undefined;
  if (!guid && !name) return { error: "Provide guid or name of the power plan" };

  const safeGuid = guid ? guid.replace(/['"]/g, "") : "";
  const safeName = name ? name.replace(/['"]/g, "") : "";

  return runPS(`
try {
  if ('${safeGuid}') {
    & powercfg /setactive ${safeGuid} | Out-Null
    [PSCustomObject]@{ success=$true; activated_guid='${safeGuid}' } | ConvertTo-Json
  } else {
    $raw = & powercfg /list 2>&1
    $match = $raw | Where-Object {$_ -like '*${safeName}*'} | Select-Object -First 1
    if ($match -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
      & powercfg /setactive $Matches[1] | Out-Null
      [PSCustomObject]@{ success=$true; activated_guid=$Matches[1]; name='${safeName}' } | ConvertTo-Json
    } else {
      [PSCustomObject]@{ success=$false; error="Power plan '${safeName}' not found" } | ConvertTo-Json
    }
  }
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function systemPowerAction(args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;
  const delay  = (args.delay_seconds as number) || 0;

  const scriptMap: Record<string, string> = {
    shutdown:  `Stop-Computer   -Force`,
    restart:   `Restart-Computer -Force`,
    sleep:     `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)`,
    hibernate: `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Hibernate', $false, $false)`,
    lock:      `& rundll32.exe user32.dll,LockWorkStation`,
    logoff:    `& logoff`,
  };

  const cmd = scriptMap[action];
  if (!cmd) return { error: `Unknown action '${action}'. Use: shutdown, restart, sleep, hibernate, lock, logoff` };

  const delayScript = delay > 0 ? `Start-Sleep -Seconds ${delay}; ` : "";

  return runPS(`
try {
  ${delayScript}${cmd}
  [PSCustomObject]@{ success=$true; action='${action}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, 90_000);
}
