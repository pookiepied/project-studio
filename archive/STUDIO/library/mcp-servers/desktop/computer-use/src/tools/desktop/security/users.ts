import { runPS } from "../ps-helper.js";

export async function listUsers(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
try {
  Get-LocalUser |
    Select-Object Name, Enabled, FullName, Description,
      @{N='last_logon';        E={if($_.LastLogon)        { $_.LastLogon.ToString('yyyy-MM-dd HH:mm') } else { 'Never' }}},
      @{N='password_last_set'; E={if($_.PasswordLastSet)  { $_.PasswordLastSet.ToString('yyyy-MM-dd') } else { '' }}},
      @{N='account_expires';   E={if($_.AccountExpires -and $_.AccountExpires -lt [datetime]::MaxValue) { $_.AccountExpires.ToString('yyyy-MM-dd') } else { 'Never' }}},
      PasswordRequired, UserMayChangePassword |
    ConvertTo-Json -AsArray
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function createUser(args: Record<string, unknown>): Promise<unknown> {
  const username    = (args.username    as string || "").replace(/['"]/g, "");
  const password    = (args.password   as string || "");
  const fullName    = (args.full_name  as string || "").replace(/['"]/g, "");
  const description = (args.description as string || "").replace(/['"]/g, "");
  const noPassword  = args.no_password as boolean;

  if (!username) return { error: "username is required" };

  const pwdScript = noPassword
    ? "-NoPassword"
    : `-Password (ConvertTo-SecureString '${password.replace(/'/g, "''")}' -AsPlainText -Force)`;

  return runPS(`
try {
  New-LocalUser -Name "${username}" ${pwdScript} -FullName "${fullName}" -Description "${description}" -EA Stop | Out-Null
  [PSCustomObject]@{ success=$true; username="${username}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function deleteUser(args: Record<string, unknown>): Promise<unknown> {
  const username = (args.username as string || "").replace(/['"]/g, "");
  if (!username) return { error: "username is required" };

  return runPS(`
try {
  Remove-LocalUser -Name "${username}" -EA Stop
  [PSCustomObject]@{ success=$true; deleted="${username}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function setUserPassword(args: Record<string, unknown>): Promise<unknown> {
  const username = (args.username as string || "").replace(/['"]/g, "");
  const password = (args.password as string || "");
  if (!username || !password) return { error: "username and password are required" };

  return runPS(`
try {
  $pw = ConvertTo-SecureString '${password.replace(/'/g, "''")}' -AsPlainText -Force
  Set-LocalUser -Name "${username}" -Password $pw -EA Stop
  [PSCustomObject]@{ success=$true; username="${username}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function manageUserAccount(args: Record<string, unknown>): Promise<unknown> {
  const username = (args.username as string || "").replace(/['"]/g, "");
  const action   = (args.action   as string || "").toLowerCase(); // enable | disable
  if (!username || !action) return { error: "username and action (enable|disable) are required" };
  const cmd = action === "enable" ? "Enable-LocalUser" : "Disable-LocalUser";

  return runPS(`
try {
  ${cmd} -Name "${username}" -EA Stop
  [PSCustomObject]@{ success=$true; username="${username}"; action="${action}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
