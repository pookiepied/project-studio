/**
 * HeaderNavButton — the in-header navigation trigger.
 *
 * On pages that own their own top bar (chat), the global FloatingPanel dock is
 * not mounted; this brand-mark button takes its place as a normal flex child
 * and opens the same NavPopup the standard shell uses.
 */

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { CaretDownIcon as CaretDown } from "@phosphor-icons/react";
import { StudioMark } from "@/ui/brand/StudioMark";
import { NavPopup } from "@/app/shell/NavPopup";
import { useNavigation } from "@/app/contexts/NavigationContext";
import type { View } from "@/types/navigation";

export function HeaderNavButton({ onNewChat }: { onNewChat?: () => void }) {
  const [open, setOpen] = useState(false);
  const { currentView, navigateTo } = useNavigation();

  const go = (view: View) => {
    navigateTo(view);
    setOpen(false);
  };

  return (
    <div className="relative flex-shrink-0">
      {/* Reads as a control, not a logo: bordered pill + caret. A bare mark was
          too quiet to look clickable. */}
      <button
        type="button"
        data-nav-toggle
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Navigation"
        title="Navigation"
        className={`flex h-7 items-center gap-1 rounded-lg border border-surface-border pl-1.5 pr-1 transition-colors ${
          open ? "bg-surface-selected" : "hover:bg-surface-hover"
        }`}
      >
        <StudioMark size={15} className="text-primary" />
        <CaretDown
          size={9}
          weight="bold"
          className={`text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <NavPopup
            currentView={currentView}
            onNavigate={go}
            onClose={() => setOpen(false)}
            onNewChat={onNewChat}
            panelClassName="absolute left-0 top-full mt-1.5 z-popover w-max rounded-2xl border border-surface-border bg-surface-base shadow-xl overflow-hidden"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
