import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { environmentService } from "./environmentService";

function conversationUrl(conversationId: string) {
  const params = new URLSearchParams({
    view: "chat",
    conversationId,
  });
  return `/?${params.toString()}`;
}

export async function openConversationWindow(conversationId: string) {
  const url = conversationUrl(conversationId);

  if (!environmentService.isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const label = `conversation-${conversationId}-${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const win = new WebviewWindow(label, {
    url,
    title: "Studio",
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    decorations: false,
    transparent: true,
    shadow: false,
    visible: true,
    resizable: true,
    focus: true,
  });

  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (event) => reject(event.payload));
  });
}
