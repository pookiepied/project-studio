/** Tool schema definitions for desktop system-UI tools (clipboard, notifications, dialogs). */
export const DESKTOP_SYSTEM_UI_DEFINITIONS = [
  {
    name: "get_clipboard",
    description: "Read the current Windows clipboard as plain text. Returns the content and its character length.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_clipboard",
    description: "Write text to the Windows clipboard, replacing the current contents.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to copy to clipboard" } },
      required: ["text"],
    },
  },
  {
    name: "send_notification",
    description:
      "Send a Windows toast notification (bottom-right corner + Action Center) via Windows Runtime API. " +
      "Useful for alerting the user when a long background task completes.",
    inputSchema: {
      type: "object",
      properties: {
        title:   { type: "string",  description: "Notification title (default: Computer Use)" },
        message: { type: "string",  description: "Notification body text" },
        sound:   { type: "boolean", description: "Play notification sound (default: true)" },
      },
      required: ["message"],
    },
  },
  {
    name: "show_dialog",
    description:
      "Show a Windows dialog box to the user and wait for their response. " +
      "Types: info, warning, error, question, input (text prompt). " +
      "Buttons: OK, OKCancel, YesNo, YesNoCancel. " +
      "Returns the clicked button or entered text.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Dialog message text" },
        title:   { type: "string", description: "Dialog title (default: Computer Use)" },
        type:    { type: "string", enum: ["info","warning","error","question","input"], description: "Dialog type (default: info)" },
        buttons: { type: "string", enum: ["OK","OKCancel","YesNo","YesNoCancel"], description: "Button set (default: OK)" },
      },
      required: ["message"],
    },
  },
] as const;
