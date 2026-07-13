import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PageShellProps {
  children: ReactNode;
  className?: string;
}

export function PageShell({ children, className = "" }: PageShellProps) {
  return (
    <div className={cn(
      "h-full flex flex-col bg-surface-page overflow-hidden transition-colors duration-normal",
      className,
    )}>
      {children}
    </div>
  );
}
