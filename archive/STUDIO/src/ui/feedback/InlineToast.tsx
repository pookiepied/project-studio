import type { ReactNode } from "react";

interface InlineToastProps {
  children: ReactNode;
}

export function InlineToast({ children }: InlineToastProps) {
  return (
    <div className="fixed bottom-5 left-1/2 z-toast flex -translate-x-1/2 items-center gap-2 rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-xs text-primary shadow-lg">
      {children}
    </div>
  );
}
