/**
 * Desktop notification helper.
 *
 * Shows a system notification only when the app window is not focused, so
 * the user is alerted while working in another window. Gracefully degrades
 * outside Tauri or when notification permission is denied.
 */

export async function notifyPermissionRequired(body: string): Promise<void> {
  try {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const [{ getCurrentWindow }, { isPermissionGranted, requestPermission, sendNotification }] =
      await Promise.all([
        import("@tauri-apps/api/window"),
        import("@tauri-apps/plugin-notification"),
      ]);
    const focused = await getCurrentWindow().isFocused();
    if (focused) return;
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) {
      await sendNotification({ title: "STUDIO", body });
    }
  } catch {
    // Notification failures are non-fatal — silently ignored.
  }
}
