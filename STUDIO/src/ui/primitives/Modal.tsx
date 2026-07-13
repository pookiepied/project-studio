import { type ReactNode, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "w-80",
  md: "w-full max-w-[820px]",
  lg: "w-full max-w-[1100px]",
};

export function Modal({
  open,
  onClose,
  children,
  size = "sm",
  closeOnBackdrop = true,
  closeOnEscape = true,
  className = "",
}: ModalProps) {
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, closeOnEscape, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closeOnBackdrop ? onClose : undefined}
            className="fixed inset-0 z-modal bg-scrim backdrop-blur-[3px]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-modal flex items-center justify-center pointer-events-none p-4"
          >
            <div
              className={`pointer-events-auto ${sizeClasses[size]} max-h-[90vh] overflow-hidden rounded-2xl bg-surface-page dark:bg-surface-base shadow-2xl ring-1 ring-surface-border dark:ring-surface-border ${className}`}
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
