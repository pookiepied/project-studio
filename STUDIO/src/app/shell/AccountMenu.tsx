import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  SignOutIcon as SignOut,
  UserCircleIcon as UserCircle,
} from "@phosphor-icons/react";
import { useAuth } from "@/features/auth/context/AuthContext";

interface AccountMenuProps {
  expanded?: boolean;
  onManageAccount?: () => void;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AccountMenu({ expanded = true, onManageAccount }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ left: number; bottom: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();

  const displayName = user?.name || "User";
  const email = user?.email || "";
  const initials = getInitials(displayName);

  useEffect(() => {
    if (!open) return;
    const updatePanelPosition = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelPos({
        left: rect.right + 8,
        bottom: window.innerHeight - rect.bottom,
      });
    };
    updatePanelPosition();

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        wrapperRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const avatar = (
    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 dark:bg-surface-raised">
      {user?.picture ? (
        <img src={user.picture} alt={displayName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="text-2xs font-semibold text-gray-600 dark:text-gray-400">{initials}</span>
      )}
    </span>
  );

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={!expanded ? "Account" : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="group flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors duration-fast hover:bg-surface-hover"
      >
        {avatar}
        <span
          style={{ opacity: expanded ? 1 : 0 }}
          className="min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-fast"
        >
          <span className="block truncate text-sm font-medium text-secondary group-hover:text-primary">
            {displayName}
          </span>
          {email && (
            <span className="block truncate text-2xs text-muted">
              {email}
            </span>
          )}
        </span>
      </button>

      <AnimatePresence>
        {open && panelPos && createPortal(
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, x: -4, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            style={{
              transformOrigin: "left bottom",
              left: panelPos.left,
              bottom: panelPos.bottom,
            }}
            className="fixed z-50 w-64 overflow-hidden rounded-xl border border-surface-border bg-surface-base shadow-xl"
          >
            <div className="flex items-center gap-3 border-b border-surface-divider px-4 py-3.5">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 dark:bg-surface-raised">
                {user?.picture ? (
                  <img src={user.picture} alt={displayName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{initials}</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-primary">{displayName}</span>
                {email && <span className="block truncate text-xs text-muted">{email}</span>}
              </span>
            </div>

            <div className="p-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onManageAccount?.();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
              >
                <UserCircle size={13} weight="regular" />
                Manage account
              </button>

              {user && (
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-secondary transition-colors hover:bg-surface-raised dark:hover:bg-surface-raised/[0.06]"
                >
                  <SignOut size={13} weight="regular" />
                  Sign out
                </button>
              )}
            </div>
          </motion.div>,
          document.body
        )}
      </AnimatePresence>
    </div>
  );
}
