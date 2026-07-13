import type { ReactNode } from "react";
import { Button } from "@/ui/primitives/Button";

interface PermissionModalShellProps {
  children: ReactNode;
}

export function PermissionModalShell({ children }: PermissionModalShellProps) {
  return (
    <div className="pointer-events-auto flex h-[480px] max-h-[90vh] w-full max-w-[820px] overflow-hidden rounded-2xl bg-surface-page shadow-2xl ring-1 ring-surface-border dark:bg-surface-base dark:ring-surface-border">
      {children}
    </div>
  );
}

type PermissionActionButtonProps = React.ComponentProps<typeof Button>;

export function PermissionActionButton({ className = "", ...props }: PermissionActionButtonProps) {
  return (
    <Button
      variant="primary"
      className={`flex-1 rounded-2xl bg-primary py-2.5 text-base font-semibold text-on-emphasis transition-colors hover:bg-secondary dark:bg-surface-base dark:text-primary dark:hover:bg-surface-page ${className}`}
      {...props}
    />
  );
}
