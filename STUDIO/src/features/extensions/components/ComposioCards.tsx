/**
 * Composio app cards (browse grid) and the Featured cards section.
 *
 * App brand colours (iconColor / iconBg / brand glyphs) are the §17 multi-colour
 * brand-logo carve-out and are kept. Card chrome, status, and toggles are
 * strict-neutral (D-401).
 */
import { PlusIcon as Plus } from "@phosphor-icons/react";
import { Success, Icon } from "@/ui/icons";
import { AppLogo } from "@/ui/brand";
import { Toggle } from "@/ui/primitives/Toggle";
import { Button } from "@/ui/primitives/Button";
import { Badge } from "@/ui/primitives/Badge";
import type { ComposioApp, ComposioConnection } from "@/features/extensions/services/composioService";
import { StatusDot, GithubLetterIcon } from "./ExtensionIcons";

// ─── Composio app browse card ─────────────────────────────────────────────────
export const ComposioAppBrowseCard = ({
  app, connected, polling, onClick, onToggle,
}: {
  app:       ComposioApp;
  connected: ComposioConnection | undefined;
  polling:   boolean;
  onClick?:  () => void;
  onToggle?: () => void;
}) => {
  const isActive  = connected?.status === "ACTIVE";
  const isPending = !!connected && !isActive;
  return (
    <div
      onClick={onClick}
      className="cursor-pointer border border-surface-border rounded-2xl p-3 flex flex-col gap-2.5 bg-surface-base hover:bg-surface-hover hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between">
        <AppLogo
          src={app.logo}
          label={app.name}
          size="md"
          className="bg-surface-raised border border-surface-border"
          fallback={
            <span className="text-xs font-bold text-muted select-none">
              {app.name.charAt(0).toUpperCase()}
            </span>
          }
        />
        {isActive && (
          <div className="flex items-center gap-1.5">
            <StatusDot state="running" />
            <span className="text-2xs text-muted">Connected</span>
          </div>
        )}
        {isPending && (
          <Badge tone="default" size="sm">{polling ? "Authorizing…" : "Pending"}</Badge>
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-primary leading-tight">{app.name}</p>
        <p className="text-xs text-muted mt-0.5">by Composio</p>
      </div>
      {app.description && (
        <p className="text-xs text-muted leading-relaxed line-clamp-2">{app.description}</p>
      )}
      {isActive && (
        <div className="flex items-center gap-2 pt-2 border-t border-surface-divider" onClick={e => e.stopPropagation()}>
          <Toggle
            size="sm"
            checked={!!connected?.enabled}
            onChange={() => onToggle?.()}
            aria-label={connected?.enabled ? "Disable tools" : "Enable tools"}
          />
          <span className="text-2xs text-muted">
            {connected?.enabled ? "Active" : "Disabled"}
          </span>
        </div>
      )}
    </div>
  );
};

// ─── Featured cards ────────────────────────────────────────────────────────────
export interface FeaturedAppDef {
  id:          string;
  name:        string;
  developer:   string;
  description: string;
  kind:        "composio" | "bundled";
  iconColor:   string;
  iconBg:      string;
  iconLetter?: string;
  iconNode?:   React.ReactNode;
}

// App brand icon colours (iconColor/iconBg) — official brand hues per §17/D-408
// brand carve-out; no neutral-token equivalent.
/* eslint-disable no-restricted-syntax */
export const FEATURED_APPS: FeaturedAppDef[] = [
  { id: "gmail",            name: "Gmail",    developer: "Google",      description: "Read, draft and send emails",                  kind: "composio", iconColor: "#EA4335", iconBg: "#fef2f2", iconLetter: "G" },
  { id: "github",           name: "GitHub",   developer: "GitHub",      description: "Triage PRs, issues, CI, and publish",          kind: "composio", iconColor: "#1a1a1a", iconBg: "#f6f8fa" },
  { id: "slack",            name: "Slack",    developer: "Slack",       description: "Read and manage Slack",                        kind: "composio", iconColor: "#611F69", iconBg: "#f4f0f8", iconLetter: "S" },
  { id: "googlecalendar",   name: "Calendar", developer: "Google",      description: "Schedule meetings and events",                  kind: "composio", iconColor: "#0F9D58", iconBg: "#f0fdf4", iconLetter: "C" },
  { id: "notion",           name: "Notion",   developer: "Notion Labs", description: "Create and search notes, pages, databases",    kind: "composio", iconColor: "#000000", iconBg: "#f7f6f3", iconLetter: "N" },
];
/* eslint-enable no-restricted-syntax */

interface FeaturedCardProps {
  app:         FeaturedAppDef;
  isInstalled: boolean;
  onClick:     () => void;
  logo?:       string;
}

export const FeaturedCard = ({ app, isInstalled, onClick, logo }: FeaturedCardProps) => (
  <Button
    variant="ghost"
    onClick={onClick}
    className="flex items-center gap-3 p-3 rounded-2xl border border-surface-border bg-surface-base hover:bg-surface-hover hover:shadow-sm transition-all text-left w-full h-auto justify-start"
  >
    <AppLogo
      src={logo}
      label={app.name}
      size="lg"
      iconBg={app.iconBg}
      iconColor={app.iconColor}
      fallback={
        app.id === "github" ? (
          <GithubLetterIcon size={16} />
        ) : (
          app.iconLetter
        )
      }
    />
    <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold text-primary leading-tight">{app.name}</p>
      <p className="text-2xs text-muted mt-0.5 leading-snug line-clamp-1">{app.description}</p>
    </div>
    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
      isInstalled
        ? "bg-surface-raised text-secondary"
        : "bg-surface-raised text-muted hover:bg-surface-selected"
    }`}>
      {isInstalled ? <Success size="xs" /> : <Icon icon={Plus} size="xs" />}
    </div>
  </Button>
);
