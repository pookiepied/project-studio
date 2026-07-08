import { runPS } from "../ps-helper.js";

export async function sendNotification(args: Record<string, unknown>): Promise<unknown> {
  // Escape for PS single-quoted strings (only ' → ''); strip XML-breaking chars
  const title   = ((args.title   as string) || "Computer Use").replace(/[<>&]/g, "").replace(/'/g, "''");
  const message = ((args.message as string) || "").replace(/[<>&]/g, "").replace(/'/g, "''");
  const sound   = (args.sound as boolean) !== false;

  // Store in single-quoted PS vars so $ signs are literal; use audio element to control sound
  const audioXml = sound ? "" : "<audio silent='true'/>";

  return runPS(`
try {
  [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime] | Out-Null
  $t    = '${title}'
  $m    = '${message}'
  $xml  = "<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$m</text></binding></visual>${audioXml}</toast>"
  $doc  = [Windows.Data.Xml.Dom.XmlDocument]::new()
  $doc.LoadXml($xml)
  $toast= [Windows.UI.Notifications.ToastNotification]::new($doc)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Computer Use").Show($toast)
  [PSCustomObject]@{ success=$true; title=$t } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, 10_000);
}
