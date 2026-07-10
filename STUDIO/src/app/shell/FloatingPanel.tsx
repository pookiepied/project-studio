/**
 * FloatingPanel — global top-center navigation for the workspace shell.
 *
 * A persistent floating control bar pinned top-center. Structure (left→right):
 *   • brand logo (StudioMark)
 *   • a row of CATEGORY buttons — each opens its own dropdown of related
 *     destinations (a grouped menu bar, not one flat list)
 *   • a theme toggle
 *
 * Only one category dropdown is open at a time. Clicking a destination travels
 * there and closes. Self-contained: carries its own grouped catalogue so the
 * standard NavPopup stays untouched.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChatCircleIcon as ChatCircle,
  WaveformIcon as Waveform,
  FolderOpenIcon as FolderOpen,
  BriefcaseIcon as Briefcase,
  SquaresFourIcon as SquaresFour,
  BrainIcon as Brain,
  MicrophoneIcon as Microphone,
  MonitorIcon as Monitor,
  ChartLineUpIcon as ChartLineUp,
  UserIcon as User,
  GearIcon as Gear,
  CaretDownIcon as CaretDown,
} from "@phosphor-icons/react";
import { StudioMark } from "@/ui/brand/StudioMark";
import { NotificationBell } from "@/app/shell/NotificationBell";
import { ThemeToggle } from "@/app/shell/ThemeToggle";
import type { View } from "@/types/navigation";

interface NavItem {
  id: View;
  label: string;
  Icon: React.ElementType;
}

interface Category {
  key: string;
  label: string;
  items: NavItem[];
}

const CATEGORIES: Category[] = [
  {
    key: "studio",
    label: "Studio",
    items: [
      { id: "chat", label: "Chat", Icon: ChatCircle },
      { id: "voice", label: "Live", Icon: Waveform },
    ],
  },
  {
    key: "spaces",
    label: "Spaces",
    items: [
      { id: "projects", label: "Projects", Icon: FolderOpen },
      { id: "workspace", label: "Workspace", Icon: Briefcase },
      { id: "extensions", label: "Apps", Icon: SquaresFour },
    ],
  },
  {
    key: "tools",
    label: "Tools",
    items: [
      { id: "transcribe", label: "Transcribe", Icon: Microphone },
      { id: "computer", label: "Computer Use", Icon: Monitor },
    ],
  },
  {
    key: "account",
    label: "Account",
    items: [
      { id: "activity", label: "Activity", Icon: ChartLineUp },
      { id: "memories", label: "Memories", Icon: Brain },
      { id: "profile", label: "Profile", Icon: User },
      { id: "settings", label: "Settings", Icon: Gear },
    ],
  },
];

function CategoryMenu({
  category,
  open,
  onToggle,
  currentView,
  onNavigate,
}: {
  category: Category;
  open: boolean;
  onToggle: () => void;
  currentView: View;
  onNavigate: (v: View) => void;
}) {
  const ownsCurrent = category.items.some((i) => i.id === currentView);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors ${
          open || ownsCurrent
            ? "bg-surface-selected text-primary"
            : "text-secondary hover:bg-surface-hover hover:text-primary"
        }`}
      >
        {category.label}
        <CaretDown
          size={9}
          weight="bold"
          className={`text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 460, damping: 30, mass: 0.7 }}
            className="absolute left-1/2 top-full z-10 mt-2 w-[180px] -translate-x-1/2 overflow-hidden rounded-xl border border-surface-border bg-white dark:bg-surface-raised p-1.5 shadow-lg"
          >
            {category.items.map((item) => {
              const active = currentView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={`group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    active ? "bg-surface-selected" : "hover:bg-surface-hover"
                  }`}
                >
                  <item.Icon
                    size={13}
                    weight={active ? "fill" : "regular"}
                    className={`flex-shrink-0 transition-colors ${
                      active ? "text-primary" : "text-muted group-hover:text-primary"
                    }`}
                  />
                  <span
                    className={`text-xs transition-colors ${
                      active
                        ? "font-medium text-primary"
                        : "text-secondary group-hover:text-primary"
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FloatingPanel({
  currentView,
  onNavigate,
}: {
  currentView: View;
  onNavigate: (view: View) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside + Escape close any open category.
  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKey(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKey]);

  const go = (id: View) => {
    onNavigate(id);
    setOpenKey(null);
  };

  // Vertical center pinned in px (not rem) so it stays on the shared top-row
  // center line regardless of the 14px root font — see WindowTrafficLights
  // (TOP_ROW_CENTER_Y) and workspaceShell.css (.studio-chat-header).
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[5.5px] z-toast flex justify-center">
      <motion.div ref={ref} className="pointer-events-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex h-[35px] items-center gap-1 rounded-full border border-surface-border bg-surface-base/80 px-1.5 shadow-lg backdrop-blur-xl"
        >
          {/* Brand mark */}
          <button
            type="button"
            onClick={() => go("chat")}
            aria-label="Chat"
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-surface-hover"
          >
            <StudioMark size={15} className="text-primary" />
          </button>

          <span className="mx-0.5 h-4 w-px bg-surface-divider" />

          {/* Category menus */}
          {CATEGORIES.map((cat) => (
            <CategoryMenu
              key={cat.key}
              category={cat}
              open={openKey === cat.key}
              onToggle={() => setOpenKey((k) => (k === cat.key ? null : cat.key))}
              currentView={currentView}
              onNavigate={go}
            />
          ))}

          <span className="mx-0.5 h-4 w-px bg-surface-divider" />

          <NotificationBell align="right" />
          <ThemeToggle />
        </motion.div>
      </motion.div>
    </div>
  );
}
