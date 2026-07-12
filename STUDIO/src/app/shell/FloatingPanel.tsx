/**
 * FloatingPanel - global top-center navigation for the workspace shell.
 *
 * The frame and navigation content are exported separately so chat can reuse the
 * same dock architecture while adding project/conversation state.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChatCircleIcon as ChatCircle,
  WaveformIcon as Waveform,
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
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
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

export const FLOATING_PANEL_CATEGORIES: Category[] = [
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
      <Button
        variant="ghost"
        onClick={onToggle}
        aria-expanded={open}
        className={`h-7 gap-1 rounded-full px-2.5 text-xs font-medium ${
          open || ownsCurrent
            ? "bg-surface-selected text-primary"
            : "text-secondary hover:bg-surface-hover hover:text-primary"
        }`}
      >
        {category.label}
        <CaretDown
          size={12}
          weight="bold"
          className={`text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 460, damping: 30, mass: 0.7 }}
            className="absolute left-1/2 top-full z-10 mt-2 w-[180px] -translate-x-1/2 overflow-hidden rounded-xl border border-surface-border bg-white p-1.5 shadow-lg dark:bg-surface-raised"
          >
            {category.items.map((item) => {
              const active = currentView === item.id;
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={`group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${
                    active ? "bg-surface-selected" : "hover:bg-surface-hover"
                  }`}
                >
                  <item.Icon
                    size={14}
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
                </Button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FloatingPanelFrame({
  children,
  className = "",
  dockClassName = "",
}: {
  children: ReactNode;
  className?: string;
  dockClassName?: string;
}) {
  return (
    <div className={`pointer-events-none fixed inset-x-0 top-[5.5px] z-toast flex justify-center ${className}`}>
      <motion.div className="pointer-events-auto">
        <motion.div
          layout
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: 0.18,
            ease: "easeOut",
            layout: { type: "spring", stiffness: 420, damping: 34 },
          }}
          className={`flex min-h-[35px] items-center gap-1 rounded-full border border-surface-border bg-surface-base/80 px-1.5 shadow-lg backdrop-blur-xl ${dockClassName}`}
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}

export function FloatingPanelNavigation({
  currentView,
  onNavigate,
  onClose,
  hideBrand = false,
}: {
  currentView: View;
  onNavigate: (view: View) => void;
  onClose?: () => void;
  hideBrand?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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
    onClose?.();
  };

  return (
    <div ref={ref} className="flex items-center gap-1">
      {!hideBrand && (
        <>
          <IconButton
            aria-label="Chat"
            onClick={() => go("chat")}
            className="rounded-full"
          >
            <StudioMark size={16} className="text-primary" />
          </IconButton>

          <span className="mx-0.5 h-4 w-px bg-surface-divider" />
        </>
      )}

      {FLOATING_PANEL_CATEGORIES.map((cat) => (
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
  return (
    <FloatingPanelFrame>
      <FloatingPanelNavigation currentView={currentView} onNavigate={onNavigate} />
    </FloatingPanelFrame>
  );
}
