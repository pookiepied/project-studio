import React from "react";
import {
  Code,
  Cloud,
  DatabaseIcon,
  Email,
  Icon,
  type IconSize,
  Lightning,
  Calendar,
  GithubLogoIcon,
} from "@/ui/icons";

function Context7RegistryIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className}>
      <path d="M10.5724 15.2565C10.5724 17.5025 9.6613 19.3778 8.17805 21.1047H11.6319L11.6319 22.7786H6.33459V21.1895C7.95557 19.3566 8.58065 17.8628 8.58065 15.2565L10.5724 15.2565Z" fill="currentColor" />
      <path d="M17.4276 15.2565C17.4276 17.5025 18.3387 19.3778 19.822 21.1047H16.3681V22.7786H21.6654V21.1895C20.0444 19.3566 19.4194 17.8628 19.4194 15.2565H17.4276Z" fill="currentColor" />
      <path d="M10.5724 12.7435C10.5724 10.4975 9.66131 8.62224 8.17807 6.89532L11.6319 6.89532V5.22137L6.33461 5.22137V6.81056C7.95558 8.64343 8.58066 10.1373 8.58066 12.7435L10.5724 12.7435Z" fill="currentColor" />
      <path d="M17.4276 12.7435C17.4276 10.4975 18.3387 8.62224 19.822 6.89532L16.3681 6.89532L16.3681 5.22138L21.6654 5.22138V6.81056C20.0444 8.64343 19.4194 10.1373 19.4194 12.7435H17.4276Z" fill="currentColor" />
    </svg>
  );
}

export interface McpServiceInfo {
  displayName: string;
  /** Returns an icon element sized to `size` with `className`. */
  getIcon: (size: IconSize, className: string) => React.ReactNode;
}

// ── Minimal SVG brand icons ──────────────────────────────────────────────────
// Third-party service brand marks (Gmail, Google Calendar/Drive/Sheets/Tasks…).
// Official brand hues are required and have no neutral-token equivalent (§17 brand carve-out).
/* eslint-disable no-restricted-syntax */

function GmailIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect x="2" y="4" width="20" height="16" rx="2" fill="#fce8e6" />
      <path d="M2 6l10 7 10-7" stroke="#EA4335" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M2 6v12h20V6" fill="none" stroke="#EA4335" strokeWidth="1.5" />
    </svg>
  );
}

function GoogleCalendarIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="#4285F4" strokeWidth="1.5" fill="#e8f0fe" />
      <path d="M3 10h18" stroke="#4285F4" strokeWidth="1.5" />
      <path d="M8 3v4M16 3v4" stroke="#4285F4" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="7" y="14" width="4" height="3" rx="0.5" fill="#4285F4" opacity="0.7" />
    </svg>
  );
}

function GoogleDriveIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M8.5 3h7L22 17H2L8.5 3z" fill="#4285F4" opacity="0.15" />
      <path d="M8.5 3L2 17h6l6.5-14z" fill="#4285F4" />
      <path d="M15.5 3L22 17h-6l-6.5-14z" fill="#FBBC05" />
      <path d="M2 17l3 4h14l3-4z" fill="#34A853" />
    </svg>
  );
}

function GoogleSheetsIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect x="3" y="2" width="18" height="20" rx="2" fill="#e6f4ea" stroke="#0F9D58" strokeWidth="1.5" />
      <path d="M3 8h18M10 2v20" stroke="#0F9D58" strokeWidth="1.5" opacity="0.6" />
      <path d="M3 14h18M3 20h18" stroke="#0F9D58" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

function GoogleTasksIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#e8f0fe" stroke="#1A73E8" strokeWidth="1.5" />
      <path d="M8 12l3 3 5-5" stroke="#1A73E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* eslint-enable no-restricted-syntax */

// ── Service map ──────────────────────────────────────────────────────────────

// Keys must be lowercase. Match order matters — more specific keys first.
const SERVICE_MAP: Record<string, McpServiceInfo> = {
  gmail: {
    displayName: "Gmail",
    getIcon: (s, c) => <GmailIcon size={iconSizeOf(s)} className={c} />,
  },
  googlecalendar: {
    displayName: "Google Calendar",
    getIcon: (s, c) => <GoogleCalendarIcon size={iconSizeOf(s)} className={c} />,
  },
  google_calendar: {
    displayName: "Google Calendar",
    getIcon: (s, c) => <GoogleCalendarIcon size={iconSizeOf(s)} className={c} />,
  },
  googledrive: {
    displayName: "Google Drive",
    getIcon: (s, c) => <GoogleDriveIcon size={iconSizeOf(s)} className={c} />,
  },
  google_drive: {
    displayName: "Google Drive",
    getIcon: (s, c) => <GoogleDriveIcon size={iconSizeOf(s)} className={c} />,
  },
  googlesheets: {
    displayName: "Google Sheets",
    getIcon: (s, c) => <GoogleSheetsIcon size={iconSizeOf(s)} className={c} />,
  },
  google_sheets: {
    displayName: "Google Sheets",
    getIcon: (s, c) => <GoogleSheetsIcon size={iconSizeOf(s)} className={c} />,
  },
  googletasks: {
    displayName: "Google Tasks",
    getIcon: (s, c) => <GoogleTasksIcon size={iconSizeOf(s)} className={c} />,
  },
  google_tasks: {
    displayName: "Google Tasks",
    getIcon: (s, c) => <GoogleTasksIcon size={iconSizeOf(s)} className={c} />,
  },
  github: {
    displayName: "GitHub",
    getIcon: (s, c) => <Icon icon={GithubLogoIcon} size={s} weight="fill" className={c} />,
  },
  context7: {
    displayName: "Context7",
    getIcon: (s, c) => <Context7RegistryIcon size={iconSizeOf(s)} className={c} />,
  },
  studio: {
    displayName: "Studio",
    getIcon: (s, c) => <Code size={s} className={c} />,
  },
  local: {
    displayName: "Local",
    getIcon: (s, c) => <Lightning size={s} weight="fill" className={c} />,
  },
  email: {
    displayName: "Email",
    getIcon: (s, c) => <Email size={s} className={c} />,
  },
  calendar: {
    displayName: "Calendar",
    getIcon: (s, c) => <Calendar size={s} className={c} />,
  },
  drive: {
    displayName: "Drive",
    getIcon: (s, c) => <Cloud size={s} className={c} />,
  },
  sheets: {
    displayName: "Sheets",
    getIcon: (s, c) => <Icon icon={DatabaseIcon} size={s} className={c} />,
  },
};

/** Map an IconSize keyword back to a pixel value for hand-rolled SVG brand marks. */
function iconSizeOf(s: IconSize): number {
  switch (s) {
    case "xs": return 12;
    case "sm": return 14;
    case "md": return 16;
    case "lg": return 20;
    case "xl": return 24;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve an MCP tool name (e.g. "mcp_composio__gmail_send_email") to its
 * service display info, or null if unrecognized.
 */
export function resolveMcpService(toolName: string): McpServiceInfo | null {
  const match = toolName.match(/^mcp_(.+?)__(.+)$/i);
  if (!match) return null;

  const serverPart = match[1].toLowerCase();
  const actionPart = match[2].toLowerCase();

  // Direct server name match (e.g. mcp_studio__tool, mcp_github__tool)
  if (SERVICE_MAP[serverPart]) return SERVICE_MAP[serverPart];

  // Server name contains a key (e.g. mcp_studio_harness__tool)
  for (const [key, info] of Object.entries(SERVICE_MAP)) {
    if (serverPart.includes(key)) return info;
  }

  // Composio-style: mcp_composio__gmail_send_email
  if (serverPart === "composio") {
    for (const [key, info] of Object.entries(SERVICE_MAP)) {
      if (actionPart.startsWith(key + "_") || actionPart === key) return info;
    }
    // Fallback: check if the action contains a service keyword
    for (const [key, info] of Object.entries(SERVICE_MAP)) {
      if (actionPart.includes(key)) return info;
    }
  }

  return null;
}

/**
 * Extract a clean, human-readable action label from an MCP tool name.
 * "mcp_composio__gmail_send_email" → "Send Email"
 * "mcp_studio_harness__read_file"   → "Read File"
 */
export function getMcpActionLabel(toolName: string): string {
  const match = toolName.match(/^mcp_(.+?)__(.+)$/i);
  if (!match) return toolName;

  const serverPart = match[1].toLowerCase();
  let action = match[2];

  // Strip service prefix from Composio actions
  if (serverPart === "composio") {
    const actionLower = action.toLowerCase();
    for (const key of Object.keys(SERVICE_MAP)) {
      if (actionLower.startsWith(key + "_")) {
        action = action.slice(key.length + 1);
        break;
      }
    }
  }

  // snake_case / SCREAMING_SNAKE → Title Case
  return action
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
