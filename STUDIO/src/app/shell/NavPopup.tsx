/**
 * NavPopup — navigation panel.
 *
 * Laid out horizontally: sections sit side by side as columns so the panel is
 * wide and shallow rather than a tall vertical list floating over the page.
 * Anchors under whichever trigger opens it (title-bar menu, or the chat
 * header's brand mark via HeaderNavButton).
 *
 * Closes on: click-outside, Escape key, or navigation.
 */

import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ChatCircleIcon       as ChatCircle,
  WaveformIcon         as Waveform,
  MicrophoneIcon       as Microphone,
  BrainIcon            as Brain,
  SquaresFourIcon      as SquaresFour,
  BriefcaseIcon        as Briefcase,
  UserIcon             as User,
  MonitorIcon          as Monitor,
  ChartLineUpIcon      as ChartLineUp,
  GearIcon             as Gear,
  QuestionIcon         as Question,
} from "@phosphor-icons/react";
import { AccountMenu } from "./AccountMenu";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import type { View } from "@/types/navigation";

interface NavItem { id: View; label: string; Icon: React.ElementType }

/** Section columns, left to right. */
const SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Studio",
    items: [
      { id: "chat",  label: "Chat", Icon: ChatCircle },
      { id: "voice", label: "Live", Icon: Waveform   },
    ],
  },
  {
    label: "Spaces",
    items: [
      { id: "workspace",  label: "Workspace", Icon: Briefcase   },
      { id: "extensions", label: "Apps",      Icon: SquaresFour },
    ],
  },
  {
    label: "Tools",
    items: [
      { id: "transcribe", label: "Transcribe",   Icon: Microphone },
      { id: "computer",   label: "Computer use", Icon: Monitor    },
    ],
  },
  {
    label: "Account",
    items: [
      { id: "activity", label: "Activity", Icon: ChartLineUp },
      { id: "memories", label: "Memories", Icon: Brain       },
      { id: "profile",  label: "Profile",  Icon: User        },
    ],
  },
];

const BOTTOM: NavItem[] = [
  { id: "settings", label: "Settings", Icon: Gear     },
  { id: "help",     label: "Help",     Icon: Question },
];

// ── Nav row ────────────────────────────────────────────────────────────────────

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: (v: View) => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={() => onNavigate(item.id)}
      aria-current={active ? "page" : undefined}
      className={`w-full items-center gap-2 px-2 py-[5px] rounded-lg text-left group
        ${active ? "bg-surface-selected" : "hover:bg-surface-hover"}`}
    >
      <div className="flex-shrink-0 w-[18px] h-[18px] flex items-center justify-center">
        <item.Icon
          size={14}
          weight={active ? "fill" : "regular"}
          className={`transition-colors duration-fast ${
            active ? "text-primary" : "text-muted group-hover:text-primary"
          }`}
        />
      </div>
      <span
        className={`text-xs whitespace-nowrap transition-colors duration-fast ${
          active ? "text-primary font-medium" : "text-secondary group-hover:text-primary font-normal"
        }`}
      >
        {item.label}
      </span>
    </Button>
  );
}

// ── NavPopup ───────────────────────────────────────────────────────────────────

export function NavPopup({
  currentView,
  onNavigate,
  onClose,
  onNewChat,
  panelClassName,
}: {
  currentView: string;
  onNavigate: (view: View) => void;
  onClose: () => void;
  onNewChat?: () => void;
  /** Overrides the default title-bar anchoring when hosted by another trigger. */
  panelClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Click outside → close (skip the toggle button — its own onClick handles that)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-nav-toggle]")) return;
      if (panelRef.current && !panelRef.current.contains(target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Escape → close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const navigate = (v: View) => {
    onNavigate(v);
    onClose();
  };

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label="Navigation"
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{
        type: "spring",
        stiffness: 380,
        damping: 28,
        mass: 0.75,
        opacity: { duration: 0.15, ease: "easeOut" },
      }}
      className={panelClassName ?? `
        absolute top-[47px] left-2 z-popover
        w-max
        bg-surface-base
        rounded-2xl
        border border-surface-border
        shadow-xl
        overflow-hidden
      `}
    >
      {/* ── Section columns ─────────────────────────────────────────────────── */}
      <div className="flex items-stretch gap-1 px-2 pt-2 pb-1.5">
        {SECTIONS.map((section, index) => (
          <div key={section.label} className="flex items-stretch">
            {index > 0 && <div className="mx-1 w-px self-stretch bg-surface-divider" />}
            <div className="min-w-[128px]">
              <p className="px-2 pt-1 pb-1 text-3xs font-semibold tracking-wider uppercase text-muted">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavRow
                    key={item.id}
                    item={item}
                    active={currentView === item.id}
                    onNavigate={navigate}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Bottom: account + Settings / Help ───────────────────────────────── */}
      <div className="mx-3 border-t border-surface-divider" />
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="min-w-0 flex-1">
          <AccountMenu onManageAccount={() => navigate("settings")} />
        </div>
        <div className="flex flex-shrink-0 gap-1">
          {onNewChat && (
            <Button
              variant="ghost"
              onClick={() => { onNewChat(); navigate("chat"); }}
              className="items-center gap-1.5 rounded-xl bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-hover hover:text-primary"
            >
              New chat
            </Button>
          )}
          {BOTTOM.map((item) => (
            <IconButton
              key={item.id}
              aria-label={item.label}
              title={item.label}
              onClick={() => navigate(item.id)}
              aria-current={currentView === item.id ? "page" : undefined}
              className={`rounded-xl ${
                currentView === item.id
                  ? "bg-surface-selected text-primary"
                  : "text-secondary hover:bg-surface-hover hover:text-primary"
              }`}
            >
              <item.Icon size={14} weight={currentView === item.id ? "fill" : "regular"} />
            </IconButton>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
