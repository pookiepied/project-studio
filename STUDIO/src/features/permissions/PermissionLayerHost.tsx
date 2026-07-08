import { useChat } from "@/features/chat/context";
import { useSettings } from "../../contexts/SettingsContext";
import { usePermissionNotifications } from "./hooks/usePermissionNotifications";

/**
 * Headless permission notification host.
 *
 * Mounted once inside `ChatProvider` (and therefore active for every page in
 * the app - Chat, Settings, Computer Use, etc.). It wires the OS-notification
 * hook up so a click-to-focus toast fires any time a tool call enters
 * `pending_approval` while the STUDIO window is unfocused (minimised, blurred,
 * or sitting in the system tray).
 *
 * The hook:
 *   - reads `activeToolCalls` (held in ChatProvider state - survives page
 *     navigation because ChatProvider wraps the page switcher),
 *   - delegates to `resolveToolApproval` from `useChat()` (which feeds
 *     `pendingApprovalResolveRef` in ChatProvider - the ONE execution-sided
 *     resolver).
 *
 * It renders nothing. The visible review-mode prompt is the
 * {@link ComposerApprovalCard} mounted on the chat page above the composer.
 */
export function PermissionLayerHost() {
  const { activeToolCalls, resolveToolApproval, resolveGlobalAccess } = useChat();
  const { settings } = useSettings();
  // Show notifications only when the user enabled them in Settings. The
  // existing logical toggle (`showNotifications`) is the right gate - same
  // flag already drives conversation-done and permission-needed toasts, so
  // there is one preference surface.
  usePermissionNotifications({
    activeToolCalls,
    onDecision: resolveToolApproval,
    onGlobalAccessDecision: resolveGlobalAccess,
    notificationsEnabled: !!settings.showNotifications,
  });
  return null;
}
