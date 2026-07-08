import { runPS } from "../ps-helper.js";

export async function listGroups(args: Record<string, unknown>): Promise<unknown> {
  const includeMembers = args.include_members as boolean;

  return runPS(`
try {
  $groups = Get-LocalGroup | ForEach-Object {
    $g = [PSCustomObject]@{ name=$_.Name; description=$_.Description; members=@() }
    if (${ includeMembers ? "$true" : "$false" }) {
      $g.members = @(Get-LocalGroupMember -Group $_.Name -EA SilentlyContinue |
        Select-Object Name, ObjectClass, PrincipalSource)
    }
    $g
  }
  @($groups) | ConvertTo-Json -Depth 4 -AsArray
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function getGroupMembers(args: Record<string, unknown>): Promise<unknown> {
  const group = (args.group as string || "").replace(/['"]/g, "");
  if (!group) return { error: "group is required" };

  return runPS(`
try {
  $members = Get-LocalGroupMember -Group "${group}" -EA Stop |
    Select-Object Name, ObjectClass, PrincipalSource
  @($members) | ConvertTo-Json -AsArray
} catch { [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function manageGroupMember(args: Record<string, unknown>): Promise<unknown> {
  const action   = (args.action   as string || "").toLowerCase(); // add | remove
  const group    = (args.group    as string || "").replace(/['"]/g, "");
  const username = (args.username as string || "").replace(/['"]/g, "");

  if (!action || !group || !username) return { error: "action (add|remove), group, and username are required" };
  const cmd = action === "add" ? "Add-LocalGroupMember" : "Remove-LocalGroupMember";

  return runPS(`
try {
  ${cmd} -Group "${group}" -Member "${username}" -EA Stop
  [PSCustomObject]@{ success=$true; action="${action}"; group="${group}"; user="${username}" } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}
