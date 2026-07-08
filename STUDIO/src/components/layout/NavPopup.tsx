/**
 * NavPopup — floating navigation panel.
 *
 * Triggered by the menu button in TitleBar. Replaces the always-visible
 * sidebar with a glass-blur overlay that shows:
 *   • Search (filters nav items live)
 *   • Quick action  — New Chat
 *   • All navigation sections
 *   • Settings + Help pinned at the bottom
 *
 * Closes on: click-outside, Escape key, or navigation.
 */

import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  MagnifyingGlassIcon  as MagnifyingGlass,
  PlusIcon             as Plus,
  ChatCircleIcon       as ChatCircle,
  WaveformIcon         as Waveform,
  MicrophoneIcon       as Microphone,
  SparkleIcon          as Sparkle,
  BrainIcon            as Brain,
  FolderOpenIcon       as FolderOpen,
  SquaresFourIcon      as SquaresFour,
  BriefcaseIcon        as Briefcase,
  UserIcon             as User,
  MonitorIcon          as Monitor,
  ChartLineUpIcon      as ChartLineUp,
  SlidersHorizontalIcon as SlidersHorizontal,
  GearIcon             as Gear,
  QuestionIcon         as Question,
} from "@phosphor-icons/react";
import { AccountMenu } from "./AccountMenu";
import type { View } from "../../types/navigation";

interface NavItem { id: View; label: string; Icon: React.ElementType }

const ALL_ITEMS: NavItem[] = [
  { id: "chat",       label: "Chat",       Icon: ChatCircle        },
  { id: "temporary",  label: "Temporary",  Icon: Sparkle           },
  { id: "voice",      label: "Live",       Icon: Waveform          },
  { id: "profile",    label: "Profile",    Icon: User              },
  { id: "projects",   label: "Projects",   Icon: FolderOpen        },
  { id: "workspace",  label: "Workspace",  Icon: Briefcase         },
  { id: "extensions", label: "Apps",       Icon: SquaresFour       },
  { id: "transcribe", label: "Transcribe", Icon: Microphone        },
  { id: "memories",   label: "Memories",   Icon: Brain             },
  { id: "computer",   label: "Computer Use", Icon: Monitor         },
  { id: "activity",   label: "Activity",   Icon: ChartLineUp       },
  { id: "manage",     label: "Manage",     Icon: SlidersHorizontal },
  { id: "settings",   label: "Settings",   Icon: Gear              },
  { id: "help",       label: "Help",       Icon: Question          },
];

const SECTIONS: Array<{ label: string | null; ids: View[] }> = [
  { label: null,           ids: ["chat", "temporary", "voice"] },
  { label: "Spaces",       ids: ["projects", "workspace"] },
  { label: "Tools",        ids: ["transcribe", "computer"] },
  { label: "Applications", ids: ["extensions"] },
  { label: "Profile",      ids: ["profile"] },
];

const BOTTOM: NavItem[] = [
  { id: "settings", label: "Settings", Icon: Gear     },
  { id: "help",     label: "Help",     Icon: Question },
];

const itemMap = Object.fromEntries(ALL_ITEMS.map((i) => [i.id, i]));

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
    <button
      type="button"
      onClick={() => onNavigate(item.id)}
      aria-current={active ? "page" : undefined}
      className={`w-full flex items-center gap-2.5 px-2 py-[5px] rounded-lg text-left group
        transition-colors duration-fast
        ${active
          ? "bg-surface-selected"
          : "hover:bg-surface-hover"
        }`}
    >
      <div className="flex-shrink-0 w-[22px] h-[22px] flex items-center justify-center">
        <item.Icon
          size={12}
          weight={active ? "fill" : "regular"}
          className={`transition-colors duration-fast ${
            active
              ? "text-primary"
              : "text-muted group-hover:text-primary"
          }`}
        />
      </div>
      <span
        className={`text-sm transition-colors duration-fast ${
          active
            ? "text-primary font-medium"
            : "text-secondary group-hover:text-primary font-normal"
        }`}
      >
        {item.label}
      </span>
    </button>
  );
}

// ── NavPopup ───────────────────────────────────────────────────────────────────

export function NavPopup({
  currentView,
  onNavigate,
  onClose,
  onNewChat,
}: {
  currentView: string;
  onNavigate: (view: View) => void;
  onClose: () => void;
  onNewChat?: () => void;
}) {
  const [search, setSearch] = useState("");
  const panelRef  = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Auto-focus search on open
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  // Click outside → close (skip the toggle button — its own onClick handles that)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-nav-toggle]")) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
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

  const q = search.toLowerCase().trim();
  const filtered = q
    ? ALL_ITEMS.filter((i) => i.label.toLowerCase().includes(q))
    : null;

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
      className="
        absolute top-[47px] left-2 z-popover
        w-[220px]
        bg-surface-base
        rounded-2xl
        border border-surface-border
        shadow-xl
        overflow-hidden
      "
    >
      {/* ── Search ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2.5">
        <MagnifyingGlass
          size={13}
          className="text-muted flex-shrink-0"
        />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="
            flex-1 text-sm bg-transparent outline-none
            text-primary
            placeholder-muted
          "
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="text-muted hover:text-primary transition-colors"
          >
            <span className="text-2xs">✕</span>
          </button>
        )}
      </div>

      {/* ── Quick action ────────────────────────────────────────────────────── */}
      {!q && (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => { onNewChat?.(); navigate("chat"); }}
            className="
              w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-xl
              bg-surface-raised
              hover:bg-surface-hover
              transition-colors duration-fast group
            "
          >
            <div className="w-[22px] h-[22px] rounded-full bg-surface-selected flex items-center justify-center flex-shrink-0">
              <Plus size={11} weight="regular" className="text-secondary" />
            </div>
            <span className="text-sm text-secondary font-medium">
              New Chat
            </span>
          </button>
        </div>
      )}

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div className="mx-3 border-t border-surface-divider" />

      {/* ── Nav items ───────────────────────────────────────────────────────── */}
      <div className="py-1.5 px-1.5 max-h-[320px] overflow-y-auto scrollbar-auto-hide">
        {filtered ? (
          filtered.length === 0 ? (
            <p className="px-3 py-5 text-center text-sm text-muted">
              No results
            </p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((item) => (
                <NavRow
                  key={item.id}
                  item={item}
                  active={currentView === item.id}
                  onNavigate={navigate}
                />
              ))}
            </div>
          )
        ) : (
          SECTIONS.map((section) => (
            <div key={section.label ?? "__primary"} className="mb-0.5">
              {section.label && (
                <p className="px-2.5 pt-1.5 pb-0.5 text-3xs font-semibold tracking-wider uppercase text-muted">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {section.ids.map((id) => {
                  const item = itemMap[id];
                  return item ? (
                    <NavRow
                      key={id}
                      item={item}
                      active={currentView === id}
                      onNavigate={navigate}
                    />
                  ) : null;
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Bottom: Settings + Help ──────────────────────────────────────────── */}
      <div className="mx-3 border-t border-surface-divider" />
      <div className="px-2 py-1.5">
        <AccountMenu onManageAccount={() => navigate("settings")} />
      </div>
      <div className="mx-3 border-t border-surface-divider" />
      <div className="px-2 py-2 flex gap-1">
        {BOTTOM.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.id)}
            aria-current={currentView === item.id ? "page" : undefined}
            className={`
              flex-1 flex items-center justify-center gap-1.5
              py-1.5 rounded-xl text-xs
              transition-colors duration-fast
              ${currentView === item.id
                ? "bg-surface-selected text-primary font-medium"
                : "text-secondary hover:bg-surface-hover hover:text-primary"
              }
            `}
          >
            <item.Icon size={12} weight={currentView === item.id ? "fill" : "regular"} />
            {item.label}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
