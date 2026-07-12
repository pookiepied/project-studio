import type { ReactNode } from "react";
import { Button } from "@/ui/primitives/Button";

/** Filter toggle chip. Active = sanctioned inverted-emphasis (bg-primary, #1A1A1A). */
export function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      size="sm"
      className={`h-7 px-2.5 rounded-md text-xs font-medium border transition-colors duration-fast ${
        active
          ? "bg-primary text-on-emphasis border-transparent"
          : "bg-transparent text-secondary border-surface-border hover:bg-surface-hover"
      }`}
    >
      {children}
    </Button>
  );
}

/** Read-only capability indicator in the detail card. */
export function CapabilityPill({
  icon,
  label,
  active,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-2xs ${
        active
          ? "border-surface-border text-secondary bg-surface-raised"
          : "border-surface-border text-muted"
      }`}
    >
      {icon}
      {label}
    </span>
  );
}
